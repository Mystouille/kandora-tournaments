import type { Route } from "./+types/live.$slug.$stage";
import type mongoose from "mongoose";
import { connectToDatabase } from "../utils/dbConnection.server";
import { LeagueModel } from "../db/League";
import { slugify } from "../utils/slugify";
import { basePath } from "../utils/basePath";

/**
 * Public, unauthenticated live results overlay for a single bracket stage.
 *
 *   GET /live/:slug/:stage            e.g. /live/lfcr-2026/FINALE
 *   Optional query params:
 *     ?interval=30                    poll seconds (clamped 5..600, default 30)
 *     ?theme=transparent|dark|light   default "transparent" (OBS-friendly)
 *
 * This is a resource route (loader only, no default export): it returns a
 * self-contained barebones HTML document that bypasses the app chrome in
 * root.tsx entirely. The page reuses the existing public, server-cached
 * `/api/bracket-scores` endpoint and renders the chosen stage's standings and
 * per-game results, refreshing in place (no full reload) for streaming.
 */

interface ThemeTokens {
  bg: string;
  panel: string;
  fg: string;
  muted: string;
  border: string;
  shadow: string;
}

interface LiveConfig {
  leagueId: string;
  leagueName: string;
  slug: string;
  stage: string;
  view: "standings" | "games";
  index: number;
  apiBase: string;
  intervalMs: number;
  theme: string;
}

const THEMES: Record<string, ThemeTokens> = {
  transparent: {
    bg: "transparent",
    panel: "rgba(17,17,17,0.62)",
    fg: "#ffffff",
    muted: "rgba(255,255,255,0.7)",
    border: "rgba(255,255,255,0.14)",
    shadow: "0 1px 2px rgba(0,0,0,0.9)",
  },
  dark: {
    bg: "#0e0e0e",
    panel: "#181818",
    fg: "#f5f5f5",
    muted: "#a8a8a8",
    border: "#2a2a2a",
    shadow: "none",
  },
  light: {
    bg: "#ffffff",
    panel: "#f6f6f6",
    fg: "#141414",
    muted: "#666666",
    border: "#e2e2e2",
    shadow: "none",
  },
};

/** Escape text for safe interpolation into HTML element content/attributes. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escape a JSON string for embedding inside a <script> element. */
function escapeForScript(value: string): string {
  return value
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function styles(theme: ThemeTokens): string {
  return `
:root{--bg:${theme.bg};--panel:${theme.panel};--fg:${theme.fg};--muted:${theme.muted};--border:${theme.border};--shadow:${theme.shadow};}
*{box-sizing:border-box;}
html,body{margin:0;padding:0;}
body{background:var(--bg);color:var(--fg);font-family:ui-sans-serif,system-ui,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;font-size:16px;text-shadow:var(--shadow);-webkit-font-smoothing:antialiased;}
.wrap{padding:16px;max-width:760px;}
header{display:flex;align-items:baseline;gap:10px;margin-bottom:12px;}
header h1{font-size:20px;margin:0;font-weight:700;}
header .stage{font-size:14px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;}
header .status{margin-left:auto;font-size:11px;color:var(--muted);}
.block{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:12px;}
.block h2{font-size:12px;text-transform:uppercase;letter-spacing:.05em;margin:0 0 8px;color:var(--muted);font-weight:600;}
table{width:100%;border-collapse:collapse;}
th,td{text-align:left;padding:4px 6px;}
th{font-size:11px;color:var(--muted);font-weight:600;border-bottom:1px solid var(--border);}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums;}
.standings td.rank{width:2ch;color:var(--muted);}
.standings td.name{font-weight:600;}
.standings td.num{font-size:22px;font-weight:700;}
.game{margin-bottom:10px;}
.game:last-child{margin-bottom:0;}
.game-head{font-size:11px;color:var(--muted);margin-bottom:2px;}
.game-head .upcoming{color:#ffd23f;text-transform:uppercase;letter-spacing:.04em;font-weight:600;}
.game-head .live{color:#ff4d4f;text-transform:uppercase;letter-spacing:.04em;font-weight:700;}
.seats td{border-bottom:1px solid var(--border);}
.seats tr:last-child td{border-bottom:none;}
.seats td.place{width:2ch;font-weight:700;text-align:center;}
.place-1{color:#ffd23f;}
.place-4{color:#ff8a8a;}
.seats td.name .label{display:flex;align-items:center;gap:6px;min-width:0;}
.seats td.name .player{flex:none;}
.seats td.name .team{color:var(--muted);font-weight:400;font-size:12px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;}
.seats td.delta{font-size:18px;font-weight:700;}
td.delta.pos{color:#69db7c;}
td.delta.neg{color:#ff8a8a;}
.ent{display:flex;align-items:center;gap:7px;min-width:0;}
.ent .label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
img.logo{width:18px;height:18px;border-radius:3px;object-fit:cover;background:#fff;flex:none;}
img.avatar{width:18px;height:18px;border-radius:50%;object-fit:cover;background:rgba(255,255,255,.15);flex:none;}
.ph{display:inline-flex;align-items:center;justify-content:center;flex:none;color:var(--muted);border:1px solid var(--border);}
.ph.logo{width:18px;height:18px;border-radius:3px;}
.ph.avatar{width:18px;height:18px;border-radius:50%;}
.ph svg{width:12px;height:12px;}
.empty{color:var(--muted);font-size:13px;padding:4px 2px;}
`.trim();
}

/**
 * Dependency-free browser script (ES5-style for maximum OBS/CEF compatibility).
 * Must contain no backticks, no `${`, and no literal `</script>` sequence so it
 * embeds cleanly inside the server template literal and the <script> element.
 */
function clientScript(): string {
  return `
(function () {
  var CONFIG = JSON.parse(document.getElementById("live-config").textContent);
  var app = document.getElementById("app");
  var statusEl = document.getElementById("status");
  var TEAM_PICS = {};
  var TEAM_NAMES = {};

  function resolveImg(url) {
    if (!url) { return ""; }
    if (/^(https?:|data:)/.test(url)) { return url; }
    return CONFIG.apiBase + url;
  }
  function personaIcon(cls) {
    return "<span class='ph " + cls + "'><svg viewBox='0 0 1024 1024' width='12' height='12' fill='currentColor' aria-hidden='true'><path d='M858.5 763.6a374 374 0 00-80.6-119.5 375.63 375.63 0 00-119.5-80.6c-.4-.2-.8-.3-1.2-.5C719.5 518 760 444.7 760 362c0-137-111-248-248-248S264 225 264 362c0 82.7 40.5 156 102.8 201.1-.4.2-.8.3-1.2.5-44.8 18.9-85 46-119.5 80.6a375.63 375.63 0 00-80.6 119.5A371.7 371.7 0 00136 901.8a8 8 0 008 8.2h60c4.4 0 7.9-3.5 8-7.8 2-77.2 33-149.5 87.8-204.3 56.7-56.7 132-87.9 212.2-87.9s155.5 31.2 212.2 87.9C779 752.7 810 825 812 902.2c.1 4.4 3.6 7.8 8 7.8h60a8 8 0 008-8.2c-1-47.8-10.9-94.3-29.5-138.2zM512 534c-45.9 0-89.1-17.9-121.6-50.4S340 407.9 340 362c0-45.9 17.9-89.1 50.4-121.6S466.1 190 512 190s89.1 17.9 121.6 50.4S684 316.1 684 362c0 45.9-17.9 89.1-50.4 121.6S557.9 534 512 534z'/></svg></span>";
  }
  function imgTag(url, cls) {
    var u = resolveImg(url);
    if (!u) { return personaIcon(cls); }
    return "<img class='" + cls + "' src='" + esc(u).replace(/'/g, "%27") + "' alt='' />";
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function fmtSigned(n) {
    if (typeof n !== "number" || isNaN(n)) { return "\\u2013"; }
    return (n > 0 ? "+" : "") + n.toFixed(1);
  }
  function fmtScore(n) {
    if (typeof n !== "number" || isNaN(n)) { return "\\u2013"; }
    return n.toLocaleString();
  }
  function setStatus(t) { if (statusEl) { statusEl.textContent = t; } }
  function nowTime() {
    try { return new Date().toLocaleTimeString(); } catch (e) { return ""; }
  }

  function findPhase(phases) {
    if (!phases) { return null; }
    var keys = Object.keys(phases);
    var want = String(CONFIG.stage).toLowerCase();
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].toLowerCase() === want) {
        return { key: keys[i], phase: phases[keys[i]] };
      }
    }
    return null;
  }

  function renderStandings(phase) {
    var slots = (phase.slots || []).slice();
    slots.sort(function (a, b) {
      var as = a.score == null ? -Infinity : a.score;
      var bs = b.score == null ? -Infinity : b.score;
      return bs - as;
    });
    var rows = "";
    var lastScore = null;
    var rank = 0;
    for (var k = 0; k < slots.length; k++) {
      var s = slots[k];
      if (s.score != null && s.score !== lastScore) {
        rank = k + 1;
        lastScore = s.score;
      }
      var rankLabel = s.score == null ? "\\u2013" : rank;
      var scoreLabel = s.score == null ? "\\u2013" : fmtSigned(s.score);
      var logo = imgTag(s.teamId ? TEAM_PICS[s.teamId] : "", "logo");
      var label =
        s.teamId && TEAM_NAMES[s.teamId] ? TEAM_NAMES[s.teamId] : s.description;
      rows +=
        "<tr><td class='rank'>" + esc(rankLabel) +
        "</td><td class='name'><div class='ent'>" + logo +
        "<span class='label'>" + esc(label) + "</span></div>" +
        "</td><td class='num'>" + esc(scoreLabel) +
        "</td></tr>";
    }
    if (!rows) { return ""; }
    return (
      "<table class='standings'><thead><tr><th class='rank'>#</th>" +
      "<th>Team</th><th class='num'>Score</th></tr></thead><tbody>" +
      rows + "</tbody></table>"
    );
  }

  function renderResultRows(g) {
    var players = (g.players || []).slice().sort(function (a, b) {
      return a.place - b.place;
    });
    var rows = "";
    for (var j = 0; j < players.length; j++) {
      var p = players[j];
      var deltaClass = typeof p.delta === "number" && p.delta < 0 ? "neg" : "pos";
      var pic = p.leaguePicture && p.leaguePicture.croppedPicture ? p.leaguePicture.croppedPicture : p.avatarUrl;
      var avatar = imgTag(pic, "avatar");
      rows +=
        "<tr><td class='place place-" + esc(p.place) + "'>" + esc(p.place) +
        "</td><td class='name'><div class='ent'>" + avatar +
        "<span class='label'><span class='player'>" + esc(p.playerName) +
        "</span><span class='team'>" + esc(p.teamName) + "</span></span></div></td>" +
        "<td class='num'>" + esc(fmtScore(p.score)) + "</td>" +
        "<td class='num delta " + deltaClass + "'>" + esc(fmtSigned(p.delta)) + "</td></tr>";
    }
    return rows;
  }

  function renderPairingRows(g) {
    var players = (g.players || []).slice();
    var rows = "";
    for (var j = 0; j < players.length; j++) {
      var p = players[j];
      var pic = p.leaguePicture && p.leaguePicture.croppedPicture ? p.leaguePicture.croppedPicture : p.avatarUrl;
      var avatar = imgTag(pic, "avatar");
      rows +=
        "<tr><td class='name'><div class='ent'>" + avatar +
        "<span class='label'><span class='player'>" + esc(p.playerName) +
        "</span><span class='team'>" + esc(p.teamName) + "</span></span></div></td></tr>";
    }
    return rows;
  }

  function renderGames(phase) {
    var allGames = phase.games || [];
    var planned = phase.plannedGames || [];
    // Mirror the "see details" popup ordering: walk the schedule in order, and
    // let each finished game replace its exact scheduled slot via its linked
    // gameId. Unplayed slots stay as ongoing/scheduled pairings; finished games
    // with no scheduled slot are appended afterwards by start time. This keeps a
    // given table at a stable index for its whole lifecycle, so an OBS source
    // pinned to ?index=N transitions scheduled -> ongoing -> finished in place.
    var gamesById = {};
    for (var gi = 0; gi < allGames.length; gi++) {
      if (allGames[gi].gameId) { gamesById[allGames[gi].gameId] = allGames[gi]; }
    }
    var items = [];
    var linkedIds = {};
    for (var pi = 0; pi < planned.length; pi++) {
      var pg = planned[pi];
      var linked = pg.gameId ? gamesById[pg.gameId] : null;
      if (linked) {
        linkedIds[linked.gameId] = true;
        items.push({ kind: "played", g: linked });
      } else {
        items.push({ kind: "pairing", g: pg });
      }
    }
    var overflow = [];
    for (var oi = 0; oi < allGames.length; oi++) {
      var og = allGames[oi];
      if (!og.gameId || !linkedIds[og.gameId]) { overflow.push(og); }
    }
    overflow.sort(function (a, b) {
      return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
    });
    for (var ov = 0; ov < overflow.length; ov++) {
      items.push({ kind: "played", g: overflow[ov] });
    }
    if (!items.length) {
      return "<div class='empty'>No games played or scheduled yet.</div>";
    }

    var startIdx = 0;
    var endIdx = items.length;
    if (CONFIG.index && CONFIG.index >= 1) {
      var total = phase.totalGames || 0;
      if (total < items.length) {
        total = items.length;
      }
      if (CONFIG.index > total) {
        return "<div class='empty'>Game " + esc(CONFIG.index) +
          " is out of range \\u2014 this stage has " + esc(total) + " games.</div>";
      }
      if (CONFIG.index > items.length) {
        return "<div class='empty'>Game " + esc(CONFIG.index) +
          " not available yet (" + items.length + " of " + esc(total) + " so far).</div>";
      }
      startIdx = CONFIG.index - 1;
      endIdx = CONFIG.index;
    }

    var html = "";
    for (var i = startIdx; i < endIdx; i++) {
      var it = items[i];
      if (it.kind === "pairing") {
        var badge = it.g.status === "ongoing"
          ? " \\u00b7 <span class='live'>ongoing</span>"
          : " \\u00b7 <span class='upcoming'>scheduled</span>";
        html +=
          "<div class='game'><div class='game-head'>Game " + (i + 1) + badge +
          "</div><table class='seats pairing'><tbody>" + renderPairingRows(it.g) +
          "</tbody></table></div>";
      } else {
        var g = it.g;
        var when = g.startTime ? new Date(g.startTime) : null;
        var whenLabel = when && !isNaN(when.getTime()) ? when.toLocaleString() : "";
        html +=
          "<div class='game'><div class='game-head'>Game " + (i + 1) +
          (whenLabel ? " \\u00b7 " + esc(whenLabel) : "") + "</div>" +
          "<table class='seats'><tbody>" + renderResultRows(g) + "</tbody></table></div>";
      }
    }
    return html;
  }

  function render(data) {
    var found = findPhase(data && data.phases);
    if (!found) {
      var avail = data && data.phases ? Object.keys(data.phases) : [];
      app.innerHTML =
        "<div class='empty'>Stage \\"" + esc(CONFIG.stage) + "\\" not found." +
        (avail.length ? " Available: " + esc(avail.join(", ")) : "") + "</div>";
      setStatus("no such stage");
      return;
    }
    var phase = found.phase;
    var standings = renderStandings(phase);
    var games = renderGames(phase);
    if (CONFIG.view === "games") {
      app.innerHTML =
        "<section class='block'><h2>Games (" + esc(phase.gamesPlayed || 0) + "/" +
        esc(phase.totalGames || 0) + ") \\u2014 " + esc(found.key) + "</h2>" + games + "</section>";
    } else {
      app.innerHTML =
        "<section class='block'><h2>Standings \\u2014 " + esc(found.key) + "</h2>" +
        (standings || "<div class='empty'>No standings yet.</div>") + "</section>";
    }
    setStatus("updated " + nowTime());
  }

  function load() {
    fetch(
      CONFIG.apiBase + "/api/bracket-scores?leagueId=" + encodeURIComponent(CONFIG.leagueId),
      { headers: { Accept: "application/json" } }
    )
      .then(function (res) {
        if (!res.ok) { throw new Error("HTTP " + res.status); }
        return res.json();
      })
      .then(function (data) { render(data); })
      .catch(function (e) {
        setStatus("error: " + (e && e.message ? e.message : "failed"));
      });
  }

  function loadTeams() {
    return fetch(
      CONFIG.apiBase + "/api/statistics-filters?leagueSlug=" + encodeURIComponent(CONFIG.slug),
      { headers: { Accept: "application/json" } }
    )
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (data && data.teams) {
          for (var i = 0; i < data.teams.length; i++) {
            var tm = data.teams[i];
            TEAM_PICS[tm._id] =
              tm.pictures && tm.pictures.croppedPicture ? tm.pictures.croppedPicture : null;
            TEAM_NAMES[tm._id] = tm.displayName || tm.simpleName || null;
          }
        }
        if (data && data.users) {
          for (var u = 0; u < data.users.length; u++) {
            var usr = data.users[u];
            if (usr && usr._id && usr.name && !TEAM_NAMES[usr._id]) {
              TEAM_NAMES[usr._id] = usr.name;
            }
          }
        }
      })
      .catch(function () {});
  }

  // Paint immediately (logos may be missing on the very first frame), then
  // re-render once the team picture map has loaded.
  load();
  setInterval(load, CONFIG.intervalMs);
  loadTeams().then(function () { load(); });
})();
`.trim();
}

function errorPage(message: string): string {
  const theme = THEMES.transparent;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Live results</title>
<style>${styles(theme)}</style>
</head>
<body>
<div class="wrap"><div class="block"><div class="empty">${escapeHtml(message)}</div></div></div>
</body>
</html>`;
}

function renderPage(config: LiveConfig, theme: ThemeTokens): string {
  const configJson = escapeForScript(JSON.stringify(config));
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${escapeHtml(config.leagueName)} \u2014 ${escapeHtml(config.stage)} (live)</title>
<style>${styles(theme)}</style>
</head>
<body>
<div class="wrap">
<header>
<h1>${escapeHtml(config.leagueName)}</h1>
<span class="stage">${escapeHtml(config.stage)}</span>
<span class="status" id="status">connecting\u2026</span>
</header>
<div id="app"><div class="empty">Loading\u2026</div></div>
</div>
<script type="application/json" id="live-config">${configJson}</script>
<script>${clientScript()}</script>
</body>
</html>`;
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const slug = params.slug;
  const stage = params.stage;

  if (!slug || !stage) {
    return htmlResponse(errorPage("Missing tournament or stage."), 400);
  }

  const url = new URL(request.url);
  const themeParam = (
    url.searchParams.get("theme") || "transparent"
  ).toLowerCase();
  const themeKey = THEMES[themeParam] ? themeParam : "transparent";
  const intervalSeconds = Math.max(
    5,
    Math.min(600, Number(url.searchParams.get("interval")) || 30)
  );
  const viewParam = (url.searchParams.get("view") || "standings").toLowerCase();
  const view: "standings" | "games" =
    viewParam === "games" ? "games" : "standings";
  const indexRaw = parseInt(url.searchParams.get("index") ?? "", 10);
  const index = Number.isFinite(indexRaw) && indexRaw >= 1 ? indexRaw : 0;

  let leagueId = "";
  let leagueName = "";
  try {
    await connectToDatabase();
    const leagues = await LeagueModel.find({ isDisplayed: true })
      .select("_id name")
      .lean<{ _id: mongoose.Types.ObjectId; name: string }[]>();
    const match = leagues.find((league) => slugify(league.name) === slug);
    if (!match) {
      return htmlResponse(errorPage(`Tournament "${slug}" not found.`), 404);
    }
    leagueId = match._id.toString();
    leagueName = match.name;
  } catch {
    return htmlResponse(errorPage("Could not load tournament data."), 500);
  }

  const config: LiveConfig = {
    leagueId,
    leagueName,
    slug,
    stage,
    view,
    index,
    apiBase: basePath,
    intervalMs: intervalSeconds * 1000,
    theme: themeKey,
  };

  return htmlResponse(renderPage(config, THEMES[themeKey]));
}
