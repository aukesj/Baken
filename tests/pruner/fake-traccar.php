<?php
// Nep-Traccar voor tests/pruner/prune.test.sh. Gedraagt zich zoals Traccar 6.5
// voor een pruner-account zonder beheer- en rapportrechten (gemeten):
//   GET    /api/positions   de nieuwste positie per gekoppeld apparaat
//   GET    /api/devices     de gekoppelde apparaten
//   DELETE /api/positions   204; zonder deviceId of voor een niet-gekoppeld
//                           apparaat 400. Elke DELETE komt in $FAKE_LOG.
header('Content-Type: application/json');
if (($_SERVER['PHP_AUTH_USER'] ?? '') !== 'pruner@test' || ($_SERVER['PHP_AUTH_PW'] ?? '') !== 'goed') {
    http_response_code(401); echo '{}'; return;
}
$now = (int) getenv('FAKE_NOW');
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$method = $_SERVER['REQUEST_METHOD'];
$iso = fn(int $t) => gmdate('Y-m-d\TH:i:s.000+00:00', $t);

$devices = [
    ['id' => 1, 'name' => 'Anna'],   // stuurt nog: nieuwste van 1 minuut geleden
    ['id' => 2, 'name' => 'Bram'],   // telefoon uit: nieuwste van 30 uur geleden
    ['id' => 3, 'name' => 'Cas'],    // nooit iets gestuurd
    ['id' => 4, 'name' => 'Dirk'],   // Traccar weigert de delete
];
$positions = [
    ['deviceId' => 1, 'fixTime' => $iso($now - 60)],
    ['deviceId' => 2, 'fixTime' => $iso($now - 30 * 3600)],
    ['deviceId' => 4, 'fixTime' => $iso($now - 60)],
];

if ($path === '/api/devices' && $method === 'GET') { echo json_encode($devices); return; }
if ($path === '/api/positions' && $method === 'GET') {
    if (isset($_GET['from'])) { http_response_code(400); echo '{}'; return; }   // disableReports
    echo json_encode($positions); return;
}
if ($path === '/api/positions' && $method === 'DELETE') {
    $id = $_GET['deviceId'] ?? '';
    file_put_contents(getenv('FAKE_LOG'), "$id {$_GET['from']} {$_GET['to']}\n", FILE_APPEND);
    http_response_code(($id === '' || $id === '4') ? 400 : 204);
    return;
}
http_response_code(404); echo '{}';
