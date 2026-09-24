// Baken — standaardinstellingen / default settings.
// Persoonlijke voorkeuren (getoonde personen, plaatsen, meldingen, thema, taal)
// worden per telefoon in de browser bewaard, niet hier.
// Personal preferences (shown people, places, notifications, theme, language)
// are stored per-device in the browser, not here.
window.BAKEN_CONFIG = {
  brandName: "Baken",   // naam in titel, login en meldingen / shown in title, login, notifications
  refreshMs: 30000,     // basis ververs-interval; verkort automatisch bij beweging
  showAddress: true,    // straatnaam tonen via server-side /geocode (zie proxy/) / street name via the proxy's /geocode
  defaultRadius: 150,   // standaard straal (m) voor een nieuwe plaats / default radius (m) of a new place
  photoPath: "images/", // gezichtsfoto's <naam>.png; "" = alleen initialen / face photos <name>.png; "" = initials only
};
