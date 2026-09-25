<?php
// Toetst de beslissingen van de pruner (pruner/prune-lib.php), zonder Traccar.
// Draaien: php tests/pruner/prune-lib.test.php
//
// De twee regels die schade doen als ze omvallen:
//   - verdwijnt de nieuwste positie, dan valt dat apparaat van de kaart tot er
//     een nieuwe binnenkomt — bij een telefoon die uit staat: nooit;
//   - verschuift de vloer, dan gaat een archief weg dat niet terug te halen is.
declare(strict_types=1);

require __DIR__ . '/../../pruner/prune-lib.php';

$pass = $fail = 0;
function check(string $what, $want, $got): void
{
    global $pass, $fail;
    if ($want === $got) { $pass++; echo "ok   - $what\n"; }
    else { $fail++; echo "FAIL - $what: want " . var_export($want, true) . ', got ' . var_export($got, true) . "\n"; }
}

$H = 3600;
$now = strtotime('2026-09-25T12:00:00Z');   // vast, dus los van de klok
$cut = $now - 24 * $H;

// Het gewone geval: een telefoon die nu nog stuurt.
check('van het begin tot de termijn', [0, $cut], prune_window($cut, $now - 60));

// Een telefoon die al 30 uur niets stuurt: de nieuwste positie valt binnen
// de termijn-grens en moet blijven.
$stale = $now - 30 * $H;
$w = prune_window($cut, $stale);
check('stopt vóór de nieuwste positie', [0, $stale - 1], $w);
check('de nieuwste valt erbuiten', true, $w[1] < $stale);

// De marge bestaat omdat Traccars bovengrens inclusief is (gemeten op 6.5).
check('zonder marge zou de nieuwste erin vallen', $stale, prune_window($cut, $stale, null, 0)[1]);
check('nieuwste op 0 geeft niets', null, prune_window($cut, 0));

// De vloer: niets op of vóór dat moment.
$floor = $now - 72 * $H;
check('met vloer begint het venster erna', [$floor + 1, $cut], prune_window($cut, $now, $floor));
check('termijn vóór de vloer geeft niets', null, prune_window($floor - $H, $now, $floor));
check('termijn precies op de vloer geeft niets', null, prune_window($floor, $now, $floor));
check('nieuwste vlak na de vloer geeft niets', null, prune_window($cut, $floor + 1, $floor));
check('nieuwste twee seconden na de vloer: alleen die ene seconde', [$floor + 1, $floor + 1], prune_window($cut, $floor + 2, $floor));

// De nieuwste positie per apparaat uit GET /api/positions.
$newest = prune_newest([
    ['deviceId' => 1, 'fixTime' => '2026-09-25T11:00:00.000+00:00'],
    ['deviceId' => 1, 'fixTime' => '2026-09-25T10:00:00.000+00:00'],   // ouder: telt niet
    ['deviceId' => 2, 'deviceTime' => '2026-09-24T06:00:00Z'],          // terugval op deviceTime
    ['deviceId' => 3, 'fixTime' => 'onzin'],                            // onleesbaar: weg
    ['fixTime' => '2026-09-25T11:00:00Z'],                              // geen apparaat: weg
    'geen rij',
]);
check('de recentste per apparaat', strtotime('2026-09-25T11:00:00Z'), $newest[1] ?? null);
check('deviceTime als fixTime ontbreekt', strtotime('2026-09-24T06:00:00Z'), $newest[2] ?? null);
check('onleesbare tijd: apparaat overgeslagen', false, isset($newest[3]));
check('precies twee apparaten', 2, count($newest));

// De termijn uit de configuratie.
check('leeg = uit', null, prune_hours(''));
check('0 = uit', null, prune_hours('0'));
check('24 = 24', 24, prune_hours(' 24 '));
foreach (['24u', '-5', '1.5', 'abc', '024'] as $bad) {
    $threw = false;
    try { prune_hours($bad); } catch (InvalidArgumentException $e) { $threw = true; }
    check("'$bad' is een fout, geen stille default", true, $threw);
}

check('tijdstempel op de seconde, in UTC', '2026-09-25T12:00:00Z', prune_stamp($now));

echo "\n$pass ok, $fail failed\n";
exit($fail > 0 ? 1 : 0);
