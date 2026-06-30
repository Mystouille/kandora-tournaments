import syanten from "syanten";
import { handToSyantenFormat } from "~/api/majsoul/handToSyantenFormat";
import type { GameEvent } from "~/game/protocol/messages";
import {
  type GameRecordData,
  getNewRoundEndEvent,
  type UsersRounds,
} from "~/api/majsoul/types/gameRecordData";

/**
 * Platform-agnostic projection of per-game statistics from the neutral
 * {@link GameEvent} stream (a `ReplayLog`'s `events`). This is the single
 * source of truth for `GameRecord.roundEvents`, replacing the three
 * per-platform stat parsers (Majsoul / Tenhou / Riichi City) so a parsing
 * quirk on one platform can't silently corrupt stats (e.g. the Riichi City
 * "tenpai reveal counted as a win on a draw" bug).
 *
 * The reducer never branches on `source`: every platform adapter already emits
 * the same event shapes, so the metrics are derived uniformly. Fields that the
 * ranking cards consume (dora/ura/han/fu, win/tsumo/deal-in flags, points,
 * calls, tenpai turn) are computed exactly; informational-only fields
 * (haipaiShanten, kanNumber, riichiStickDiff, winningTile, yakus) are filled
 * best-effort.
 *
 * Unified definitions (see ADRs in the league-stats notes):
 *  - `totalDoraValue` = regular dora + red fives (aka); ura is reported
 *    separately in `uraDoraValue`.
 *  - `pointsDiff` = each seat's net score change for the hand (the value the
 *    log carries directly in `hand_end.delta`), including riichi-stick pickup.
 */
export interface BuildGameRecordParams {
  gameId: string;
  startTime: Date;
  endTime?: Date;
  events: GameEvent[];
  /** seat index → platform user id (the connector supplies this; the neutral
   *  ReplayLog seats don't carry the platform id). */
  seatToUserId: string[];
  /** seat index → display nickname. */
  seatToNickname: string[];
  /** Final per-seat standings from the ReplayLog seats, used to fill each
   *  player's `score`/`place`. The ReplayLog already computes these uniformly
   *  across platforms, so the connector can pass `replay.seats` straight
   *  through. */
  seats?: { seat: number; finalScore: number; place: number }[];
}

interface SeatHandState {
  numberOfCalls: number;
  kanNumber: number;
  wasOpened: boolean;
  hasRiichi: boolean;
  firstTenpaiTurn: number;
  turnCount: number;
  haipaiShanten: number;
}

interface SeatWin {
  isTsumo: boolean;
  winTile: string | undefined;
  han: number;
  fu: number;
  dora: number;
  ura: number;
  yakuHan: number[];
}

function freshSeatState(seatCount: number): SeatHandState[] {
  return Array.from({ length: seatCount }, () => ({
    numberOfCalls: 0,
    kanNumber: 0,
    wasOpened: false,
    hasRiichi: false,
    firstTenpaiTurn: -1,
    turnCount: 0,
    haipaiShanten: -2,
  }));
}

export function buildGameRecordFromReplay(
  params: BuildGameRecordParams
): GameRecordData {
  const { gameId, startTime, endTime, events, seatToUserId, seatToNickname } =
    params;
  const seatCount = seatToUserId.length;

  const standingBySeat = new Map((params.seats ?? []).map((s) => [s.seat, s]));

  const byUserData: UsersRounds[] = seatToUserId.map((userId, seat) => {
    const standing = standingBySeat.get(seat);
    return {
      userId,
      seat,
      nickname: seatToNickname[seat] ?? "",
      roundEvents: [],
      ...(standing
        ? { score: standing.finalScore, place: standing.place }
        : {}),
    };
  });

  let dealer = 0;
  let state = freshSeatState(seatCount);
  const wins = new Map<number, SeatWin>();
  const ronnedSeats = new Set<number>();

  for (const ev of events) {
    switch (ev.type) {
      case "hand_start": {
        dealer = ev.dealer;
        state = freshSeatState(seatCount);
        wins.clear();
        ronnedSeats.clear();
        if (ev.startingHands) {
          for (let s = 0; s < seatCount; s++) {
            const hand = ev.startingHands[s];
            if (hand && hand.length >= 13) {
              try {
                // Haipai shanten is measured on the 13-tile dealt hand. The
                // dealer's platform hand includes a 14th tile (their first
                // draw); slicing to 13 excludes it so every seat is scored on
                // its true starting hand, never the post-draw 14-tile hand.
                state[s].haipaiShanten = syanten(
                  handToSyantenFormat(hand.slice(0, 13))
                );
              } catch {
                state[s].haipaiShanten = -2;
              }
            }
          }
        }
        break;
      }

      case "discard": {
        const st = state[ev.seat];
        if (!st) {
          break;
        }
        st.turnCount++;
        if (ev.riichi) {
          st.hasRiichi = true;
          if (st.firstTenpaiTurn < 0) {
            st.firstTenpaiTurn = st.turnCount;
          }
        } else if (ev.waits && ev.waits.length > 0 && st.firstTenpaiTurn < 0) {
          // Platforms that expose per-discard waits (Majsoul) let us catch a
          // tenpai that was reached without declaring riichi.
          st.firstTenpaiTurn = st.turnCount;
        }
        break;
      }

      case "call": {
        const st = state[ev.seat];
        if (!st) {
          break;
        }
        switch (ev.meld.type) {
          case "chi":
          case "pon":
            st.numberOfCalls++;
            st.wasOpened = true;
            break;
          case "daiminkan":
            st.numberOfCalls++;
            st.wasOpened = true;
            st.kanNumber++;
            break;
          case "shouminkan":
            // Upgrade of an existing pon — already counted as an open call.
            st.wasOpened = true;
            st.kanNumber++;
            break;
          case "ankan":
            // Concealed kan does not open the hand.
            st.kanNumber++;
            break;
        }
        break;
      }

      case "win": {
        wins.set(ev.seat, {
          isTsumo: ev.loser == null,
          winTile: ev.winTile,
          han: ev.han ?? 0,
          fu: ev.fu ?? 0,
          dora: (ev.doraCount ?? 0) + (ev.akaDoraCount ?? 0),
          ura: ev.uraDoraCount ?? 0,
          yakuHan: ev.yakuHan ?? [],
        });
        if (ev.loser != null) {
          ronnedSeats.add(ev.loser);
        }
        break;
      }

      case "hand_end": {
        const ryuukyoku = ev.reason === "exhaustive_draw";
        const delta = ev.delta ?? [0, 0, 0, 0];
        const tenpai = ev.tenpai ?? [false, false, false, false];
        const riichiSticks = ev.riichiSticks ?? 0;

        // Standard exhaustive-draw noten payment (tenpai gain / noten loss),
        // derived from the tenpai count so it's identical across platforms and
        // excludes riichi-stick deposits (those are reported via
        // riichiStickDiff). Mirrors the historical per-platform stat parsers.
        const nbTenpai = tenpai.filter(Boolean).length;
        const tenpaiGain =
          nbTenpai === 1
            ? 3000
            : nbTenpai === 2
              ? 1500
              : nbTenpai === 3
                ? 1000
                : 0;
        const notenLoss =
          nbTenpai === 1
            ? -1000
            : nbTenpai === 2
              ? -1500
              : nbTenpai === 3
                ? -3000
                : 0;

        for (let s = 0; s < seatCount; s++) {
          const st = state[s];
          const win = wins.get(s);
          const evt = getNewRoundEndEvent(byUserData[s].userId);

          evt.wasDealer = s === dealer;
          evt.haipaiShanten = st.haipaiShanten;
          evt.wasOpened = st.wasOpened;
          evt.numberOfCalls = st.numberOfCalls;
          evt.kanNumber = st.kanNumber;
          evt.hasRiichi = st.hasRiichi;
          evt.firstTenpaiTurn = st.firstTenpaiTurn;
          evt.ryuukyoku = ryuukyoku;
          evt.pointsDiff = delta[s] ?? 0;

          // riichiStickDiff is informational only (no ranking card reads it):
          // each declarer deposits 1000; the winner picks up the table pot when
          // the source records it (Tenhou). Approximate when unknown.
          let stick = st.hasRiichi ? -1000 : 0;

          if (win) {
            evt.isWinner = true;
            evt.isTsumo = win.isTsumo;
            evt.winningTile = win.winTile;
            evt.hanValue = win.han;
            evt.fuValue = win.fu;
            evt.totalDoraValue = win.dora;
            evt.uraDoraValue = win.ura;
            evt.yakus = win.yakuHan;
            stick += riichiSticks * 1000;
          }

          evt.gotRonned = ronnedSeats.has(s) && !win;
          evt.finishedTenpai = !!win || (ryuukyoku && !!tenpai[s]);
          evt.ryuukyokuValue = ryuukyoku
            ? tenpai[s]
              ? tenpaiGain
              : notenLoss
            : 0;
          evt.riichiStickDiff = stick;

          byUserData[s].roundEvents.push(evt);
        }
        break;
      }

      default:
        break;
    }
  }

  return { gameId, startTime, endTime, byUserData };
}
