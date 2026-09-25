<?php
/**
 * Baken — de beslissingen van de pruner, los van het uitvoeren.
 *
 * Geen HTTP en geen bijwerkingen, zodat tests/pruner/prune-lib.test.php de
 * regels die schade kunnen doen kan vastpinnen zonder Traccar:
 *
 *   - de nieuwste positie van een apparaat valt nooit in het verwijdervenster;
 *   - niets op of vóór de vloer (BAKEN_PRUNE_FLOOR) wordt aangeraakt.
 *
 * pruner/prune.php is de uitvoerder: configuratie, HTTP, logregels.
 * Overgenomen uit Trace (TRAC-79), zonder de keuze per persoon (TRAC-80).
 */

declare(strict_types=1);

// Traccars bovengrens bij DELETE /api/positions is inclusief: gemeten op 6.5
// verwijdert `to` gelijk aan de fixTime van een positie die positie ook. De
// nieuwste sparen betekent dus ervóór stoppen; een seconde marge is goedkoper
// dan erop rekenen dat Traccar milliseconden parseert.
const PRUNE_NEWEST_MARGIN = 1;

/**
 * Het venster om te verwijderen voor één apparaat, of null als er niets te doen is.
 *
 * @param int      $cut    nu min de bewaartermijn
 * @param int      $newest fixTime van de nieuwste positie; die moet blijven
 * @param int|null $floor  niets op of vóór dit moment wordt verwijderd; null = geen vloer
 * @return array{0:int,1:int}|null [van, tot], allebei inclusief voor Traccar
 */
function prune_window(int $cut, int $newest, ?int $floor = null, int $margin = PRUNE_NEWEST_MARGIN): ?array
{
    // Twee plafonds, de laagste wint. De bewaartermijn is het doel; de nieuwste
    // positie is de uitzondering die een apparaat op de kaart houdt, ook als de
    // telefoon al een dag uit staat. Verdwijnt die, dan wijst Traccars
    // device.positionId naar een rij die niet meer bestaat en valt het apparaat
    // uit /api/positions tot er een nieuwe positie binnenkomt (gemeten op 6.5).
    $to = min($cut, $newest - $margin);
    $from = $floor === null ? 0 : $floor + 1;
    if ($to < $from) {
        return null;
    }
    return [$from, $to];
}

/**
 * De nieuwste positie per apparaat uit Traccars GET /api/positions zonder
 * parameters: één rij per apparaat, de recentste. Rijen zonder leesbare tijd
 * vallen weg; zo'n apparaat wordt overgeslagen i.p.v. geraden.
 *
 * @return array<int,int> deviceId => unix-tijd van de nieuwste fix
 */
function prune_newest(array $positions): array
{
    $out = [];
    foreach ($positions as $p) {
        if (!is_array($p) || !isset($p['deviceId'])) {
            continue;
        }
        $fix = (string) ($p['fixTime'] ?? $p['deviceTime'] ?? $p['serverTime'] ?? '');
        $ts = $fix === '' ? false : strtotime($fix);
        if ($ts === false) {
            continue;
        }
        $id = (int) $p['deviceId'];
        if (!isset($out[$id]) || $ts > $out[$id]) {
            $out[$id] = $ts;
        }
    }
    return $out;
}

/**
 * De bewaartermijn in uren uit de configuratie. Leeg of 0 = uit (null).
 * Iets anders dan een positief geheel getal is een fout, geen stille default:
 * een tikfout mag hier niet ongemerkt "alles weg" of "niets weg" worden.
 */
function prune_hours(string $raw): ?int
{
    $raw = trim($raw);
    if ($raw === '' || $raw === '0') {
        return null;
    }
    if (!preg_match('/^[1-9][0-9]*$/', $raw)) {
        throw new InvalidArgumentException("BAKEN_RETENTION_HOURS must be a positive whole number, not '$raw'");
    }
    return (int) $raw;
}

/** Traccar wil UTC op de seconde, zonder milliseconden. */
function prune_stamp(int $ts): string
{
    return gmdate('Y-m-d\TH:i:s\Z', $ts);
}
