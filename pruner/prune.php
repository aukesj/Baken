<?php
/**
 * Baken — de pruner: verwijdert posities ouder dan de bewaartermijn.
 *
 * Waarom dit bestaat:
 *   Traccar bewaart elke positie voor altijd; er is geen bewaartermijn voor
 *   posities. Voor een privacy-first dienst is dat het verkeerde uitgangspunt:
 *   wie live meekijkt heeft niets aan het spoor van vorige maand, en wat niet
 *   bewaard is kan ook niet uitlekken. Dus doet dit het: per ronde, per
 *   apparaat, alles ouder dan BAKEN_RETENTION_HOURS weg.
 *
 *   De nieuwste positie van een apparaat blijft altijd staan, ook als die
 *   ouder is dan de termijn: dat is de rij die de kaart tekent. Een telefoon
 *   die uit staat blijft dus zichtbaar met "laatst gezien", zonder spoor.
 *
 * Het account:
 *   Een eigen Traccar-gebruiker, zo smal als deze taak toelaat. Gemeten op 6.5:
 *     administrator=false   ziet alleen apparaten die aan hem gekoppeld zijn;
 *                           een DELETE op een ander apparaat geeft 400
 *     disableReports=true   mag GEEN geschiedenis lezen (400), wel verwijderen (204)
 *     readonly=false        nodig; readonly krijgt 400 op DELETE
 *   Koppel het aan een groep met alle apparaten: een apparaat dat later in die
 *   groep komt, ziet de pruner vanzelf. Een apparaat buiten de groep wordt
 *   nooit opgeschoond. Zie docs/ADMIN.md.
 *
 *   Doordat het account niets mag lezen, kan deze ronde niet zeggen hoeveel
 *   posities hij weggooit. Tellen zou betekenen dat dit account ieders
 *   geschiedenis mag inzien; een logregel zonder aantal is de betere ruil.
 *
 * Configuratie via environment:
 *   BAKEN_RETENTION_HOURS    bewaartermijn in uren; leeg of 0 = uit
 *   BAKEN_TRACCAR_URL        Traccar web/API (default http://127.0.0.1:8082/)
 *   BAKEN_PRUNER_EMAIL       login van het pruner-account
 *   BAKEN_PRUNER_PASSWORD    wachtwoord van het pruner-account
 *   BAKEN_PRUNE_FLOOR        optioneel: niets op of vóór dit moment (ISO 8601)
 *                            wordt verwijderd, bv. om een bestaand archief te sparen
 *   BAKEN_PRUNE_DRY_RUN      1 = alleen zeggen wat er weg zou gaan
 *
 *   php pruner/prune.php [--dry-run]
 *
 * Exitcode 0 bij een geslaagde ronde (of als de pruner uit staat), anders 1.
 */

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require __DIR__ . '/prune-lib.php';

function prune_log(string $msg): void
{
    echo gmdate('c') . ' prune: ' . $msg . "\n";
}

function prune_die(string $msg): never
{
    fwrite(STDERR, gmdate('c') . ' prune: ' . $msg . "\n");
    exit(1);
}

function env(string $k, string $default = ''): string
{
    $v = getenv($k);
    return ($v === false || $v === '') ? $default : $v;
}

/** Eén verzoek aan Traccar als de pruner. Geeft [status, body]. */
function traccar(string $method, string $path): array
{
    $ch = curl_init(rtrim(env('BAKEN_TRACCAR_URL', 'http://127.0.0.1:8082/'), '/') . $path);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST  => $method,
        CURLOPT_TIMEOUT        => $method === 'DELETE' ? 120 : 15,
        CURLOPT_HTTPHEADER     => ['Accept: application/json'],
        CURLOPT_USERPWD        => env('BAKEN_PRUNER_EMAIL') . ':' . env('BAKEN_PRUNER_PASSWORD'),
    ]);
    $body = curl_exec($ch);
    $err  = curl_error($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($body === false) {
        prune_die("Traccar unreachable ($method $path): $err");
    }
    return [$code, (string) $body];
}

/** GET die een lijst moet opleveren; anders stopt de ronde. */
function traccar_list(string $path): array
{
    [$code, $body] = traccar('GET', $path);
    if ($code !== 200) {
        prune_die("Traccar answered $code on GET $path" . ($code === 401 ? ' (check the pruner account)' : ''));
    }
    $list = json_decode($body, true);
    if (!is_array($list)) {
        prune_die("Traccar did not answer with a list on GET $path");
    }
    return $list;
}

// ---- configuratie --------------------------------------------------------

$dryRun = in_array('--dry-run', array_slice($argv, 1), true) || env('BAKEN_PRUNE_DRY_RUN') === '1';

try {
    $hours = prune_hours(env('BAKEN_RETENTION_HOURS'));
} catch (InvalidArgumentException $e) {
    prune_die($e->getMessage());
}
if ($hours === null) {
    prune_log('off (BAKEN_RETENTION_HOURS is empty or 0): Traccar keeps every position');
    exit(0);
}
foreach (['BAKEN_PRUNER_EMAIL', 'BAKEN_PRUNER_PASSWORD'] as $k) {
    if (env($k) === '') {
        prune_die("$k is missing: without a pruner account nothing is pruned (see docs/ADMIN.md)");
    }
}

$floor = null;
if (env('BAKEN_PRUNE_FLOOR') !== '') {
    $floor = strtotime(env('BAKEN_PRUNE_FLOOR'));
    if ($floor === false) {
        prune_die('BAKEN_PRUNE_FLOOR is not a timestamp I can read: ' . env('BAKEN_PRUNE_FLOOR'));
    }
}

// ---- één ronde -----------------------------------------------------------

$now     = time();
$cut     = $now - $hours * 3600;
// Eerst de nieuwste posities, dan de apparaten. Een positie die daartussen
// binnenkomt is nieuwer dan wat we als nieuwste kennen en valt dus buiten
// elk venster; de volgorde kan niets verkeerds laten verdwijnen.
$newest  = prune_newest(traccar_list('/api/positions'));
$devices = traccar_list('/api/devices');

$done = $skipped = $failed = 0;
foreach ($devices as $d) {
    if (!is_array($d) || !isset($d['id'])) {
        continue;
    }
    $id   = (int) $d['id'];
    $name = (string) ($d['name'] ?? '?');

    if (!isset($newest[$id])) {
        // Nooit iets gestuurd, of de nieuwste rij is al weg. Luid, want het
        // tweede is een fout en een stille skip zou die verbergen.
        prune_log("device $id ($name): no newest position known, skipped");
        $skipped++;
        continue;
    }

    $window = prune_window($cut, $newest[$id], $floor);
    if ($window === null) {
        $skipped++;
        continue;
    }
    [$from, $to] = [prune_stamp($window[0]), prune_stamp($window[1])];

    if ($dryRun) {
        prune_log("WOULD delete device $id ($name) from $from to $to (newest " . prune_stamp($newest[$id]) . ' stays)');
        $done++;
        continue;
    }

    // deviceId, from en to alle drie: zonder deviceId weigert Traccar 6.5 (400).
    [$code] = traccar('DELETE', '/api/positions?' . http_build_query(['deviceId' => $id, 'from' => $from, 'to' => $to]));
    if ($code === 204 || $code === 200) {
        $done++;
        continue;
    }
    // Niet fataal voor de hele ronde: één geweigerd apparaat mag de rest niet tegenhouden.
    prune_log("device $id ($name): Traccar answered $code on the DELETE");
    $failed++;
}

prune_log(sprintf(
    '%s%d device(s) pruned up to %s, %d skipped, %d failed (retention %d h%s, %d devices visible to the pruner)',
    $dryRun ? 'DRY-RUN: ' : '',
    $done,
    prune_stamp($cut),
    $skipped,
    $failed,
    $hours,
    $floor === null ? '' : ', floor ' . prune_stamp($floor),
    count($devices)
));

exit($failed > 0 ? 1 : 0);
