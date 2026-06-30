/**
 * Riichi City replay adapter — Phase 4.5 step 7.
 *
 * Translates a Riichi City `GameData` (the same shape
 * [parseRiichiCityGameRecord.ts](./parseRiichiCityGameRecord.ts)
 * already consumes) into a `ReplayLog` that the cross-platform
 * replay route at `/replays/:source/:gameId` can render.
 *
 * The adapter is pure: no Mongo, no network. The connector
 * (`RiichiCityLeagueConnector.getReplayLog`) handles the IO and
 * pipes the raw `GameData` through here. The hydration pipeline
 * (Phase 4.5 step 8) calls the connector and upserts the result
 * into the `replaylogs` collection.
 *
 * ## Tile encoding
 *
 * Riichi City uses a packed integer encoding (see
 * [riichiCityTileUtils.ts](./riichiCityTileUtils.ts)). The
 * `tileToString` helper already produces our protocol's `Tile`
 * literal (`0m`/`1m`–`9m`, `0p`–`9p`, `0s`–`9s`, `1z`–`7z`).
 *
 * ## Coverage
 *
 * Handled events: `StartingHand` (round wind / dealer / dora /
 * scores / per-seat starting hands), `Draw`, `DiscardOrCall`
 * (discards, chi/pon/daiminkan/ankan/shouminkan), `NewDoraIndicator`,
 * `RoundEnd` (win + hand_end), `GameEnd` (final standings).
 *
 * Fidelity gaps (carried in the per-platform matrix):
 * - `wallRemaining` is `0` placeholder — Riichi City doesn't tag
 *   it per-draw inline.
 * - `nagashi` flag on exhaustive draws is left `undefined`.
 * - The `roundEnd` `card` field is used as the win tile when the
 *   parser can't infer a more accurate value (matches the existing
 *   `parseRiichiCityGameRecord` heuristic).
 */

import {
  ActionType,
  EventType,
  RoundEndType,
  YakuType,
  type GameData,
  type RoundData,
  type SubHandData,
  type WinInfoData,
} from "~/services/riichiCityModels";
import { decodeTile, tileToString } from "./riichiCityTileUtils";
import type { GameEvent, Meld, Seat, Tile } from "~/game/protocol/messages";
import { riichiCityYakuTypeToHan } from "~/api/yaku/platformYakuMaps";
import { hanRomaji } from "~/i18n/hanRomaji";
import { sortYakuRecord } from "~/game/protocol/yakuOrder";
import {
  REPLAY_LOG_SCHEMA_VERSION,
  type ReplayLog,
  type ReplaySeat,
} from "~/game/replay/types";

const ROUND_WIND: ReadonlyArray<"E" | "S" | "W" | "N"> = ["E", "S", "W", "N"];

/**
 * Riichi City encodes `quan_feng` (the prevailing round wind) as a
 * tile id — 49 (`1z`) for East, 65 (`2z`) for South, etc. Older
 * unit-test payloads use a raw 0..3 index instead, so we accept
 * both shapes.
 */
function decodeQuanFeng(quanFeng: number): "E" | "S" | "W" | "N" {
  if (quanFeng >= 0 && quanFeng < 4) {
    return ROUND_WIND[quanFeng];
  }
  const decoded = decodeTile(quanFeng);
  if (decoded.suit === 3 && decoded.value >= 1 && decoded.value <= 4) {
    return ROUND_WIND[decoded.value - 1];
  }
  return "E";
}

/**
 * Riichi City `SubHandData` is loose: many event-specific fields
 * (`card`, `dealer_pos`, `is_gang_incard`, `bu_gang_cards`,
 * `bao_pai_card`, etc.) appear in the JSON payload but aren't
 * always declared on the public TypeScript model. We re-parse with
 * a permissive overlay so the adapter doesn't need to litter
 * `(x as any)` casts.
 */
type SubHand = SubHandData & {
  card?: number;
  dealer_pos?: number;
  is_gang_incard?: boolean;
  bu_gang_cards?: number[];
  // Chi / pon / kan call payloads carry the tiles the caller
  // contributes from their hand on `group_cards` (and the claimed
  // tile / shouminkan-added tile on `card`). The public
  // `SubHandData` type only declares `cards`, which is never
  // populated for real RC payloads — `group_cards` is the actual
  // field, so we surface it here.
  group_cards?: number[] | null;
  move_cards_pos?: number[] | null;
  // `bao_pai_card` is declared on `SubHandData` but mostly carries
  // the dora indicator at hand start.
};

/** Parse the embedded JSON payload on a Riichi City `HandData`. */
function decode(data: string): SubHand {
  return JSON.parse(data) as SubHand;
}

/**
 * Split a Riichi City `handCardEncode` string into the live wall
 * and dead wall the replay viewer needs.
 *
 * Layout (empirically confirmed against the live RC viewer):
 *   - `encode[0..52]`  — 52 haipai tiles dealt 4-4-4-1 starting
 *                       from the dealer. We don't reconstruct the
 *                       per-seat haipai from this section because
 *                       each seat's `hand_cards` already gives the
 *                       definitive 13-tile starting hand.
 *   - `encode[52..122]` — 70 live-wall tiles in chronological
 *                        draw order. `encode[52]` is the dealer's
 *                        chonbo (their 14th tile), `encode[53]` is
 *                        the next seat's first draw, etc.
 *   - `encode[122..136]` — 14 dead-wall tiles in physical layout
 *                         (break-side first). We re-index using
 *                         the Tenhou yama formula so that
 *                         `deadWall[4]` is the standard dora
 *                         indicator slot the renderer expects.
 *
 * Returns `null` when the encode is missing or malformed (the
 * caller falls back to emitting `hand_start` without walls).
 */
function parseHandCardEncode(
  enc: string | undefined
): { liveWall: Tile[]; deadWall: Tile[] } | null {
  if (!enc || enc.length !== 272) {
    return null;
  }
  const tiles: Tile[] = [];
  for (let i = 0; i < enc.length; i += 2) {
    tiles.push(enc.slice(i, i + 2) as Tile);
  }
  if (tiles.length !== 136) {
    return null;
  }
  const liveWall = tiles.slice(52, 122);
  const rawDead = tiles.slice(122, 136);
  const deadWall: Tile[] = new Array(14);
  for (let i = 0; i < 14; i++) {
    // Tenhou yama-index: pairs from the break side, lower/upper
    // alternating. `rawDead[8]` lands at `deadWall[4]` (dora
    // indicator); `rawDead[9]` at `deadWall[5]` (ura dora).
    deadWall[i] = rawDead[12 - 2 * Math.floor(i / 2) + (i % 2)];
  }
  return { liveWall, deadWall };
}

/**
 * Parse a Riichi City `GameData` into a cross-platform `ReplayLog`.
 *
 * @param game        - Raw `GameData` from `RiichiCityConnector.getContestGameRecord`.
 * @param seatToUserId  - Ordered seat → RC numeric userId-as-string. Index 0 is
 *                        the first dealer; matches the convention used by
 *                        `parseRiichiCityGameRecord`.
 * @param seatToNickname - Ordered seat → display nickname (empty string
 *                         when unavailable).
 */
export function parseRiichiCityReplay(
  game: GameData,
  seatToUserId: string[],
  seatToNickname: string[]
): ReplayLog {
  if (!game.keyValue) {
    throw new Error("Riichi City GameData missing `keyValue`.");
  }
  if (!game.handRecord || game.handRecord.length === 0) {
    throw new Error("Riichi City GameData has no rounds.");
  }
  if (seatToUserId.length === 0) {
    throw new Error("Riichi City replay needs a non-empty seat order.");
  }

  // Pad seat order to 4 for the 4-seat reducer contract. Missing
  // seats get placeholder ids/names — sanma 3p is out of scope and
  // documented as `not-supported` in the fidelity matrix.
  const seatIds: string[] = [];
  const seatNames: string[] = [];
  for (let s = 0; s < 4; s++) {
    seatIds.push(seatToUserId[s] ?? `seat-${s}`);
    seatNames.push(seatToNickname[s] ?? `Seat ${s}`);
  }

  const idToSeat = new Map<string, Seat>();
  for (let s = 0; s < 4; s++) {
    idToSeat.set(seatIds[s], s as Seat);
  }
  const seatOf = (userId: number | string): Seat => {
    const s = idToSeat.get(userId.toString());
    return s ?? (0 as Seat);
  };

  const events: GameEvent[] = [];

  events.push({
    type: "match_start",
    seats: seatIds.map((userId, seat) => ({
      seat: seat as Seat,
      userId,
      displayName: seatNames[seat],
    })),
    ruleSet: "riichicity",
  });

  let scores: [number, number, number, number] = [25000, 25000, 25000, 25000];
  let firstStartTime = 0;
  let lastEventTime = 0;

  for (let roundIdx = 0; roundIdx < game.handRecord.length; roundIdx++) {
    const round = game.handRecord[roundIdx];
    emitRound(round, roundIdx);
  }

  // Final standings from the trailing `GameEnd` event when present;
  // otherwise derive from the running scores.
  const gameEndEvent = game.handRecord
    .flatMap((r) => r.handEventRecord)
    .find((e) => e.eventType === EventType.GameEnd);
  const finalScores: Array<{
    seat: Seat;
    score: number;
    place: 1 | 2 | 3 | 4;
  }> = [];
  if (gameEndEvent) {
    const sub = decode(gameEndEvent.data);
    const userData = sub.user_data ?? [];
    const sorted = [...userData].sort((a, b) => b.point_num - a.point_num);
    for (const ud of userData) {
      const seat = seatOf(ud.user_id);
      const place = (sorted.findIndex((s) => s.user_id === ud.user_id) + 1) as
        | 1
        | 2
        | 3
        | 4;
      finalScores.push({ seat, score: ud.point_num, place });
      scores[seat] = ud.point_num;
    }
  } else {
    const sorted = [0, 1, 2, 3]
      .map((s) => ({ seat: s as Seat, score: scores[s] }))
      .sort((a, b) => b.score - a.score)
      .map((entry, idx) => ({ ...entry, place: (idx + 1) as 1 | 2 | 3 | 4 }));
    sorted.sort((a, b) => a.seat - b.seat);
    finalScores.push(...sorted);
  }

  events.push({
    type: "match_end",
    reason: "round_limit",
    finalScores: finalScores.map((f) => ({
      seat: f.seat,
      score: f.score,
      place: f.place,
    })),
  });

  const seats: ReplaySeat[] = seatIds.map((_, seat) => {
    const final = finalScores.find((f) => f.seat === seat);
    return {
      seat: seat as Seat,
      displayName: seatNames[seat],
      finalScore: final?.score ?? scores[seat],
      place: final?.place ?? ((seat + 1) as 1 | 2 | 3 | 4),
    };
  }) as ReplaySeat[];

  const startedAt = firstStartTime > 0 ? firstStartTime * 1000 : 0;
  const endedAt = game.nowTime
    ? game.nowTime * 1000
    : lastEventTime > 0
      ? lastEventTime * 1000
      : startedAt;

  return {
    source: "riichicity",
    sourceGameId: game.keyValue,
    ruleSet: "riichicity",
    startedAt,
    endedAt,
    seats,
    events,
    schemaVersion: REPLAY_LOG_SCHEMA_VERSION,
  };

  // ----------------------------------------------------------------
  // Per-round emission (declared inline so it captures `events`,
  // `scores`, `seatOf`, etc. without threading a giant context
  // object through helpers).
  // ----------------------------------------------------------------

  function emitRound(round: RoundData, roundIdx: number): void {
    const handEvents = round.handEventRecord;
    if (handEvents.length === 0) {
      return;
    }

    // Per-seat last-drawn tile, used for tsumogiri detection and as
    // the tsumo win tile.
    const lastDrawTile: Array<number | null> = [null, null, null, null];

    // Build per-seat starting hands from the StartingHand events.
    const startingHands: [Tile[], Tile[], Tile[], Tile[]] = [[], [], [], []];
    // Dealer has 14 `hand_cards` (others have 13); the 14th tile is
    // their pre-dealt chonbo. Capture it so we can emit a synthetic
    // opening `draw` event in lieu of RC's phantom `in_card: 0`
    // Draw event (see the EventType.Draw handler below).
    let dealerChonboNum: number | null = null;
    let dealer: Seat = 0;
    let roundWind: "E" | "S" | "W" | "N" = "E";
    let roundNumber = 1;
    let honba = 0;
    let riichiSticks = 0;
    let doraIndicator: Tile | null = null;

    for (const ev of handEvents) {
      if (ev.eventType !== EventType.StartingHand) {
        continue;
      }
      const sub = decode(ev.data);
      const seat = seatOf(ev.userId);
      if (sub.hand_cards) {
        startingHands[seat] = sub.hand_cards
          .slice(0, 13)
          .map((t) => tileToString(t) as Tile);
        // Dealer gets 14 hand_cards: 13 haipai + the chonbo (their
        // 14th tile, pre-dealt by RC instead of being drawn from
        // the wall on turn 1). Stash it for the synthetic opening
        // `draw` event emitted just after `hand_start`.
        if (sub.hand_cards.length >= 14) {
          dealerChonboNum = sub.hand_cards[13];
        }
      }
      if (sub.dealer_pos !== undefined) {
        dealer = (sub.dealer_pos % 4) as Seat;
      }
      if (sub.quan_feng !== undefined) {
        roundWind = decodeQuanFeng(sub.quan_feng);
      }
      if (sub.chang_ci !== undefined) {
        // `chang_ci` is already 1-indexed in real Riichi City
        // payloads (East 1 → `chang_ci: 1`). Use it directly.
        roundNumber = sub.chang_ci;
      }
      if (sub.ben_chang_num !== undefined) {
        honba = sub.ben_chang_num;
      }
      if (sub.li_zhi_bang_num !== undefined) {
        riichiSticks = sub.li_zhi_bang_num;
      }
      if (sub.bao_pai_card !== undefined && doraIndicator === null) {
        doraIndicator = tileToString(sub.bao_pai_card) as Tile;
      }
      if (firstStartTime === 0 && ev.startTime) {
        firstStartTime = ev.startTime;
      }
    }

    const walls = parseHandCardEncode(round.handCardEncode);
    events.push({
      type: "hand_start",
      round: roundIdx,
      dealer,
      roundWind,
      roundNumber,
      honba,
      riichiSticks,
      scores: [...scores],
      startingHands,
      doraIndicators: doraIndicator ? [doraIndicator] : [],
      ...(walls ?? {}),
    });

    // Synthetic opening draw for the dealer. RC pre-deals the
    // dealer's chonbo as `hand_cards[13]` and emits a phantom
    // `Draw` event with `in_card: 0` to mark turn-start. We strip
    // that phantom in the Draw handler and emit a real draw here
    // instead so downstream consumers see a uniform
    // draw → discard sequence for every turn.
    if (dealerChonboNum !== null) {
      lastDrawTile[dealer] = dealerChonboNum;
      events.push({
        type: "draw",
        seat: dealer,
        tile: tileToString(dealerChonboNum) as Tile,
        wallRemaining: 0,
      });
    }

    let lastDiscarder: Seat | null = null;
    let lastDiscardTile: Tile | null = null;

    for (const ev of handEvents) {
      if (ev.startTime) {
        lastEventTime = ev.startTime;
      }
      const seat = seatOf(ev.userId);

      switch (ev.eventType) {
        case EventType.StartingHand:
          // Already consumed in the prelude pass.
          break;

        case EventType.Draw: {
          const sub = decode(ev.data);
          // Phantom `in_card: 0` Draw events are turn-markers, not
          // real wall draws. They occur:
          //   1. on the dealer's opening turn (chonbo is pre-dealt
          //      as `hand_cards[13]` — we already emit a synthetic
          //      draw for that just after `hand_start`), and
          //   2. immediately after a chi/pon call (the caller
          //      absorbed the called tile, no draw from the wall).
          // Skip them: `lastDrawTile` must NOT be reset to 0, or
          // every subsequent tsumogiri check would misfire.
          if (!sub.in_card) {
            break;
          }
          lastDrawTile[seat] = sub.in_card;
          events.push({
            type: "draw",
            seat,
            tile: tileToString(sub.in_card) as Tile,
            wallRemaining: 0,
          });
          break;
        }

        case EventType.DiscardOrCall: {
          const sub = decode(ev.data);
          const action = sub.action;
          if (action === ActionType.Discard) {
            const tileNum = sub.card;
            if (tileNum === undefined) {
              break;
            }
            const tile = tileToString(tileNum) as Tile;
            const tsumogiri = lastDrawTile[seat] === tileNum;
            const isRiichi = Boolean(sub.is_li_zhi);
            events.push({
              type: "discard",
              seat,
              tile,
              tsumogiri,
              ...(isRiichi ? { riichi: true } : {}),
            });
            lastDiscarder = seat;
            lastDiscardTile = tile;
          } else {
            const meld = decodeCall(sub, seat, lastDiscarder, lastDiscardTile);
            if (meld) {
              events.push({ type: "call", seat, meld });
            }
          }
          break;
        }

        case EventType.NewDoraIndicator: {
          const sub = decode(ev.data);
          // Riichi City carries the new indicator on `card` (or
          // `in_card` for some kan-flip variants); fall back across
          // both to be tolerant of payload drift.
          const indicatorRaw = sub.card ?? sub.in_card;
          if (indicatorRaw !== undefined) {
            events.push({
              type: "new_dora",
              indicator: tileToString(indicatorRaw) as Tile,
            });
          }
          break;
        }

        case EventType.RoundEnd: {
          emitRoundEnd(
            decode(ev.data),
            lastDrawTile,
            lastDiscarder,
            lastDiscardTile
          );
          break;
        }

        default:
          // GameEnd is consumed at the top level; TenpaiReached and
          // ActionOnDiscard don't contribute new replay events.
          break;
      }
    }
  }

  function emitRoundEnd(
    sub: SubHand,
    lastDrawTile: Array<number | null>,
    lastDiscarder: Seat | null,
    lastDiscardTile: Tile | null
  ): void {
    const rawWinInfos = sub.win_info ?? [];
    const profits = sub.user_profit ?? [];
    const isRyuukyoku = sub.end_type === RoundEndType.RyuuKyoku;
    const isTsumo = sub.end_type === RoundEndType.Tsumo;

    // On exhaustive draws (and only-tenpai-listed aborts), Riichi
    // City reuses `win_info` to carry tenpai info for noten
    // payments: `fang_info` is null, `all_point` is 0, and
    // `ting_card_list` is populated. Filter those out so they are
    // not mistaken for actual wins. Real wins (including nagashi
    // mangan during ryuukyoku) keep `fang_info` populated with the
    // yaku list.
    const winInfos = rawWinInfos.filter(
      (w) => Array.isArray(w.fang_info) && w.fang_info.length > 0
    );

    // Per-seat point delta for this hand. We derive it from `user_point` (the
    // authoritative absolute score AFTER the hand) rather than
    // `point_profit + li_zhi_profit`: for a winner, `point_profit` already
    // folds in any riichi sticks they pick up, so adding `li_zhi_profit` on top
    // double-counts the 1000-per-stick collection and inflates the win value.
    // The score difference is exact, conserves to zero, and matches the
    // net-delta semantics the other platforms' adapters use.
    const delta: [number, number, number, number] = [0, 0, 0, 0];
    for (const profit of profits) {
      const seat = seatOf(profit.user_id);
      delta[seat] = profit.user_point - scores[seat];
      scores[seat] = profit.user_point;
    }

    // On a draw Riichi City lists every tenpai player in the (unfiltered)
    // `win_info`, even though those entries carry no `fang_info`. That is the
    // authoritative tenpai set used for noten payments, so surface it on the
    // `hand_end` so consumers (e.g. the stats projection) don't have to guess.
    const tenpaiAtDraw: [boolean, boolean, boolean, boolean] = [
      false,
      false,
      false,
      false,
    ];
    for (const w of rawWinInfos) {
      tenpaiAtDraw[seatOf(w.user_id)] = true;
    }

    if (winInfos.length > 0) {
      // Determine loser (single discarder for ron; null for tsumo).
      // Riichi City processes every winner of a (possibly multi-) ron off the
      // same discard, so the tracked `lastDiscarder` is the authoritative
      // dealer-in. Inferring it from the point delta is unreliable now that the
      // delta folds in riichi-stick movement.
      const loser = isTsumo || isRyuukyoku ? null : lastDiscarder;

      for (const win of winInfos) {
        emitWin(win, loser, isTsumo, lastDrawTile, lastDiscardTile);
      }

      // Nagashi mangan: a real win during what's flagged as a
      // ryuukyoku. Surface as exhaustive_draw at the hand level so
      // downstream consumers see the noten/nagashi flow; the win
      // events above still carry the points.
      if (isRyuukyoku) {
        events.push({
          type: "hand_end",
          reason: "exhaustive_draw",
          tenpai: tenpaiAtDraw,
          delta: [...delta],
          scores: [...scores],
        });
        return;
      }

      events.push({
        type: "hand_end",
        reason: isTsumo ? "tsumo" : "ron",
        delta: [...delta],
        scores: [...scores],
        honba: undefined,
        riichiSticks: undefined,
      });
      return;
    }

    if (isRyuukyoku) {
      events.push({
        type: "hand_end",
        reason: "exhaustive_draw",
        tenpai: tenpaiAtDraw,
        delta: [...delta],
        scores: [...scores],
      });
      return;
    }

    // Other end_type values (UnknownEndValue2..6) are abortive draws
    // (kyuushuu / suufon-renda / suucha-riichi / sanchahou). Riichi
    // City doesn't currently expose a clean discriminant for them,
    // so we surface them as a generic abort.
    events.push({
      type: "hand_end",
      reason: "abort",
      delta: [...delta],
      scores: [...scores],
    });
  }

  function emitWin(
    win: WinInfoData,
    loser: Seat | null,
    isTsumo: boolean,
    lastDrawTile: Array<number | null>,
    ronTile: Tile | null
  ): void {
    const seat = seatOf(win.user_id);
    let winTile: Tile | undefined;
    if (isTsumo) {
      const drawn = lastDrawTile[seat];
      if (drawn !== null) {
        winTile = tileToString(drawn) as Tile;
      }
    } else if (loser !== null) {
      // For ron the winning tile is the discarder's last discard.
      winTile = ronTile ?? undefined;
    }

    const yaku: Record<string, string> = {};
    const yakuHan: number[] = [];
    for (const fang of win.fang_info ?? []) {
      const han = riichiCityYakuTypeToHan(fang.fang_type);
      if (han !== undefined) {
        yakuHan.push(han);
      }
      const display =
        hanRomaji(riichiCityYakuTypeToHan(fang.fang_type)) ??
        `y${fang.fang_type}`;
      yaku[display] = `${fang.fang_num ?? 0}飜`;
    }

    // Dora / aka / ura han counts straight from the fan list (RC can't
    // provide indicator tiles, so these numeric counts are the only way a
    // stats projection can recover them).
    const doraCount = (win.fang_info ?? [])
      .filter((f) => f.fang_type === YakuType.Dora)
      .reduce((s, f) => s + (f.fang_num ?? 0), 0);
    const akaDoraCount = (win.fang_info ?? [])
      .filter((f) => f.fang_type === YakuType.Aka)
      .reduce((s, f) => s + (f.fang_num ?? 0), 0);
    const uraDoraCount = (win.fang_info ?? [])
      .filter((f) => f.fang_type === YakuType.Ura)
      .reduce((s, f) => s + (f.fang_num ?? 0), 0);

    events.push({
      type: "win",
      seat,
      loser,
      winTile,
      han: win.all_fang_num,
      fu: win.all_fu,
      ten: win.all_point,
      yaku: sortYakuRecord(yaku),
      yakuHan,
      doraCount,
      akaDoraCount,
      uraDoraCount,
      doraIndicators: undefined,
      uraDoraIndicators: undefined,
    });
  }
}

/**
 * Decode a chi/pon/kan call from a `DiscardOrCall` SubHandData.
 * Returns `null` for non-call actions (Tsumo/Ron, which are
 * surfaced via `RoundEnd` / `win` events instead).
 */
function decodeCall(
  sub: SubHand,
  caller: Seat,
  lastDiscarder: Seat | null,
  lastDiscardTile: Tile | null
): Meld | null {
  // Caller seat is captured at the event level; meld doesn't store it.
  void caller;
  const action = sub.action;
  if (action === undefined) {
    return null;
  }

  // RC carries the caller-contributed tiles on `group_cards` and
  // the claimed tile (or shouminkan-added tile) on `card`. The
  // legacy `cards` field exists in the public type but real
  // payloads never populate it, so we ignore it.
  const groupTiles: Tile[] = (sub.group_cards ?? []).map(
    (t) => tileToString(t) as Tile
  );
  const claimed: Tile | null =
    sub.card !== undefined ? (tileToString(sub.card) as Tile) : lastDiscardTile;

  switch (action) {
    case ActionType.ChiiYXX:
    case ActionType.ChiiXYX:
    case ActionType.ChiiXYY:
      return {
        type: "chi",
        tiles: claimed !== null ? [...groupTiles, claimed] : groupTiles,
        claimedTile: claimed,
        from: lastDiscarder,
      };

    case ActionType.Pon:
      return {
        type: "pon",
        tiles: claimed !== null ? [...groupTiles, claimed] : groupTiles,
        claimedTile: claimed,
        from: lastDiscarder,
      };

    case ActionType.Minkan: {
      // Riichi City reuses `Minkan` for both daiminkan (after a
      // discard) and shouminkan (added to an existing pon). The
      // shouminkan payload has no `group_cards` (the existing pon
      // already accounts for 3 tiles) and exactly one
      // `move_cards_pos` (the added tile pulled from the hand);
      // daiminkan ships 3 `group_cards`. The legacy
      // `is_gang_incard` / `bu_gang_cards` markers are not set on
      // real RC payloads, so detect via shape.
      const isShouminkan =
        sub.is_gang_incard === true ||
        (Array.isArray(sub.bu_gang_cards) && sub.bu_gang_cards.length > 0) ||
        groupTiles.length === 0;
      if (isShouminkan) {
        return {
          type: "shouminkan",
          // The pon being upgraded already supplies 3 tiles via
          // the existing meld; we only report the added tile here
          // so the player reducer removes exactly one copy from
          // the hand on upgrade.
          tiles: claimed !== null ? [claimed] : [],
          claimedTile: null,
          from: null,
        };
      }
      return {
        type: "daiminkan",
        tiles: claimed !== null ? [...groupTiles, claimed] : groupTiles,
        claimedTile: claimed,
        from: lastDiscarder,
      };
    }

    case ActionType.Ankan: {
      // Ankan: all 4 tiles come from the caller's hand. RC ships
      // 3 of them on `group_cards` (the copies already in hand)
      // and the 4th — the just-drawn tile that completed the
      // quad — on `card`. Combine both. If only `card` is
      // present, fall back to 4 copies of it.
      let tiles = claimed !== null ? [...groupTiles, claimed] : [...groupTiles];
      if (tiles.length === 1 && claimed !== null) {
        tiles = [claimed, claimed, claimed, claimed];
      }
      return {
        type: "ankan",
        tiles,
        claimedTile: null,
        from: null,
      };
    }

    default:
      return null;
  }
}
