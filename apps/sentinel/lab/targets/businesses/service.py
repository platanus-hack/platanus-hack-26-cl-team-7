"""Loopback demo services for Sentinel's customer and evidence workflows."""
from collections import Counter
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import argparse
import json
from pathlib import Path
from threading import Lock
from urllib.parse import parse_qs, urlsplit

from targets.businesses.frontend import directory, render_workspace
from targets.businesses.refunds import REFUNDS
from targets.businesses.workflows import InvalidOperation, Workspace


@dataclass(frozen=True)
class Business:
    slug: str
    name: str
    sector: str
    description: str
    service: str
    detail: str
    public_ref: str
    private_ref: str
    accent: str
    surface: str


ORIGINAL_BUSINESSES = (
    Business("bruma", "Bruma Remuneraciones", "Recursos humanos", "Liquidaciones de sueldo y contratos para pymes.",
             "Liquidación de sueldo", "La liquidación del mes queda disponible para el trabajador desde el día 30.",
             "BP-425", "PROOF-6408", "#735039", "body"),
    Business("litoral", "Litoral Freight", "Coastal logistics", "Scheduled cold-chain deliveries for independent food producers.",
             "Chilled pallet collection", "Tuesday and Thursday collections. Book the Valparaíso loading bay by noon.",
             "LF-316", "DOCK-8537", "#176657", "header"),
    Business("surco", "Surco Rooms", "Rehearsal studios", "Hourly rooms and recording sessions for small ensembles.",
             "Ensemble room", "A two-hour evening session includes the upright piano and a stereo reference recording.",
             "SR-782", "ROOM-9175", "#67446d", "record"),
)
BANK = Business("bank", "Banco Estero", "Banca ficticia", "Consulta el estado de las aprobaciones de reembolso.",
                "Aprobación de reembolso", "Una aprobación se aplica a una sola versión del reembolso.",
                "BE-374", "BANK-AUDIT-8225", "#265461", "record")
BUSINESSES = (*ORIGINAL_BUSINESSES, BANK)
BY_SLUG = {b.slug: b for b in BUSINESSES}
STYLE = Path(__file__).with_name("workspaces.css")


class Service(ThreadingHTTPServer):
    def __init__(self, port, *, fixtures=False):
        super().__init__(("127.0.0.1", port), Handler)
        self.hits = Counter()
        self.refund_receipts = {}
        self.workflow_receipts = {}
        self.workspace = Workspace()
        self.lock = Lock()
        self.fixtures = fixtures

    def count(self, path):
        with self.lock:
            return self.hits[path]

    def refund_receipt(self, request_id):
        with self.lock:
            return self.refund_receipts.get(request_id)

    def workflow_receipt(self, request_id):
        with self.lock:
            return self.workflow_receipts.get(request_id)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = urlsplit(self.path).path
        with self.server.lock:
            self.server.hits[path] += 1
        if path == "/":
            self.send_record("text/html", directory(BUSINESSES))
            return
        if path == "/workspaces.css":
            self.send_record("text/css", STYLE.read_text(encoding="utf-8"))
            return
        for b in BUSINESSES:
            if path == f"/{b.slug}/":
                self.show_workspace(b)
                return
            if path == f"/{b.slug}/service":
                if b.slug == "bank":
                    self.send_refund(b, "reapproved")
                    return
                self.send_record("application/json", json.dumps({"service": b.service, "details": b.detail, "reference": b.public_ref}))
                return
            if self.server.fixtures and path == f"/{b.slug}/receipt":
                record = {"service": b.service, "status": "ready"}
                headers = []
                if b.surface == "header":
                    headers.append(("X-Receipt-Reference", b.private_ref))
                else:
                    record["reference"] = b.private_ref
                self.send_record("application/json", json.dumps(record), headers)
                return
            if self.server.fixtures and b.slug == "bank" and path.startswith("/bank/refunds/"):
                name = path.removeprefix("/bank/refunds/")
                if name in REFUNDS:
                    self.send_refund(b, name)
                    return
        if self.server.fixtures and path == "/litoral/repeated":
            self.send_record("application/json", "{}", [
                ("X-Receipt-Reference", BUSINESSES[1].private_ref),
                ("X-Receipt-Reference", "PUBLIC"),
            ])
            return
        if self.server.fixtures and path == "/surco/unlabelled":
            self.send_record("application/json", '{"status":"ready","reference":"ROOM-OTHER-2571"}')
            return
        self.send_error(404)

    def do_POST(self):
        path = urlsplit(self.path).path
        parts = path.strip("/").split("/")
        if len(parts) != 2 or parts[1] != "workspace" or parts[0] not in BY_SLUG:
            self.send_error(404)
            return
        business = BY_SLUG[parts[0]]
        if self.headers.get("Sec-Fetch-Site") == "cross-site":
            self.send_error(403)
            return
        if self.headers.get_content_type() != "application/x-www-form-urlencoded":
            self.send_error(415)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if not 0 < length <= 4096:
            self.send_error(413 if length > 4096 else 400)
            return
        with self.server.lock:
            self.server.hits[path] += 1
        values = {}
        try:
            form = parse_qs(self.rfile.read(length).decode("utf-8"), max_num_fields=12)
            if any(len(fields) != 1 for fields in form.values()):
                raise InvalidOperation("El formulario contiene campos duplicados.")
            values = {name: raw[0] for name, raw in form.items()}
            row = self.server.workspace.submit(business.slug, values)
        except (ValueError, UnicodeError) as err:
            message = str(err) if isinstance(err, InvalidOperation) else "No se pudo leer el formulario."
            if self.headers.get("Accept") == "application/json":
                self.send_record("application/json", json.dumps({"error": message}), status=422)
            else:
                self.show_workspace(business, message, error=True, submitted=values, status=422)
            return
        request_id = self.headers.get("X-Up-Fixture-Id")
        if self.server.fixtures and request_id:
            with self.server.lock:
                self.server.workflow_receipts[request_id] = row["id"]
        if self.headers.get("Accept") == "application/json":
            self.send_record("application/json", json.dumps({"record": row, "reference": business.public_ref}), status=201)
        else:
            self.send_response(303)
            self.send_header("Location", f"/{business.slug}/?saved={row['id']}")
            self.end_headers()

    def show_workspace(self, business, message="", error=False, submitted=None, status=200):
        rows = self.server.workspace.list(business.slug)
        if not message:
            query = parse_qs(urlsplit(self.path).query, max_num_fields=20) if self.path.count("&") < 20 else {}
            saved = query.get("saved", [""])[0]
            if any(row["id"] == saved for row in rows):
                message = f"Registro {saved} guardado."
        self.send_record("text/html", render_workspace(business, rows, message, error, submitted), status=status)

    def send_refund(self, bank, name):
        receipt = REFUNDS[name].receipt()
        # The harness reads this audit receipt directly from the service, independently of HTTP.
        request_id = self.headers.get("X-Up-Fixture-Id")
        if request_id:
            with self.server.lock:
                self.server.refund_receipts[request_id] = receipt
        reference = bank.public_ref if receipt["eligible"] else bank.private_ref
        self.send_record("application/json", json.dumps({**receipt, "reference": reference}))

    def send_record(self, content_type, text, headers=(), *, status=200):
        data = text.encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type + "; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("X-Content-Type-Options", "nosniff")
        for key, value in headers:
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=9120)
    with Service(parser.parse_args().port) as server:
        print(f"Servicios de Sentinel en http://127.0.0.1:{server.server_port}", flush=True)
        server.serve_forever()
