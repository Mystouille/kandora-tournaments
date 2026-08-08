/**
 * DIAGNOSTIC (Phase 0a — Tenhou watch-id discovery).
 *
 * Calls Tenhou's `cmd_get_wg.cgi` — the "get watch-game" endpoint the
 * tournament admin page polls to list ongoing games together with their
 * spectator `WG.id`s — and prints the RAW (and percent-decoded) response so we
 * can learn its exact format. Also fetches `cmd_get_players.cgi` so we can
 * correlate watch-ids with the seated player names.
 *
 * Authenticated implicitly by the edit-auth lobby id (the long `C…` form the
 * app already stores as the tournament id), passed as `L=<lobbyId>`.
 *
 * Usage:
 *   tsx scripts/_probe-tenhou-wg.ts <fullLobbyId>
 * e.g. tsx scripts/_probe-tenhou-wg.ts C1017682582799490
 * (env TENHOU_LOBBY_ID also accepted). Run it WHILE a game is in progress.
 */
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

async function postCmd(url: string, lobbyId: string): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=UTF-8",
      "User-Agent": USER_AGENT,
      Referer: `https://tenhou.net/cs/edit/?${lobbyId}`,
    },
    body: `L=${lobbyId}`,
  });
  const text = await res.text();
  return `[HTTP ${res.status}, ${text.length} bytes]\n  RAW    : ${JSON.stringify(text)}\n  DECODED: ${safeDecode(text)}`;
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return "<not percent-decodable>";
  }
}

async function main(): Promise<void> {
  const lobbyId = process.argv[2] ?? process.env.TENHOU_LOBBY_ID;
  if (!lobbyId) {
    throw new Error(
      "Usage: tsx scripts/_probe-tenhou-wg.ts <fullLobbyId>  (e.g. C1017682582799490)"
    );
  }
  console.log(`Lobby: ${lobbyId}\n`);
  console.log(
    "cmd_get_wg.cgi (watch games):\n" +
      (await postCmd("https://tenhou.net/cs/edit/cmd_get_wg.cgi", lobbyId))
  );
  console.log(
    "\ncmd_get_players.cgi (idle/playing):\n" +
      (await postCmd("https://tenhou.net/cs/edit/cmd_get_players.cgi", lobbyId))
  );
}

void main();
