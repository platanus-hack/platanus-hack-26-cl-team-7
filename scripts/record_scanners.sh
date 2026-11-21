#!/usr/bin/env bash
# Records labeled scanner sessions (ffuf, nuclei, nikto, a patient curl prober) through the local
# stack (Caddy :8080 -> demo site :8081) and writes eval/data/{tune,test}/scanner-<run>.jsonl with
# a .labels.json beside each file.
#   SCANNERS_WORK=<dir> scripts/record_scanners.sh [cut]  (default work dir: run/scanners)
# "cut" only re-cuts run/access.log with the windows already saved in <dir>/runs.tsv.
# Every request leaves from loopback, so each run is cut out of run/access.log by its time window
# plus a run marker (a UA token, the shellshock UA nikto sends, or the IPv6 loopback source that
# only nuclei uses), and its client_ip/remote_ip are rewritten to the run's own 10.66.x.y address.
# Nothing else in a Caddy line changes. Session id = client_ip|User-Agent, as engine/logreader.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="${SCANNERS_WORK:-$ROOT/run/scanners}"
LOG="$ROOT/run/access.log"
LISTS="$WORK/lists"
TEMPLATES="${NUCLEI_TEMPLATES:-$WORK/nuclei-templates}"
SECLISTS=https://raw.githubusercontent.com/danielmiessler/SecLists/master/Discovery/Web-Content
TEMPLATES_TAG=v10.5.2  # nuclei-templates release; git clone keeps nuclei's own config untouched
TARGET=http://127.0.0.1:8080
FFUF_UA="Fuzz Faster U Fool v2.1.0-dev"
NIKTO_UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.6280.45 Safari/537.36"
PATIENT_UA="Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0"
MAX_BYTES=1900000
mkdir -p "$WORK/out" "$LISTS"

now() { perl -MTime::HiRes=time -e 'printf "%.6f\n", time'; }

stack_up() {
  if bash "$ROOT/scripts/stack_local.sh" status | grep -q running; then
    echo "stack: already running, reusing it"
  else
    bash "$ROOT/scripts/stack_local.sh" start
    echo "record_scanners" >"$WORK/stack-owner"
  fi
}

prepare_lists() {
  local name
  for name in common.txt raft-small-directories.txt; do
    [[ -s "$LISTS/$name" ]] || curl -fsSL -o "$LISTS/$name" "$SECLISTS/$name"
  done
  awk 'NR % 3 == 1' "$LISTS/common.txt" >"$LISTS/ffuf-common.txt"
  awk 'NR % 13 == 1' "$LISTS/raft-small-directories.txt" >"$LISTS/ffuf-raft.txt"
  # Slow lists: 40 words each, listed shop routes mixed with common.txt guesses.
  { printf '%s\n' products login cart search account checkout; awk 'NR % 140 == 7' "$LISTS/common.txt"; } |
    head -n 40 >"$LISTS/slow-a.txt"
  { printf '%s\n' logout products/1 api/products api/session robots.txt;
    awk 'NR % 140 == 77' "$LISTS/common.txt"; } | head -n 40 >"$LISTS/slow-b.txt"
  [[ -d "$TEMPLATES/http" ]] || git clone -q --depth 1 --branch "$TEMPLATES_TAG" \
    https://github.com/projectdiscovery/nuclei-templates "$TEMPLATES"
  LIST_NOTE="SecLists master as of $(date -u +%F): common.txt sha256"
  LIST_NOTE="$LIST_NOTE $(shasum -a 256 "$LISTS/common.txt" | cut -c1-64), raft-small-directories.txt"
  LIST_NOTE="$LIST_NOTE sha256 $(shasum -a 256 "$LISTS/raft-small-directories.txt" | cut -c1-64)."
}

# run NAME SIDE IP MARKER NOTE CMD...  (MARKER: "ua:<text>", "ua:<a>|<b>" or "ip6")
run() {
  local name=$1 side=$2 ip=$3 marker=$4 note=$5 start end cmd
  shift 5
  cmd="$(printf '%q ' "$@")"
  cmd="${cmd% }"
  cmd="${cmd//$LISTS/<lists>}"
  cmd="${cmd//$TEMPLATES/<nuclei-templates>}"
  start="$(now)"
  echo "run $name: $cmd"
  "$@" >"$WORK/out/$name.txt" 2>&1 || echo "run $name: exit $? (see $WORK/out/$name.txt)"
  end="$(now)"
  sleep 2  # keeps back-to-back runs with the same marker in disjoint time windows
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$name" "$side" "$ip" "$marker" "$start" "$end" \
    "$note Command: $cmd" >>"$WORK/runs.tsv"
}

patient() {  # patient UA_TOKEN PATH... : one GET every 20 s
  local ua="$PATIENT_UA $1" path first=1
  shift
  for path in "$@"; do
    [[ $first == 1 ]] || sleep 20
    first=0
    curl -s -o /dev/null -A "$ua" "$TARGET$path" || true
  done
}

cut_run() {  # cut_run NAME SIDE IP MARKER START END NOTE
  local name=$1 side=$2 ip=$3 marker=$4 start=$5 end=$6 note=$7 dest part file
  dest="$ROOT/eval/data/$side"
  awk -v lo="$start" -v hi="$end" -v marker="$marker" '
    match($0, /"ts":[0-9.]+/) {
      ts = substr($0, RSTART + 5, RLENGTH - 5) + 0
      if (ts < lo - 0.2 || ts > hi + 1) next
      if (marker == "ip6") { if (index($0, "\"remote_ip\":\"::1\"")) print; next }
      n = split(substr(marker, 4), alts, "|")
      for (i = 1; i <= n; i++) if (index($0, "\"User-Agent\":[\"" alts[i])) { print; next }
    }' "$LOG" |
    sed -E -e "s/\"remote_ip\":\"(127\.0\.0\.1|::1)\"/\"remote_ip\":\"$ip\"/" \
      -e "s/\"client_ip\":\"(127\.0\.0\.1|::1)\"/\"client_ip\":\"$ip\"/" >"$WORK/$name.cut"
  rm -f "$dest/scanner-$name".jsonl "$dest/scanner-$name"-[0-9]*.jsonl \
    "$dest/scanner-$name".labels.json "$dest/scanner-$name"-[0-9]*.labels.json
  [[ -s "$WORK/$name.cut" ]] || { echo "cut $name: no lines found" >&2; return 1; }
  split -l "$(lines_per_part "$WORK/$name.cut")" "$WORK/$name.cut" "$WORK/$name.part."
  part=0
  for file in "$WORK/$name.part."*; do
    part=$((part + 1))
    local base="scanner-$name"
    [[ $part == 1 ]] || base="scanner-$name-$part"
    mv "$file" "$dest/$base.jsonl"
    write_labels "$dest/$base.jsonl" "$dest/$base.labels.json" "$name" "$ip" "$note"
  done
  echo "cut $name -> $side: $(wc -l <"$WORK/$name.cut") lines, $part file(s)"
}

lines_per_part() {
  local bytes lines
  bytes=$(wc -c <"$1")
  lines=$(wc -l <"$1")
  echo $(((lines * MAX_BYTES / (bytes + 1)) + 1))
}

write_labels() {  # write_labels JSONL LABELS NAME IP NOTE
  jq -r '"\(.request.client_ip // .request.remote_ip)|\(.request.headers["User-Agent"][0] // "")"' \
    "$1" | sort -u | jq -R -s --arg src "scanner-$3" --arg ip "$4" --arg note "$5" '
    split("\n") | map(select(length > 0)) as $ids | {
      source: $src, synthetic: false,
      notes: ("Recorded through Caddy (scripts/record_scanners.sh) against the demo shop. "
        + "Loopback client_ip/remote_ip rewritten to " + $ip + " for this run; no other field "
        + "changed. Sessions = IP|User-Agent: " + ($ids | length | tostring) + ". " + $note),
      sessions: ($ids | map({(.): "probing"}) | add)}' >"$2"
}

stack_down() {
  [[ -f "$WORK/stack-owner" ]] || { echo "stack: not started by this script, leaving it up"; return; }
  local waited=0 last
  while ((waited < 600)); do  # let other recorders finish: wait for 60 s without new log lines
    last=$(tail -n 1 "$LOG" | sed -n 's/.*"ts":\([0-9]*\).*/\1/p')
    (($(date +%s) - ${last:-0} >= 60)) && break
    sleep 10
    waited=$((waited + 10))
  done
  bash "$ROOT/scripts/stack_local.sh" stop
  rm -f "$WORK/stack-owner"
}

record() {
  local rotate="nuclei picks a new random User-Agent for every request, so IP|UA splits one run"
  rotate="$rotate into many sessions; each is labeled probing (honest v0 behaviour)."
  local shock="nikto also sends its shellshock test UA '() { :; }; ...', a second session."
  run patient-a tune 10.66.1.5 "ua:$PATIENT_UA scanners-patient-a" \
    "Low-and-slow prober: one GET every 20 s, listed and unlisted routes, no payloads." \
    patient scanners-patient-a / /products /admin /products/2 /backup /api/v1/users /search \
    /phpmyadmin/ /server-status /cart /api/admin /config /account /debug /old /api/products \
    /console /test /login /uploads /api/internal &
  run patient-b test 10.66.2.5 "ua:$PATIENT_UA scanners-patient-b" \
    "Low-and-slow prober: one GET every 20 s, listed and unlisted routes, a few payloads." \
    patient scanners-patient-b / /login /api/users/1 /api/users/2 /admin/login /.env \
    /products /api/v2/products /search?q=1%27%20OR%20%271%27=%271 /graphql /staging \
    /api/session /.git/config /wp-admin/ /dashboard /api/cart /swagger.json /backup.zip \
    /actuator/health /checkout /internal &
  run ffuf-slow-a tune 10.66.1.2 "ua:$FFUF_UA scanners-ffuf-slow-a" "Slow ffuf: -rate 1. $LIST_NOTE" \
    ffuf -s -rate 1 -t 1 -w "$LISTS/slow-a.txt" -u "$TARGET/FUZZ" \
    -H "User-Agent: $FFUF_UA scanners-ffuf-slow-a" -mc all -fc 404 &
  run ffuf-slow-b test 10.66.2.2 "ua:$FFUF_UA scanners-ffuf-slow-b" "Slow ffuf: -rate 1. $LIST_NOTE" \
    ffuf -s -rate 1 -t 1 -w "$LISTS/slow-b.txt" -u "$TARGET/FUZZ" \
    -H "User-Agent: $FFUF_UA scanners-ffuf-slow-b" -mc all -fc 404 &
  run ffuf-common tune 10.66.1.1 "ua:$FFUF_UA scanners-ffuf-common" \
    "Discovery/Web-Content/common.txt, every 3rd line. $LIST_NOTE" \
    ffuf -s -rate 100 -w "$LISTS/ffuf-common.txt" -u "$TARGET/FUZZ" \
    -H "User-Agent: $FFUF_UA scanners-ffuf-common" -mc all -fc 404
  run ffuf-raft test 10.66.2.1 "ua:$FFUF_UA scanners-ffuf-raft" \
    "Discovery/Web-Content/raft-small-directories.txt, every 13th line. $LIST_NOTE" \
    ffuf -s -rate 100 -w "$LISTS/ffuf-raft.txt" -u "$TARGET/FUZZ" \
    -H "User-Agent: $FFUF_UA scanners-ffuf-raft" -mc all -fc 404
  run nuclei-configs tune 10.66.1.3 ip6 "$rotate Target is the IPv6 loopback, the run marker. Templates $TEMPLATES_TAG." \
    nuclei -duc -ni -silent -u "http://[::1]:8080" -t "$TEMPLATES/http/exposures/configs" \
    -tags exposure,misconfig -rl 50 -c 10
  run nuclei-files test 10.66.2.3 ip6 "$rotate Target is the IPv6 loopback, the run marker. Templates $TEMPLATES_TAG." \
    nuclei -duc -ni -silent -u "http://[::1]:8080" -t "$TEMPLATES/http/exposures/files" \
    -t "$TEMPLATES/http/exposures/logs" -tags exposure,misconfig -rl 50 -c 10
  run nikto-a tune 10.66.1.4 "ua:$NIKTO_UA scanners-nikto-a|() { :; };" "$shock" \
    nikto -host 127.0.0.1 -port 8080 -Tuning 2 -maxtime 60s -nointeractive -ask no \
    -useragent "$NIKTO_UA scanners-nikto-a"
  run nikto-b test 10.66.2.4 "ua:$NIKTO_UA scanners-nikto-b|() { :; };" "$shock" \
    nikto -host 127.0.0.1 -port 8080 -Tuning 3 -maxtime 60s -nointeractive -ask no \
    -useragent "$NIKTO_UA scanners-nikto-b"
  wait
}

if [[ "${1:-}" != cut ]]; then
  : >"$WORK/runs.tsv"
  stack_up
  trap stack_down EXIT
  prepare_lists
  record
  sleep 3
fi
while IFS=$'\t' read -r name side ip marker start end note; do
  cut_run "$name" "$side" "$ip" "$marker" "$start" "$end" "$note"
done <"$WORK/runs.tsv"
