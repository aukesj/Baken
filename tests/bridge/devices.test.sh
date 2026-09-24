#!/bin/sh
# Toetst bridge/devices.php tegen een nep-Traccar: de sleutel (uniqueId) gaat
# eruit, de rechten blijven die van Traccar, en alleen GET mag.
# Draaien: sh tests/bridge/devices.test.sh   (vereist php met curl)
set -eu
cd "$(dirname "$0")/../.."
FAKE=18082 BRIDGE=18083
php -S 127.0.0.1:$FAKE tests/bridge/fake-traccar.php >/dev/null 2>&1 & p1=$!
BAKEN_TRACCAR_URL=http://127.0.0.1:$FAKE/ php -S 127.0.0.1:$BRIDGE -t bridge >/dev/null 2>&1 & p2=$!
trap 'kill $p1 $p2 2>/dev/null' EXIT
sleep 1
fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   - $1"; else echo "FAIL - $1: got '$2', want '$3'"; fail=1; fi; }
U=http://127.0.0.1:$BRIDGE/devices.php

body=$(curl -s -H 'Cookie: JSESSIONID=good' $U)
check "the list comes through" "$(echo "$body" | php -r 'echo count(json_decode(stream_get_contents(STDIN), true));')" "2"
check "no uniqueId in the answer" "$(echo "$body" | grep -c uniqueId || true)" "0"
check "names are kept" "$(echo "$body" | php -r 'echo json_decode(stream_get_contents(STDIN), true)[1]["name"];')" "Bram"
check "Traccar's query parameters still work" "$(curl -s -H 'Cookie: JSESSIONID=good' "$U?id=2" | php -r 'echo count(json_decode(stream_get_contents(STDIN), true));')" "1"
check "no session stays a 401" "$(curl -s -o /dev/null -w '%{http_code}' $U)" "401"
check "a wrong session stays a 401" "$(curl -s -o /dev/null -w '%{http_code}' -H 'Cookie: JSESSIONID=bad' $U)" "401"
check "POST is refused" "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Cookie: JSESSIONID=good' $U)" "405"
check "never cached" "$(curl -s -D - -o /dev/null -H 'Cookie: JSESSIONID=good' $U | grep -ci '^cache-control: no-store')" "1"
exit $fail
