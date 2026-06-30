import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),

  // ---------------------------------------------------------------------
  // Auth — Discord OAuth + session
  // ---------------------------------------------------------------------
  route("/account", "routes/account.tsx"),
  route("/auth/discord/callback", "routes/auth/discord/callback.tsx"),
  route("/api/auth/me", "routes/api/auth/me.ts"),
  route("/api/auth/logout", "routes/api/auth/logout.ts"),
  route("/api/auth/discord-callback", "routes/api/auth/discord-callback.ts"),
  route("/api/auth/account", "routes/api/auth/account.ts"),
  route("/api/auth/link-identity", "routes/api/auth/link-identity.ts"),
  route("/api/auth/validate-identity", "routes/api/auth/validate-identity.ts"),

  // ---------------------------------------------------------------------
  // Online tournaments (public)
  // ---------------------------------------------------------------------
  route("/online-tournaments", "routes/online-tournaments.tsx"),
  route("/online-tournaments/:slug", "routes/online-tournaments.$slug.tsx"),
  route(
    "/online-tournaments/:slug/statistics",
    "routes/online-tournaments.$slug.statistics.tsx"
  ),

  // Public, unauthenticated live results overlay for a single bracket stage
  // (designed as an OBS browser source).
  route("/live/:slug/:stage", "routes/live.$slug.$stage.tsx"),

  // Read-only replay viewer (DB-only loader over ReplayLog; no game-server).
  route("/replays/:gameId", "routes/game/replay.tsx"),

  // ---------------------------------------------------------------------
  // Admin — online tournaments
  // ---------------------------------------------------------------------
  route(
    "/admin/online-tournaments/new",
    "routes/admin.online-tournaments.new.tsx"
  ),
  route(
    "/admin/online-tournaments/:id/edit-presentation",
    "routes/admin.online-tournaments.$id.edit-presentation.tsx"
  ),
  route(
    "/admin/online-tournaments/:id/import-teams",
    "routes/admin.online-tournaments.$id.import-teams.tsx"
  ),
  route(
    "/admin/online-tournaments/:id/edit-finals-roster",
    "routes/admin.online-tournaments.$id.edit-finals-roster.tsx"
  ),
  route(
    "/admin/online-tournaments/:id/edit-roster",
    "routes/admin.online-tournaments.$id.edit-roster.tsx"
  ),
  route(
    "/admin/online-tournaments/:id/edit-team-pictures",
    "routes/admin.online-tournaments.$id.edit-team-pictures.tsx"
  ),
  route(
    "/admin/online-tournaments/:id/edit-player-pictures",
    "routes/admin.online-tournaments.$id.edit-player-pictures.tsx"
  ),

  // ---------------------------------------------------------------------
  // API — tournament data
  // ---------------------------------------------------------------------
  route("/api/online-tournaments", "routes/api/online-tournaments.ts"),
  route(
    "/api/online-tournaments/:slug",
    "routes/api/online-tournaments.$slug.ts"
  ),
  route(
    "/api/online-tournaments/:id/can-edit",
    "routes/api/online-tournaments.$id.can-edit.ts"
  ),
  route("/api/ranking-data", "routes/api/ranking-data.ts"),
  route("/api/player-standings", "routes/api/player-standings.ts"),
  route("/api/bracket-scores", "routes/api/bracket-scores.ts"),
  route("/api/score-evolution", "routes/api/score-evolution.ts"),
  route("/api/game-records", "routes/api/game-records.ts"),
  route("/api/games", "routes/api/games.ts"),
  route("/api/statistics-filters", "routes/api/statistics-filters.ts"),
  route("/api/yaku-map", "routes/api/yaku-map.ts"),
  route("/api/telemetry", "routes/api/telemetry.ts"),

  // ---------------------------------------------------------------------
  // API — replay
  // ---------------------------------------------------------------------
  route("/api/replay-tenhou-log", "routes/api/replay-tenhou-log.ts"),
  route("/api/replay-reviews", "routes/api/replay-reviews.ts"),
  route("/api/replay-reviews/:shortId", "routes/api/replay-reviews.$shortId.ts"),

  // ---------------------------------------------------------------------
  // API — admin
  // ---------------------------------------------------------------------
  route(
    "/api/admin/online-tournaments",
    "routes/api/admin/online-tournaments.ts"
  ),
  route(
    "/api/admin/validate-tournament",
    "routes/api/admin/validate-tournament.ts"
  ),
  route("/api/admin/majsoul-seasons", "routes/api/admin/majsoul-seasons.ts"),
  route(
    "/api/admin/league-team-import",
    "routes/api/admin/league-team-import.ts"
  ),
  route("/api/admin/league-csv-import", "routes/api/admin/league-csv-import.ts"),
  route(
    "/api/admin/league-finals-roster",
    "routes/api/admin/league-finals-roster.ts"
  ),
  route("/api/admin/league-roster", "routes/api/admin/league-roster.ts"),
  route(
    "/api/admin/league-team-picture",
    "routes/api/admin/league-team-picture.ts"
  ),
  route(
    "/api/admin/league-user-picture",
    "routes/api/admin/league-user-picture.ts"
  ),
  route("/api/admin/discord-channels", "routes/api/admin/discord-channels.ts"),
  route("/api/admin/discord-servers", "routes/api/admin/discord-servers.ts"),
  route(
    "/api/admin/discord-server-members",
    "routes/api/admin/discord-server-members.ts"
  ),
  route(
    "/api/admin/league-presentation",
    "routes/api/admin/league-presentation.ts"
  ),
  route(
    "/api/admin/league-type-config",
    "routes/api/admin/league-type-config.ts"
  ),
  route(
    "/api/admin/league-save-rc-tables",
    "routes/api/admin/league-save-rc-tables.ts"
  ),
] satisfies RouteConfig;
