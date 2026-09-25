#!/bin/sh
# Toetst pruner/prune.php tegen een nep-Traccar: welke vensters er weg gaan,
# dat de nieuwste positie blijft, en dat fouten luid zijn.
# Draaien: sh tests/pruner/prune.test.sh   (vereist php met curl)
set -eu
cd "$(dirname "$0")/../.."
PORT=18084
export FAKE_NOW=$(date +%s)
export FAKE_LOG=$(mktemp)
php -S 127.0.0.1:$PORT tests/pruner/fake-traccar.php >/dev/null 2>&1 & p1=$!
trap 'kill $p1 2>/dev/null; rm -f "$FAKE_LOG"' EXIT
sleep 1
fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   - $1"; else echo "FAIL - $1: got '$2', want '$3'"; fail=1; fi; }
iso() { php -r "echo gmdate('Y-m-d\TH:i:s\Z', $1);"; }
run() {
  : > "$FAKE_LOG"
  env BAKEN_TRACCAR_URL=http://127.0.0.1:$PORT/ BAKEN_PRUNER_EMAIL=pruner@test BAKEN_PRUNER_PASSWORD=goed \
      BAKEN_RETENTION_HOURS=24 "$@" php pruner/prune.php >/dev/null 2>&1 && echo 0 || echo 1
}

# Een gewone ronde. Dirk weigert Traccar, dus de ronde eindigt op 1 — maar de
# anderen zijn wel opgeschoond.
check "een geweigerd apparaat maakt de ronde rood" "$(run)" "1"
check "Anna, Bram en Dirk krijgen een DELETE, Cas (nooit iets gestuurd) niet" "$(cut -d' ' -f1 "$FAKE_LOG" | tr '\n' ' ')" "1 2 4 "
check "alles vanaf het begin" "$(awk '$1==1{print $2}' "$FAKE_LOG")" "1970-01-01T00:00:00Z"
anna_to=$(awk '$1==1{print $3}' "$FAKE_LOG")
lo=$(iso $((FAKE_NOW - 86400 - 5))); hi=$(iso $((FAKE_NOW - 86400 + 30)))
check "Anna: tot 24 uur geleden" "$( [ "$anna_to" \> "$lo" ] && [ "$anna_to" \< "$hi" ] && echo ja || echo "$anna_to")" "ja"
check "Bram: tot één seconde vóór zijn nieuwste positie" "$(awk '$1==2{print $3}' "$FAKE_LOG")" "$(iso $((FAKE_NOW - 30 * 3600 - 1)))"

check "dry-run: ronde slaagt" "$(run BAKEN_PRUNE_DRY_RUN=1)" "0"
check "dry-run: niets verwijderd" "$(wc -l < "$FAKE_LOG" | tr -d ' ')" "0"

floor=$(iso $((FAKE_NOW - 72 * 3600)))
run BAKEN_PRUNE_FLOOR=$floor >/dev/null
check "vloer: venster begint één seconde na de vloer" "$(awk '$1==1{print $2}' "$FAKE_LOG")" "$(iso $((FAKE_NOW - 72 * 3600 + 1)))"

check "termijn leeg: uit, geen fout" "$(run BAKEN_RETENTION_HOURS=)" "0"
check "termijn leeg: niets verwijderd" "$(wc -l < "$FAKE_LOG" | tr -d ' ')" "0"
check "termijn 0: uit" "$(run BAKEN_RETENTION_HOURS=0)" "0"
check "termijn '24u': fout" "$(run BAKEN_RETENTION_HOURS=24u)" "1"
check "termijn '24u': niets verwijderd" "$(wc -l < "$FAKE_LOG" | tr -d ' ')" "0"
check "zonder wachtwoord: fout" "$(run BAKEN_PRUNER_PASSWORD=)" "1"
check "verkeerd wachtwoord: fout" "$(run BAKEN_PRUNER_PASSWORD=fout)" "1"
check "verkeerd wachtwoord: niets verwijderd" "$(wc -l < "$FAKE_LOG" | tr -d ' ')" "0"
check "onleesbare vloer: fout" "$(run BAKEN_PRUNE_FLOOR=gisteren-ofzo)" "1"
check "onleesbare vloer: niets verwijderd" "$(wc -l < "$FAKE_LOG" | tr -d ' ')" "0"
check "Traccar onbereikbaar: fout" "$(run BAKEN_TRACCAR_URL=http://127.0.0.1:1/)" "1"
exit $fail
