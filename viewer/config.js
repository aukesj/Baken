// Baken — standaardinstellingen / default settings.
// Persoonlijke voorkeuren (getoonde personen, plaatsen, meldingen, thema, taal)
// worden per telefoon in de browser bewaard, niet hier.
// Personal preferences (shown people, places, notifications, theme, language)
// are stored per-device in the browser, not here.
window.BAKEN_CONFIG = {
  brandName: "Baken",   // naam in titel, login en meldingen / shown in title, login, notifications
  refreshMs: 30000,     // basis ververs-interval; verkort automatisch bij beweging
  zoom: 15,             // zoom bij centreren / zoom when centering
  showAddress: true,    // straatnaam tonen via server-side /geocode
  defaultRadius: 150,   // standaard straal (m) voor een nieuwe plaats
  routingUrl: "",       // optioneel OSRM-endpoint voor weg-volgende schatting; leeg = rechte lijn
};
