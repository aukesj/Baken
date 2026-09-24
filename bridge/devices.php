<?php
/**
 * Baken — de apparatenlijst, zonder de sleutel waarmee je posities kunt posten.
 *
 * Waarom dit bestaat:
 *   Traccar geeft bij GET /api/devices het hele apparaat-record terug, inclusief
 *   `uniqueId`. Bij Traccar is dat geen naam maar een sleutel: het OsmAnd-
 *   endpoint (/track) accepteert ?id=<uniqueId>&lat=..&lon=.. zonder login. Wie
 *   de viewer mag gebruiken, kon dus posities posten in naam van een ander.
 *
 *   De proxy stuurt /api/devices daarom hierheen. Dit script stelt Traccar
 *   dezelfde vraag met de eigen sessie (cookie) of Basic-auth van de aanroeper
 *   — wie welk apparaat mag zien blijft dus volledig Traccars beslissing — en
 *   laat alleen dat ene veld weg. De viewer gebruikt het niet.
 *
 *   Alleen GET: apparaten beheer je in de Traccar-UI (via de SSH-tunnel), niet
 *   via de publieke proxy.
 *
 * Configuratie via environment:
 *   BAKEN_TRACCAR_URL   Traccar web/API   (default http://127.0.0.1:8082/)
 */

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, private, max-age=0');

function fail(int $code, string $msg): void
{
    http_response_code($code);
    echo json_encode(['error' => $msg]);
    exit;
}

/** Het apparaat-record zonder de sleutel. */
function strip_unique_ids(array $devices): array
{
    return array_map(static function ($d) {
        if (is_array($d)) {
            unset($d['uniqueId']);
        }
        return $d;
    }, $devices);
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method !== 'GET' && $method !== 'HEAD') {
    header('Allow: GET');
    fail(405, 'method not allowed');
}

$base = rtrim(getenv('BAKEN_TRACCAR_URL') ?: 'http://127.0.0.1:8082/', '/');
// Traccars eigen queryparameters (?id=, ?all=) blijven werken: die bepalen
// wélke apparaten terugkomen, nooit óf je ze mag zien.
$query = (string) ($_SERVER['QUERY_STRING'] ?? '');
$url = $base . '/api/devices' . ($query !== '' ? '?' . $query : '');

$headers = ['Accept: application/json'];
if (!empty($_SERVER['HTTP_COOKIE'])) {
    $headers[] = 'Cookie: ' . $_SERVER['HTTP_COOKIE'];
}
if (!empty($_SERVER['HTTP_AUTHORIZATION'])) {
    $headers[] = 'Authorization: ' . $_SERVER['HTTP_AUTHORIZATION'];
}

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 5,
    CURLOPT_HTTPHEADER     => $headers,
]);
$body = curl_exec($ch);
$code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);

$devices = is_string($body) && $body !== '' ? json_decode($body, true) : null;
if ($code !== 200 || !is_array($devices)) {
    // Traccars eigen oordeel doorgeven (een 401 moet een 401 blijven, zodat de
    // viewer stil opnieuw inlogt); alleen verzinnen als het onleesbaar is.
    fail($code >= 400 && $code <= 599 ? $code : 502, 'traccar refused');
}

header('X-Baken-Filtered: uniqueId');
echo json_encode(strip_unique_ids($devices));
