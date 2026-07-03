// Eenvoudige vertaling. t("key", {a:1}) → string. Taal: opgeslagen voorkeur,
// anders de OS-taal (navigator.language), default Nederlands.
window.I18N = (function () {
  const dict = {
    nl: {
      login_sub: "Log in om de kaart te zien",
      user: "gebruikersnaam", pass: "wachtwoord", login: "Inloggen",
      login_err: "Onjuiste gebruikersnaam of wachtwoord", conn_err: "Verbinding mislukt",
      settings: "Instellingen", theme: "Thema", light: "Licht", dark: "Donker", system: "Systeem",
      language: "Taal", who: "Wie tonen", notifs: "Meldingen", logout: "Uitloggen", close: "Sluiten",
      logout_confirm: "Weet je zeker dat je wilt uitloggen?",
      map: "Kaart", map_standard: "Standaard", map_roads: "Wegen", map_dark: "Donker",
      last_seen: "Laatst gezien", moving: "onderweg", just_now: "zojuist",
      min_ago: "{n} min geleden", hr_ago: "{n} uur geleden", day_ago: "{n} dag(en) geleden",
      place_here: "Plek hier", name_ph: "naam (bv. thuis)", save: "Bewaar", del: "Verwijder",
      rename: "Naam wijzigen", new_place: "Nieuwe plek", notify: "Melding",
      notify_when: "Meld wanneer {who}", arrives: "komt aan", leaves: "vertrekt",
      once: "alleen één keer", save_notif: "Meld dit", choose_place: "Kies plaats",
      no_notifs: "Geen meldingen ingesteld.", no_places_yet: "Nog geen plaatsen.",
      arrived: "{who} is aangekomen op {place}", left: "{who} heeft {place} verlaten",
      notif_arrive: "{who} komt aan op {place}", notif_leave: "{who} vertrekt van {place}",
      notif_once_tag: "(eenmalig)", no_pos: "nog geen positie",
    },
    en: {
      login_sub: "Log in to see the map",
      user: "username", pass: "password", login: "Log in",
      login_err: "Wrong username or password", conn_err: "Connection failed",
      settings: "Settings", theme: "Theme", light: "Light", dark: "Dark", system: "System",
      language: "Language", who: "Who to show", notifs: "Notifications", logout: "Log out", close: "Close",
      logout_confirm: "Are you sure you want to log out?",
      map: "Map", map_standard: "Standard", map_roads: "Roads", map_dark: "Dark",
      last_seen: "Last seen", moving: "moving", just_now: "just now",
      min_ago: "{n} min ago", hr_ago: "{n} hr ago", day_ago: "{n} day(s) ago",
      place_here: "Place here", name_ph: "name (e.g. home)", save: "Save", del: "Delete",
      rename: "Rename", new_place: "New place", notify: "Notify",
      notify_when: "Notify when {who}", arrives: "arrives", leaves: "leaves",
      once: "only once", save_notif: "Notify me", choose_place: "Choose place",
      no_notifs: "No notifications set.", no_places_yet: "No places yet.",
      arrived: "{who} arrived at {place}", left: "{who} left {place}",
      notif_arrive: "{who} arrives at {place}", notif_leave: "{who} leaves {place}",
      notif_once_tag: "(once)", no_pos: "no position yet",
    },
  };
  let lang = "nl";
  function resolve(pref) {
    if (pref === "nl" || pref === "en") return pref;
    const os = (navigator.language || "nl").slice(0, 2).toLowerCase();
    return os === "en" ? "en" : "nl";
  }
  function setLang(pref) { lang = resolve(pref); document.documentElement.lang = lang; }
  function t(key, vars) {
    let s = (dict[lang] && dict[lang][key]) || (dict.nl[key]) || key;
    if (vars) for (const k in vars) s = s.replace("{" + k + "}", vars[k]);
    return s;
  }
  return { setLang, t, get lang() { return lang; } };
})();
