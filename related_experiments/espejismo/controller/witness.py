"""witness: el testigo eBPF de Espejismo (solo lectura). Corre como root en la VM.

Ve lo que hacen los procesos de cada sandbox desde el kernel del host, fuera del alcance
del agente: ejecuciones, archivos abiertos, conexiones, señales (kill) y salidas de procesos.
Incluye lo que un script hace por dentro, que el transcript del agente no muestra.

Filtra por cgroup: solo observa los contenedores de episodios activos en hostd, y le manda
cada evento a hostd (POST /episodes/<ip>/event), que lo guarda en el JSONL del episodio.

Uso: sudo /usr/bin/python3 controller/witness.py   (python3-bpfcc del sistema)
"""

from __future__ import annotations

import ctypes as ct
import json
import os
import socket
import struct
import subprocess
import threading
import time
import urllib.request

from bcc import BPF

API = "http://127.0.0.1:8787"
NET = "espejismo_net"

BPF_TEXT = r"""
#include <linux/sched.h>
#include <linux/in.h>

#define K_EXEC 1
#define K_OPEN 2
#define K_CONNECT 3
#define K_KILL 4
#define K_EXIT 5

struct ev_t {
    u64 cgid;
    u32 kind;
    u32 pid;
    u32 ppid;
    u32 uid;
    u32 a1;      // open: flags | connect: ip | kill: target pid
    u32 a2;      // connect: port | kill: signal
    char comm[16];
    char path[200];
};

BPF_HASH(watched, u64, u8, 1024);
BPF_PERF_OUTPUT(events);

static __always_inline int fill(struct ev_t *e, u32 kind) {
    e->cgid = bpf_get_current_cgroup_id();
    u8 *ok = watched.lookup(&e->cgid);
    if (!ok) return 0;
    e->kind = kind;
    e->pid = bpf_get_current_pid_tgid() >> 32;
    e->uid = bpf_get_current_uid_gid();
    struct task_struct *t = (struct task_struct *)bpf_get_current_task();
    e->ppid = t->real_parent->tgid;
    bpf_get_current_comm(&e->comm, sizeof(e->comm));
    return 1;
}

TRACEPOINT_PROBE(sched, sched_process_exec) {
    struct ev_t e = {};
    if (!fill(&e, K_EXEC)) return 0;
    TP_DATA_LOC_READ_STR(e.path, filename, sizeof(e.path));
    events.perf_submit(args, &e, sizeof(e));
    return 0;
}

TRACEPOINT_PROBE(syscalls, sys_enter_openat) {
    struct ev_t e = {};
    if (!fill(&e, K_OPEN)) return 0;
    e.a1 = args->flags;
    bpf_probe_read_user_str(e.path, sizeof(e.path), args->filename);
    events.perf_submit(args, &e, sizeof(e));
    return 0;
}

TRACEPOINT_PROBE(syscalls, sys_enter_connect) {
    struct ev_t e = {};
    if (!fill(&e, K_CONNECT)) return 0;
    struct sockaddr_in sa = {};
    bpf_probe_read_user(&sa, sizeof(sa), args->uservaddr);
    if (sa.sin_family != 2) return 0;   // AF_INET
    e.a1 = sa.sin_addr.s_addr;
    e.a2 = sa.sin_port;
    events.perf_submit(args, &e, sizeof(e));
    return 0;
}

TRACEPOINT_PROBE(syscalls, sys_enter_kill) {
    struct ev_t e = {};
    if (!fill(&e, K_KILL)) return 0;
    e.a1 = args->pid;
    e.a2 = args->sig;
    events.perf_submit(args, &e, sizeof(e));
    return 0;
}

TRACEPOINT_PROBE(sched, sched_process_exit) {
    struct ev_t e = {};
    if (!fill(&e, K_EXIT)) return 0;
    u32 tid = bpf_get_current_pid_tgid();
    if (tid != e.pid) return 0;          // solo el hilo principal
    events.perf_submit(args, &e, sizeof(e));
    return 0;
}
"""

KINDS = {1: "kernel_exec", 2: "kernel_open", 3: "kernel_connect", 4: "kernel_kill", 5: "kernel_exit"}
NOISY_PREFIXES = ("/usr/", "/lib", "/proc", "/sys/", "/dev/", "/etc/ld.so", "/etc/localtime", "/run/", "/var/lib/",
                  "/etc/hosts", "/etc/resolv.conf", "/etc/nsswitch.conf", "/etc/host.conf", "/etc/gai.conf",
                  "/etc/passwd", "/etc/group", "/etc/ssl/", "/etc/sudo", "/etc/pam", "/etc/login.defs", "/etc/security/")
NOISY_SUFFIXES = (".curlrc", "/curlrc", ".pyc", "/.wgetrc", "/wgetrc")
O_WRONLY, O_RDWR, O_CREAT, O_TRUNC = 0o1, 0o2, 0o100, 0o1000


class Ev(ct.Structure):
    _fields_ = [
        ("cgid", ct.c_uint64),
        ("kind", ct.c_uint32),
        ("pid", ct.c_uint32),
        ("ppid", ct.c_uint32),
        ("uid", ct.c_uint32),
        ("a1", ct.c_uint32),
        ("a2", ct.c_uint32),
        ("comm", ct.c_char * 16),
        ("path", ct.c_char * 200),
    ]


def http(method: str, path: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=5) as r:
        return json.loads(r.read() or b"{}")


def cmdline(pid: int) -> str:
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as f:
            return f.read().replace(b"\0", b" ").decode("utf-8", "replace").strip()[:400]
    except OSError:
        return ""


class Witness:
    def __init__(self) -> None:
        self.b = BPF(text=BPF_TEXT)
        self.watched = self.b["watched"]
        self.cg_to_ip: dict[int, str] = {}
        self.pid_comm: dict[tuple[int, int], str] = {}
        self.lock = threading.Lock()

    def sync(self) -> None:
        """Mapea las IPs de episodios activos a cgroups de contenedores y actualiza el mapa BPF."""
        try:
            active = http("GET", "/episodes").get("active", {})
            net = json.loads(subprocess.run(["docker", "network", "inspect", NET], capture_output=True, text=True).stdout)[0]
        except Exception:  # noqa: BLE001
            return
        ip_to_cid = {v["IPv4Address"].split("/")[0]: cid for cid, v in net.get("Containers", {}).items()}
        new: dict[int, str] = {}
        for ip in active:
            cid = ip_to_cid.get(ip)
            if not cid:
                continue
            path = f"/sys/fs/cgroup/system.slice/docker-{cid}.scope"
            try:
                new[os.stat(path).st_ino] = ip
            except OSError:
                continue
        with self.lock:
            for cg in set(self.cg_to_ip) - set(new):
                self.watched.pop(ct.c_uint64(cg), None)
            for cg in set(new) - set(self.cg_to_ip):
                self.watched[ct.c_uint64(cg)] = ct.c_uint8(1)
            self.cg_to_ip = new

    def handle(self, _cpu, data, _size) -> None:
        e = ct.cast(data, ct.POINTER(Ev)).contents
        ip = self.cg_to_ip.get(e.cgid)
        if not ip:
            return
        kind = KINDS.get(e.kind, "kernel")
        comm = e.comm.decode("utf-8", "replace")
        path = e.path.decode("utf-8", "replace")
        if comm.startswith("runc"):
            return
        # El sentinel hace heartbeats cada 2 s: solo importa su salida (o una señal contra él).
        if comm == "sentinel-agent" and kind in ("kernel_open", "kernel_connect"):
            return
        ev: dict = {"kind": kind, "pid": e.pid, "ppid": e.ppid, "uid": e.uid, "comm": comm}
        if kind == "kernel_exec":
            self.pid_comm[(e.cgid, e.pid)] = os.path.basename(path)
            ev.update(path=path, cmdline=cmdline(e.pid))
        elif kind == "kernel_open":
            if not path.startswith(("/", "~")) or path.startswith(NOISY_PREFIXES) or path.endswith(NOISY_SUFFIXES):
                return
            write = bool(e.a1 & (O_WRONLY | O_RDWR | O_CREAT | O_TRUNC))
            if path.startswith(("/usr", "/lib")) and not write:
                return
            ev.update(path=path, write=write)
        elif kind == "kernel_connect":
            ev.update(dst=socket.inet_ntoa(struct.pack("I", e.a1)), port=socket.ntohs(e.a2))
            if ev["dst"].startswith("127.") and ev["port"] == 53:
                return
        elif kind == "kernel_kill":
            target = int(ct.c_int32(e.a1).value)
            ev.update(target_pid=target, signal=int(ct.c_int32(e.a2).value), target_comm=self.pid_comm.get((e.cgid, target), ""))
            if ev["signal"] == 0:
                return  # sondeo de existencia, no una señal real
        elif kind == "kernel_exit":
            ev.update(comm=comm)
        try:
            http("POST", f"/episodes/{ip}/event", ev)
        except Exception:  # noqa: BLE001
            pass

    def loop(self) -> None:
        self.b["events"].open_perf_buffer(self.handle, page_cnt=256)
        last = 0.0
        print("witness listo: exec/openat/connect/kill/exit por cgroup", flush=True)
        while True:
            if time.time() - last > 1.0:
                self.sync()
                last = time.time()
            self.b.perf_buffer_poll(timeout=200)


if __name__ == "__main__":
    Witness().loop()
