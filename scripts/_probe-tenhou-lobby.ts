/**
 * DIAGNOSTIC (Phase 0a — Tenhou watch-id discovery). READ-ONLY.
 *
 * Connects to a live Tenhou private lobby's game-server websocket and dumps
 * every JSON frame it broadcasts, so we can see whether ongoing games are
 * advertised with a spectator `WG.id` (the 8-hex id the kansen client sends).
 * It never joins a table and requires no account (guest HELO).
 *
 * Usage:
 *   tsx scripts/_probe-tenhou-lobby.ts <lobbyId> [durationMs]
 * Env (optional):
 *   TENHOU_LOBBY_ID    — used when <lobbyId> arg is omitted
 *   TENHOU_HELLO_NAME  — Tenhou account id for lobbies that refuse guests
 *
 * Run this WHILE a league game is in progress in that lobby, then share the
 * output. If a frame carries an 8-hex `id` alongside the seated player names,
 * that is the watch-id source; otherwise watch-ids are not lobby-advertised
 * and we fall back to manual/admin entry.
 */
import {
  collectTenhouLobbyFrames,
  type TenhouLobbyFrame,
} from "../app/api/tenhou/tenhouLobbyWatch.server";

const HEX8 = /^[0-9A-Fa-f]{8}$/;

/** Heuristic: does this frame look like it carries a spectator watch-id? */
function looksLikeWatchId(frame: TenhouLobbyFrame): boolean {
  for (const value of Object.values(frame.raw)) {
    if (typeof value === "string" && HEX8.test(value)) {
      return true;
    }
  }
  return false;
}

async function main(): Promise<void> {
  const lobbyId = process.argv[2] ?? process.env.TENHOU_LOBBY_ID;
  if (!lobbyId) {
    throw new Error(
      "Usage: tsx scripts/_probe-tenhou-lobby.ts <lobbyId> [durationMs]"
    );
  }
  const durationMs = Number(process.argv[3] ?? 30_000) || 30_000;
  console.log(
    `Probing Tenhou lobby ${lobbyId} for ${durationMs}ms (read-only, no table join)…`
  );

  const result = await collectTenhouLobbyFrames(lobbyId, {
    durationMs,
    helloName: process.env.TENHOU_HELLO_NAME,
  });

  console.log(`\nSubscribed public lobby: ${result.lobby}`);
  console.log("Frame tag counts:", JSON.stringify(result.tagCounts));

  const candidates = result.frames.filter(looksLikeWatchId);
  if (candidates.length > 0) {
    console.log(`\n★ ${candidates.length} frame(s) carry an 8-hex id (watch-id candidates):`);
    for (const f of candidates) {
      console.log(`  [+${f.at}ms] ${f.tag}: ${JSON.stringify(f.raw)}`);
    }
  } else {
    console.log(
      "\nNo 8-hex id seen in any frame → watch-ids are NOT lobby-advertised (use manual entry)."
    );
  }

  console.log("\nAll frames (first occurrence per tag shown for HELO/LN/CS noise):");
  const noisy = new Set(["HELO", "LN", "CS"]);
  const seenNoisy = new Set<string>();
  for (const f of result.frames) {
    if (noisy.has(f.tag)) {
      if (seenNoisy.has(f.tag)) {
        continue;
      }
      seenNoisy.add(f.tag);
    }
    console.log(`  [+${f.at}ms] ${f.tag}: ${JSON.stringify(f.raw)}`);
  }
}

void main();
