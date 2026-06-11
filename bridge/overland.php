<?php
/**
 * Baken — Overland (iOS) -> Traccar OsmAnd bridge.
 *
 * Why this exists:
 *   The Overland app speaks its own JSON dialect. Traccar has a built-in
 *   "overland" decoder, but its port can be awkward to bind reliably in the
 *   Docker image — and it isn't needed. Traccar's OsmAnd endpoint already works
 *   perfectly and accepts BOTH accuracy and battery level. This script receives
 *   the Overland batch and converts each location into an OsmAnd request. So the
 *   iPhone's data (battery + real accuracy) flows in over the proven route, with
 *   Traccar's own Overland decoder left out of the picture entirely.
 *
 * Privacy/security: identification is by the random device id (same model as the
 * Traccar Client / OsmAnd publish). No passwords here.
 *
 * Configuration via environment (set in your reverse proxy / php-fpm pool):
 *   BAKEN_OSMAND_URL          Traccar OsmAnd endpoint   (default http://127.0.0.1:5055/)
 *   BAKEN_DEFAULT_DEVICE_ID   fallback device id if Overland sends none (default: empty)
 *   BAKEN_MAX_POINTS          max points forwarded per request (default 50)
 *
 * Recommended: set the Overland app's "Device ID" to the Traccar device's
 * identifier and leave BAKEN_DEFAULT_DEVICE_ID empty.
 */

header('Content-Type: application/json');

define('OSMAND_URL', getenv('BAKEN_OSMAND_URL') ?: 'http://127.0.0.1:5055/');
define('DEFAULT_ID', getenv('BAKEN_DEFAULT_DEVICE_ID') ?: '');

// Alleen de recentste punten doorzetten. Overland buffert offline en kan in
// één POST duizenden oude punten dumpen; die één-voor-één doorzetten loopt
// tegen de Apache-timeout (504), waarna Overland de queue NIET leegt en de
// hele berg opnieuw stuurt -- een vicieuze cirkel. Voor live tracking telt
// alleen de actuele positie, dus we verwerken hooguit de laatste N en geven
// ALTIJD snel een 2xx terug zodat de queue geleegd wordt.
define('MAX_POINTS', (int)(getenv('BAKEN_MAX_POINTS') ?: 50));

$raw  = file_get_contents('php://input');
$data = json_decode($raw, true);

// Overland blijft een batch herhalen tot het een 2xx met {"result":"ok"} krijgt.
if (!is_array($data) || empty($data['locations'])) {
    echo json_encode(['result' => 'ok']);
    exit;
}

// Locaties staan chronologisch (oudste eerst) -> pak de nieuwste staart.
$locations = $data['locations'];
$total = count($locations);
if ($total > MAX_POINTS) {
    $locations = array_slice($locations, -MAX_POINTS);
}

/** Stuur één OsmAnd-positie door; geef HTTP-code terug. */
function osmand_publish(array $params): int
{
    $ch = curl_init(OSMAND_URL . '?' . http_build_query($params));
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 2);
    curl_setopt($ch, CURLOPT_POST, true);   // OsmAnd accepteert GET of POST
    curl_setopt($ch, CURLOPT_POSTFIELDS, '');
    curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return $code;
}

$ok = 0;
$fail = 0;

foreach ($locations as $loc) {
    $p = $loc['properties'] ?? [];
    $g = $loc['geometry']['coordinates'] ?? null;
    if (!is_array($g) || count($g) < 2) {
        continue;
    }

    // Device id: prefer what Overland sends ("Device ID" field), else fallback.
    // No id at all -> skip this point (Traccar would reject it anyway).
    $devId = !empty($p['device_id']) ? $p['device_id'] : DEFAULT_ID;
    if ($devId === '') {
        continue;
    }

    // GeoJSON: [lon, lat]
    $params = [
        'id'  => $devId,
        'lat' => $g[1],
        'lon' => $g[0],
    ];

    if (!empty($p['timestamp'])) {
        $ts = strtotime($p['timestamp']);
        if ($ts) {
            $params['timestamp'] = $ts;
        }
    }
    if (isset($p['horizontal_accuracy'])) {
        $params['accuracy'] = $p['horizontal_accuracy'];
    }
    if (isset($p['altitude'])) {
        $params['altitude'] = $p['altitude'];
    }
    if (isset($p['course']) && $p['course'] >= 0) {
        $params['bearing'] = $p['course'];
    }
    if (isset($p['speed']) && $p['speed'] >= 0) {
        // Overland: m/s  ->  OsmAnd verwacht knopen
        $params['speed'] = round($p['speed'] * 1.943844, 2);
    }
    if (isset($p['battery_level']) && $p['battery_level'] >= 0) {
        $params['batt'] = round($p['battery_level'] * 100);
    }

    $code = osmand_publish($params);
    if ($code >= 200 && $code < 300) {
        $ok++;
    } else {
        $fail++;
    }
}

// Altijd 'ok' -> Overland leegt zijn queue, ook als enkele punten faalden of
// als we een grote backlog hebben ingekort.
echo json_encode([
    'result'    => 'ok',
    'received'  => $total,
    'forwarded' => $ok,
    'failed'    => $fail,
]);
