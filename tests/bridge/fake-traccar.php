<?php
// Nep-Traccar voor tests/bridge/devices.test.sh: /api/devices geeft twee
// apparaten mét uniqueId terug, maar alleen met de juiste sessie-cookie.
header('Content-Type: application/json');
if (parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) !== '/api/devices') { http_response_code(404); echo '{}'; return; }
if (($_COOKIE['JSESSIONID'] ?? '') !== 'good') { http_response_code(401); echo '{}'; return; }
$all = [
    ['id' => 1, 'name' => 'Anna', 'uniqueId' => 'secret-1', 'status' => 'online'],
    ['id' => 2, 'name' => 'Bram', 'uniqueId' => 'secret-2', 'status' => 'offline'],
];
if (isset($_GET['id'])) $all = array_values(array_filter($all, fn($d) => $d['id'] == $_GET['id']));
echo json_encode($all);
