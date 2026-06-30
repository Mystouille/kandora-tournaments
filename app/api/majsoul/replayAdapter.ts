/**
 * Majsoul replay adapter — Phase 4.5 step 5.
 *
 * Translates a Majsoul `GameRecord` (the same shape
 * [parseGameRecordResponse.ts](./parseGameRecordResponse.ts) already
 * consumes) into a `ReplayLog` that our replay route at
 * `/replays/:source/:gameId` can render through the same Pixi
 * `TableRenderer` that powers live play.
 *
 * The adapter is pure: it doesn't touch Mongo and doesn't call the
 * Majsoul API. Callers (ingestion scripts / cron, Phase 4.5 step 8)
 * fetch the `GameRecord` and pipe it through here, then upsert the
 * result into the `ReplayLog` collection via `archiveMajsoulReplay`
 * (server-side helper at `app/services/replayIngest.server.ts`).
 *
 * ## Tile encoding
 *
 * Majsoul tile strings (`0m`/`1m`–`9m`, `0p`–`9p`, `0s`–`9s`,
 * `1z`–`7z`, with `0x` for the red five) are byte-for-byte the same
 * as our protocol's `Tile` literal, so no transcoding is needed.
 *
 * ## Coverage
 *
 * Handled records: `RecordNewRound`, `RecordDealTile`,
 * `RecordDiscardTile`, `RecordChiPengGang` (chi/pon/daiminkan),
 * `RecordAnGangAddGang` (ankan/shouminkan), `RecordHule` (single-
 * and multi-ron), `RecordNoTile` (exhaustive draw), `RecordLiuJu`
 * (abort — kyuushuu / suufon-renda / etc.).
 *
 * Not yet handled: nagashi mangan tagging on exhaustive draws (left
 * as `undefined`), kita/babei (3-player Sanma extension), explicit
 * dora-flip events on kan (Majsoul folds them into the new-tile
 * record's `doras` field; we diff against the running indicator
 * list and emit `new_dora` events when it grows).
 */

import type { GameRecord } from "./data/types/GameRecord";
import * as lq from "./data/types/liqi";
import { Han } from "./data/enums";
import type { GameEvent, Meld, Seat, Tile } from "~/game/protocol/messages";
import { majsoulFanIdToHan } from "~/api/yaku/platformYakuMaps";
import { hanRomaji } from "~/i18n/hanRomaji";
import { sortYakuRecord } from "~/game/protocol/yakuOrder";
import {
  REPLAY_LOG_SCHEMA_VERSION,
  type ReplayLog,
  type ReplaySeat,
} from "~/game/replay/types";

/** Majsoul `RecordNewRound.chang` value → round wind. */
const ROUND_WIND: ReadonlyArray<"E" | "S" | "W" | "N"> = ["E", "S", "W", "N"];

/** Majsoul `RecordChiPengGang.type` discriminant. */
const CPG_TYPE = {
  chi: 0,
  pon: 1,
  daiminkan: 2,
} as const;

/** Majsoul `RecordAnGangAddGang.type` discriminant. */
const AGAG_TYPE = {
  shouminkan: 2,
  ankan: 3,
} as const;

/** Map an abort `RecordLiuJu.type` to our protocol's `abortKind`. */
function abortKindFromLiuJu(
  type: number | undefined
): "kyuushuu" | "suufon_renda" | "suucha_riichi" | "sanchahou" | undefined {
  // Majsoul's values (cross-checked against real fixtures and the
  // public liqi proto annotations):
  //   1 → kyuushuu kyuuhai (9 terminals/honors on first draw)
  //   2 → suufon-renda (4 winds discarded on the same turn)
  //   3 → suucha riichi (4-player riichi)
  //   4 → sanchahou (triple ron) — usually treated as no-game
  switch (type) {
    case 1:
      return "kyuushuu";
    case 2:
      return "suufon_renda";
    case 3:
      return "suucha_riichi";
    case 4:
      return "sanchahou";
    default:
      return undefined;
  }
}

/**
 * Parse a Majsoul `GameRecord` into a `ReplayLog`. Pure function;
 * throws if the record is missing required envelope data (uuid,
 * accounts, at least one `RecordNewRound`).
 */
export function parseMajsoulReplay(game: GameRecord): ReplayLog {
  if (!game.head) {
    throw new Error("Majsoul GameRecord missing `head` envelope.");
  }
  const uuid = game.head.uuid;
  if (!uuid) {
    throw new Error("Majsoul GameRecord missing `head.uuid`.");
  }
  const accounts = game.head.accounts ?? [];
  if (accounts.length === 0) {
    throw new Error("Majsoul GameRecord has no `head.accounts`.");
  }

  // Sort accounts by seat so the seats[] array indexes line up.
  // We build two views: `accountSeats` carries userId/displayName
  // for the `match_start` event payload (which still references
  // platform user ids), while `seats: ReplaySeat[]` captures the
  // final-standings shape and is patched after the event loop has
  // computed `finalScores`.
  const accountSeats: Array<{
    seat: Seat;
    userId: string;
    displayName: string;
  }> = [];
  for (let s = 0 as Seat; s < 4; s = (s + 1) as Seat) {
    const acc = accounts.find((a) => a.seat === s);
    if (!acc) {
      accountSeats.push({
        seat: s,
        userId: `seat-${s}`,
        displayName: `Seat ${s}`,
      });
      continue;
    }
    accountSeats.push({
      seat: s,
      userId: acc.account_id?.toString() ?? `seat-${s}`,
      displayName: acc.nickname ?? `Seat ${s}`,
    });
  }

  const events: GameEvent[] = [];

  // `match_start` lead-in for the reducer; ruleSet kept generic
  // because Majsoul's mode catalog is large and not 1:1 with ours.
  events.push({
    type: "match_start",
    seats: accountSeats.map((s) => ({
      seat: s.seat,
      userId: s.userId,
      displayName: s.displayName,
    })),
    ruleSet: "majsoul",
  });

  // Running state we need to thread between records.
  let currentDoras: Tile[] = [];
  let lastDiscarder: Seat | null = null;
  let lastDiscardTile: Tile | null = null;
  let pendingScores: [number, number, number, number] = [
    25000, 25000, 25000, 25000,
  ];
  // Per-seat hand size, so we can decide when a deal-tile from
  // Majsoul means "drew from wall" vs "drew dead-wall rinshan".
  // (We don't currently encode that distinction in the protocol, so
  // every deal becomes a `draw` event — the dora-indicator delta
  // below carries the rinshan-flip signal.)

  for (const record of game.records) {
    const name = record.constructor.name;
    switch (name) {
      case "RecordNewRound": {
        const r = record as lq.RecordNewRound;
        const chang = r.chang ?? 0;
        const ju = (r.ju ?? 0) as Seat;
        // Diff doras for a baseline reset.
        currentDoras = [...(r.doras ?? (r.dora ? [r.dora] : []))];
        const startingHands: [Tile[], Tile[], Tile[], Tile[]] = [
          [...(r.tiles0 ?? [])].slice(0, 13) as Tile[],
          [...(r.tiles1 ?? [])].slice(0, 13) as Tile[],
          [...(r.tiles2 ?? [])].slice(0, 13) as Tile[],
          [...(r.tiles3 ?? [])].slice(0, 13) as Tile[],
        ];
        // Dealer (`ju`) gets 14 tiles in Majsoul's `tilesN` array;
        // the 14th is the initial draw. Emit `hand_start` with
        // first-13, then a `draw` for the dealer's 14th tile.
        const dealerExtra = (() => {
          const dealerArr =
            ju === 0
              ? r.tiles0
              : ju === 1
                ? r.tiles1
                : ju === 2
                  ? r.tiles2
                  : r.tiles3;
          return dealerArr && dealerArr.length > 13
            ? (dealerArr[13] as Tile)
            : null;
        })();

        if (r.scores && r.scores.length === 4) {
          pendingScores = [r.scores[0], r.scores[1], r.scores[2], r.scores[3]];
        }

        // Majsoul publishes the entire 136-tile wall at the start
        // of each round in `paishan` (concatenated 2-char tokens).
        // Convention, verified against fixtures:
        //   - paishan[0..51]    haipai (52 tiles, 4-4-4-1 from
        //                       dealer); already covered by the
        //                       `tilesN` arrays so we ignore this
        //                       slice here.
        //   - paishan[52..121]  live wall in draw order;
        //                       paishan[52] is the dealer's first
        //                       post-haipai draw.
        //   - paishan[122..135] dead wall, laid out by stack from
        //                       break-side to rinshan-side, lower-
        //                       then-upper inside each stack. The
        //                       protocol-level `deadWall` follows
        //                       Tenhou's yama-index order (rinshan
        //                       first, then ura-dora, dora,
        //                       kan-doras), so we re-pair-flip on
        //                       the way out.
        const wallParse = parsePaishanWalls(r.paishan);

        events.push({
          type: "hand_start",
          round: chang * 4 + ju,
          dealer: ju,
          roundWind: ROUND_WIND[chang] ?? "E",
          roundNumber: ju + 1,
          honba: r.ben ?? 0,
          riichiSticks: r.liqibang ?? 0,
          scores: [...pendingScores],
          startingHands,
          doraIndicators: [...currentDoras],
          ...(wallParse?.liveWall ? { liveWall: wallParse.liveWall } : {}),
          ...(wallParse?.deadWall ? { deadWall: wallParse.deadWall } : {}),
        });

        // 70 = standard wall remaining at hand start (136 - 13*4 -
        // 14 dead wall). Majsoul reports `left_tile_count` on each
        // deal; the dealer's initial draw uses 70.
        if (dealerExtra) {
          events.push({
            type: "draw",
            seat: ju,
            tile: dealerExtra,
            wallRemaining: r.left_tile_count ?? 70,
          });
        }

        lastDiscarder = null;
        lastDiscardTile = null;
        break;
      }

      case "RecordDealTile": {
        const r = record as lq.RecordDealTile;
        const seat = (r.seat ?? 0) as Seat;
        const tile = r.tile as Tile | undefined;
        if (!tile) {
          break;
        }
        events.push({
          type: "draw",
          seat,
          tile,
          wallRemaining: r.left_tile_count ?? 0,
        });
        // Kan-triggered dora flip: Majsoul folds the new indicator
        // into `doras`. Diff and emit `new_dora`.
        emitDoraDelta(events, currentDoras, r.doras);
        break;
      }

      case "RecordDiscardTile": {
        const r = record as lq.RecordDiscardTile;
        const seat = (r.seat ?? 0) as Seat;
        const tile = r.tile as Tile | undefined;
        if (!tile) {
          break;
        }
        const isRiichi = !!(r.is_liqi || r.is_wliqi);
        // Authoritative post-discard waits from the replay log. Majsoul
        // emits `tingpais` whenever the discarder is in tenpai (including
        // non-riichi tenpai). An absent / empty list means "not tenpai".
        // Normalise red-fives (`0m/0p/0s` → `5m/5p/5s`) so downstream
        // wait-equality checks line up with our canonical Tile alphabet.
        const tingpais = r.tingpais ?? [];
        const waits: Tile[] = [];
        const seen = new Set<string>();
        for (const tp of tingpais) {
          const raw = tp.tile;
          if (!raw) {
            continue;
          }
          const canonical = (raw.startsWith("0") ? `5${raw[1]}` : raw) as Tile;
          if (!seen.has(canonical)) {
            seen.add(canonical);
            waits.push(canonical);
          }
        }
        events.push({
          type: "discard",
          seat,
          tile,
          tsumogiri: !!r.moqie,
          ...(isRiichi ? { riichi: true } : {}),
          waits,
        });
        lastDiscarder = seat;
        lastDiscardTile = tile;
        // Majsoul sometimes attaches doras on the discard record
        // (e.g. when a riichi declaration concludes the kan flip
        // animation). Diff defensively.
        emitDoraDelta(events, currentDoras, r.doras);
        break;
      }

      case "RecordChiPengGang": {
        const r = record as lq.RecordChiPengGang;
        const seat = (r.seat ?? 0) as Seat;
        const tiles = (r.tiles ?? []) as Tile[];
        const froms = r.froms ?? [];
        const meldType =
          r.type === CPG_TYPE.chi
            ? "chi"
            : r.type === CPG_TYPE.pon
              ? "pon"
              : r.type === CPG_TYPE.daiminkan
                ? "daiminkan"
                : null;
        if (!meldType) {
          break;
        }
        // The claimed tile is the one whose `from` differs from the
        // caller. Majsoul lists tiles in display order and `froms`
        // parallel to that.
        let claimedTile: Tile | null = null;
        let from: Seat | null = null;
        for (let i = 0; i < tiles.length; i++) {
          if (froms[i] !== undefined && (froms[i] as Seat) !== seat) {
            claimedTile = tiles[i];
            from = froms[i] as Seat;
            break;
          }
        }
        // Fallback: assume the last discard supplied the claim.
        if (claimedTile === null && lastDiscardTile !== null) {
          claimedTile = lastDiscardTile;
          from = lastDiscarder;
        }
        const meld: Meld = {
          type: meldType,
          tiles,
          claimedTile,
          from,
        };
        events.push({ type: "call", seat, meld });
        break;
      }

      case "RecordAnGangAddGang": {
        const r = record as lq.RecordAnGangAddGang;
        const seat = (r.seat ?? 0) as Seat;
        const tileGroup = r.tiles as string | undefined;
        if (!tileGroup) {
          break;
        }
        // `RecordAnGangAddGang.tiles` is a single tile string for
        // shouminkan (added tile) and the kan tile for ankan.
        const tile = tileGroup as Tile;
        const meldType =
          r.type === AGAG_TYPE.ankan
            ? "ankan"
            : r.type === AGAG_TYPE.shouminkan
              ? "shouminkan"
              : null;
        if (!meldType) {
          break;
        }
        const meld: Meld = {
          type: meldType,
          // Concealed kan / added kan: all four copies belong to the
          // caller; we report the kan tile four times so downstream
          // renderers can lay it out without needing extra metadata.
          tiles: [tile, tile, tile, tile],
          claimedTile: null,
          from: null,
        };
        events.push({ type: "call", seat, meld });
        // Kan triggers a kan-dora flip; Majsoul reports the new
        // indicator on the *next* deal record's `doras`. Some logs
        // attach it here too — handle either by diffing.
        emitDoraDelta(events, currentDoras, r.doras);
        break;
      }

      case "RecordHule": {
        const r = record as lq.RecordHule;
        const hules = r.hules ?? [];
        const delta = r.delta_scores ?? [0, 0, 0, 0];
        const scoresAfter = r.scores ?? [...pendingScores];
        // Emit one `win` per hule (multi-ron preserves order).
        for (const h of hules) {
          const seat = (h.seat ?? 0) as Seat;
          const winTile = h.hu_tile as Tile | undefined;
          const loser = h.zimo ? null : lastDiscarder;
          const yaku: Record<string, string> = {};
          for (const fan of h.fans ?? []) {
            // Prefer the canonical romaji name derived from the
            // platform's fan id; fall back to whatever the log
            // labelled the fan with so unknown / custom yaku
            // still surface in the UI.
            const display = hanRomaji(majsoulFanIdToHan(fan.id ?? undefined)) ?? fan.name;
            if (!display) {
              continue;
            }
            if (h.yiman) {
              // For yakuman wins `fan.val` is the yakuman
              // multiplier (1 = single, 2 = double, …). Render
              // that as plain yakuman labels rather than "Nhan".
              const mult = fan.val ?? 1;
              yaku[display] = mult > 1 ? `${mult}\u00d7役満` : "役満";
            } else {
              yaku[display] = `${fan.val ?? 0}飜`;
            }
          }
          // Majsoul flags `yiman` for any yakuman win but doesn't
          // expose a top-level multiplier. For yakuman hands each
          // entry in `fans` carries `val` = its yakuman multiplier
          // (1 for single yakuman, 2 for double, etc.), so the
          // total multi-yakuman count is the sum across all fans.
          // Fall back to 1 if the sum is zero so a malformed log
          // still surfaces as a single yakuman.
          const yakumanCount = h.yiman
            ? (h.fans ?? []).reduce((s, f) => s + (f.val ?? 0), 0) || 1
            : 0;
          // Dora / aka / ura han counts and the platform-neutral yaku id list
          // straight from the fan list, so a stats projection doesn't have to
          // recompute dora from indicators + hand. Majsoul fan ids already live
          // in the `Han` enum space.
          const doraCount = (h.fans ?? [])
            .filter((f) => f.id === Han.Dora)
            .reduce((s, f) => s + (f.val ?? 0), 0);
          const akaDoraCount = (h.fans ?? [])
            .filter((f) => f.id === Han.Red_Five)
            .reduce((s, f) => s + (f.val ?? 0), 0);
          const uraDoraCount = (h.fans ?? [])
            .filter((f) => f.id === Han.Ura_Dora)
            .reduce((s, f) => s + (f.val ?? 0), 0);
          const yakuHan = (h.fans ?? [])
            .map((f) => f.id)
            .filter((id): id is number => id !== undefined);
          events.push({
            type: "win",
            seat,
            loser,
            winTile,
            han: h.count ?? 0,
            fu: h.fu ?? 0,
            // `dadian` is the base hand value for THIS winner
            // (e.g. 8000 for a non-dealer mangan). `point_sum` is
            // the grand total of payouts across every winner in
            // this `RecordHule`, so for a multi-ron it reports
            // the sum of all winners' values (e.g. 24000 for a
            // triple mangan ron). Prefer `dadian` and fall back
            // to `point_sum` only when `dadian` is missing.
            ten: h.dadian ?? h.point_sum ?? 0,
            yakumanCount,
            yaku: sortYakuRecord(yaku),
            yakuHan,
            doraCount,
            akaDoraCount,
            uraDoraCount,
            hand: (h.hand ?? []) as Tile[],
            doraIndicators: [...currentDoras],
            uraDoraIndicators: (h.li_doras ?? []) as Tile[],
            delta:
              delta.length === 4
                ? [delta[0], delta[1], delta[2], delta[3]]
                : undefined,
          });
        }
        if (scoresAfter.length === 4) {
          pendingScores = [
            scoresAfter[0],
            scoresAfter[1],
            scoresAfter[2],
            scoresAfter[3],
          ];
        }
        events.push({
          type: "hand_end",
          reason: hules.length > 0 && hules[0].zimo ? "tsumo" : "ron",
          delta:
            delta.length === 4
              ? [delta[0], delta[1], delta[2], delta[3]]
              : undefined,
          scores: [...pendingScores],
        });
        break;
      }

      case "RecordNoTile": {
        const r = record as lq.RecordNoTile;
        const players = r.players ?? [];
        const tenpai: [boolean, boolean, boolean, boolean] = [
          !!players[0]?.tingpai,
          !!players[1]?.tingpai,
          !!players[2]?.tingpai,
          !!players[3]?.tingpai,
        ];
        // Aggregate delta scores across the (possibly multiple)
        // NoTileScoreInfo entries Majsoul produces.
        const delta: [number, number, number, number] = [0, 0, 0, 0];
        for (const s of r.scores ?? []) {
          const ds = s.delta_scores ?? [];
          for (let i = 0; i < 4 && i < ds.length; i++) {
            delta[i] += ds[i];
          }
        }
        for (let i = 0; i < 4; i++) {
          pendingScores[i] += delta[i];
        }
        events.push({
          type: "hand_end",
          reason: "exhaustive_draw",
          tenpai,
          delta,
          scores: [...pendingScores],
        });
        break;
      }

      case "RecordLiuJu": {
        const r = record as lq.RecordLiuJu;
        const abortKind = abortKindFromLiuJu(r.type);
        events.push({
          type: "hand_end",
          reason: "abort",
          ...(abortKind ? { abortKind } : {}),
          scores: [...pendingScores],
        });
        break;
      }

      default: {
        // Unknown record type — skip. Majsoul ships many "info"
        // records (e.g. RecordLockTile, RecordRevealTile for
        // 3-player sanma) that don't materially affect a 4-player
        // replay view. We intentionally drop them.
        break;
      }
    }
  }

  // `match_end` from final scores.
  const finalScores: Array<{ seat: Seat; score: number; place: number }> = [
    0, 1, 2, 3,
  ]
    .map((s) => ({ seat: s as Seat, score: pendingScores[s] }))
    .sort((a, b) => b.score - a.score)
    .map((entry, idx) => ({ ...entry, place: idx + 1 }));
  // Restore seat-order for the event payload (UI sorts by place).
  finalScores.sort((a, b) => a.seat - b.seat);
  events.push({ type: "match_end", reason: "round_limit", finalScores });

  // Build the cross-platform `ReplaySeat[]` now that final scores
  // and places are known. The placement comes from `finalScores`,
  // which is seat-ordered after the sort above.
  const seats: ReplaySeat[] = accountSeats.map((acc) => {
    const final = finalScores.find((f) => f.seat === acc.seat);
    return {
      seat: acc.seat,
      displayName: acc.displayName,
      finalScore: final?.score ?? pendingScores[acc.seat],
      place: (final?.place ?? acc.seat + 1) as 1 | 2 | 3 | 4,
    };
  });

  const startedAt = (game.head.start_time ?? 0) * 1000;
  const endedAt = (game.head.end_time ?? 0) * 1000;

  // `game.head.config` is a live protobufjs message instance (with
  // a class prototype, getters, and `$type` metadata). Mongo's
  // upsert flattens it to a plain object on the way to disk, but
  // when the orphan-fetch path returns the parsed log *directly*
  // to the loader (cache-miss), React Router's `turbo-stream`
  // serializer chokes on the non-plain object and the client
  // receives a broken payload — the renderer hydrates onto a blank
  // canvas. JSON-roundtripping here yields a plain object so both
  // code paths (cache-hit / cache-miss) serialize identically.
  const ruleSetDetails: Record<string, unknown> | undefined = game.head.config
    ? (JSON.parse(JSON.stringify({ config: game.head.config })) as Record<
        string,
        unknown
      >)
    : undefined;

  return {
    source: "majsoul",
    sourceGameId: uuid,
    ruleSet: "majsoul",
    ruleSetDetails,
    startedAt,
    endedAt,
    seats,
    events,
    schemaVersion: REPLAY_LOG_SCHEMA_VERSION,
  };
}

/**
 * Push a `new_dora` event for each indicator that appears in `next`
 * but not in `running`, and update `running` in place. Majsoul tends
 * to report the full indicator list on records that flip a new one;
 * older indicators stay at their original index.
 */
function emitDoraDelta(
  events: GameEvent[],
  running: Tile[],
  next: string[] | undefined
): void {
  if (!next || next.length <= running.length) {
    return;
  }
  for (let i = running.length; i < next.length; i++) {
    events.push({ type: "new_dora", indicator: next[i] as Tile });
    running.push(next[i] as Tile);
  }
}

/**
 * Split a Majsoul `paishan` string (136 concatenated 2-char tile
 * tokens) into the protocol's `liveWall` (70 tiles in draw order)
 * and `deadWall` (14 tiles in Tenhou yama-index order). Returns
 * `null` when the input is missing or malformed.
 *
 * Verified empirically against fixture replays: across 18 rounds
 * the standard dora indicator (`RecordNewRound.doras[0]`) is
 * always the upper tile of the 5th dead-wall stack from the
 * break-side — i.e. `paishan[131]`, which our pair-flip below
 * maps to `deadWall[5]` as required by `TableRenderer`.
 */
function parsePaishanWalls(
  paishan: string | null | undefined
): { liveWall: Tile[]; deadWall: Tile[] } | null {
  if (!paishan || paishan.length !== 272) {
    return null;
  }
  const tiles: Tile[] = [];
  for (let i = 0; i < paishan.length; i += 2) {
    tiles.push(paishan.slice(i, i + 2) as Tile);
  }
  if (tiles.length !== 136) {
    return null;
  }
  const liveWall = tiles.slice(52, 122);
  // Majsoul lays out the 14 dead-wall tiles by stack, break-side
  // first, lower-then-upper inside each stack:
  //   raw[0..1]  = break-side stack (kan-dora-4 ura / kan-dora-4)
  //   raw[2..3]  = next stack       (kan-dora-3 ura / kan-dora-3)
  //   ...
  //   raw[12..13]= rinshan stack
  // Tenhou yama-index is rinshan-end first, so we flip whole-pair
  // order while keeping the lower/upper pairing intact:
  //   yama[i] = raw[12 - 2*floor(i/2) + (i%2)]
  const rawDead = tiles.slice(122, 136);
  const deadWall: Tile[] = new Array<Tile>(14);
  for (let i = 0; i < 14; i++) {
    deadWall[i] = rawDead[12 - 2 * Math.floor(i / 2) + (i % 2)];
  }
  return { liveWall, deadWall };
}
