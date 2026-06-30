/**
 * Phase 4.5 step 11 — real-log oracle harness.
 *
 * Walks `app/api/_fixtures/replay/metadata.json` and, for each
 * fixture entry, runs the matching adapter and asserts the
 * resulting `ReplayLog` matches the platform-reported expectations.
 *
 * Adding a new fixture:
 *   1. Drop the raw payload into
 *      `app/api/_fixtures/replay/<source>/<filename>` (use the
 *      dump script for the source — e.g.
 *      `scripts/_dump-majsoul-replays.ts <uuid> …`).
 *   2. Add a metadata entry keyed by `<source>/<filename>` with the
 *      `kind` / `expectedFinalScores` / `expectedWinSeats` /
 *      `expectedHandCount` fields. Verify the numbers against the
 *      platform's own replay UI.
 *   3. Re-run `npx vitest run app/api/_fixtures`.
 *
 * Each per-source describe block skips itself when no fixtures of
 * that source are present, so contributors without the fixtures
 * checked out (they may be too large or PII-sensitive) still get
 * a green test suite.
 */
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

import { describe, expect, it } from "vitest";

import { parseMajsoulReplay } from "~/api/majsoul/replayAdapter";
import type { GameRecord } from "~/api/majsoul/data/types/GameRecord";
import { parseRiichiCityReplay } from "~/api/riichiCity/replayAdapter";
import { parseTenhouXmlReplay } from "~/api/tenhou/replayAdapter";
import { EventType, type GameData } from "~/services/riichiCityModels";
import type { ReplayLog } from "~/game/replay/types";

interface FixtureMeta {
  kind: "tsumo" | "ron" | "exhaustive" | "abort";
  expectedFinalScores: number[];
  expectedWinSeats: number[];
  /**
   * Per-win mode in the same order as `expectedWinSeats`. Optional
   * for backwards compatibility with fixtures captured before this
   * field existed; new fixtures should always include it.
   */
  expectedWinModes?: ("tsumo" | "ron")[];
  /**
   * Per-hand outcome reason in `hand_end` event order (i.e. one
   * entry per hand that was actually played and ended). Used to
   * cross-check abortive / exhaustive / win classifications.
   * Optional for fixtures captured before this field existed.
   */
  expectedHandEndReasons?: ("tsumo" | "ron" | "exhaustive_draw" | "abort")[];
  /**
   * Per-hand abort kind, in `hand_end` event order. `null` for
   * non-abort hands. Optional, but recommended for any fixture
   * that contains at least one abortive draw.
   */
  expectedAbortKinds?: (
    | "kyuushuu"
    | "suufon_renda"
    | "suucha_riichi"
    | "sanchahou"
    | null
  )[];
  expectedHandCount: number;
  notes?: string;
}

const FIXTURES_DIR = resolve(__dirname);
const METADATA_PATH = resolve(FIXTURES_DIR, "metadata.json");

const metadata: Record<string, FixtureMeta> = existsSync(METADATA_PATH)
  ? (JSON.parse(readFileSync(METADATA_PATH, "utf8")) as Record<
      string,
      FixtureMeta
    >)
  : {};

/**
 * Restore class identity on Majsoul records. The Majsoul adapter
 * dispatches on `record.constructor.name`, which is erased when a
 * decoded record is serialized through `JSON.stringify`. The dump
 * script tags each record with `__type`; we rehydrate here into an
 * anonymous class whose `.name` === that tag.
 */
function rehydrateMajsoulRecord(record: Record<string, unknown>): unknown {
  const typeName = record.__type as string | undefined;
  if (!typeName) {
    return record;
  }
  const cls = {
    [typeName]: class {
      constructor(props: Record<string, unknown>) {
        Object.assign(this, props);
      }
    },
  }[typeName];
  const { __type: _drop, ...rest } = record;
  void _drop;
  return new cls(rest);
}

function loadMajsoulFixture(relPath: string): GameRecord {
  const raw = JSON.parse(
    readFileSync(resolve(FIXTURES_DIR, relPath), "utf8")
  ) as GameRecord & { records?: Record<string, unknown>[] };
  if (Array.isArray(raw.records)) {
    raw.records = raw.records.map(rehydrateMajsoulRecord) as typeof raw.records;
  }
  return raw as GameRecord;
}

function assertOracle(log: ReplayLog, meta: FixtureMeta): void {
  // Final scores reported by the platform must match the adapter's
  // computed per-seat finalScore exactly.
  expect(log.seats.map((s) => s.finalScore)).toEqual(meta.expectedFinalScores);

  // Win events must occur in the recorded order, at the recorded
  // seats. (Empty array for exhaustive / abortive games.)
  const winEvents = log.events.filter((e) => e.type === "win");
  const winSeats = winEvents.map((e) => (e.type === "win" ? e.seat : -1));
  expect(winSeats).toEqual(meta.expectedWinSeats);

  // Win modes: tsumo when `loser` is null, ron otherwise. Guards
  // against the adapter mis-emitting a self-draw as a deal-in (or
  // vice-versa).
  if (meta.expectedWinModes) {
    const winModes = winEvents.map((e): "tsumo" | "ron" =>
      e.type === "win" && e.loser == null ? "tsumo" : "ron"
    );
    expect(winModes).toEqual(meta.expectedWinModes);
  }

  // Hand count = number of hand_start events.
  const handStarts = log.events.filter((e) => e.type === "hand_start").length;
  expect(handStarts).toBe(meta.expectedHandCount);

  // Optional: per-hand outcome reason ("tsumo" | "ron" | "exhaustive_draw" | "abort")
  if (meta.expectedHandEndReasons) {
    const reasons = log.events
      .filter((e) => e.type === "hand_end")
      .map((e) => (e.type === "hand_end" ? e.reason : "abort"));
    expect(reasons).toEqual(meta.expectedHandEndReasons);
  }

  // Optional: per-hand abort kind (null for non-abort hands)
  if (meta.expectedAbortKinds) {
    const abortKinds = log.events
      .filter((e) => e.type === "hand_end")
      .map((e) =>
        e.type === "hand_end" && e.reason === "abort"
          ? (e.abortKind ?? null)
          : null
      );
    expect(abortKinds).toEqual(meta.expectedAbortKinds);
  }
}

// ─── Majsoul ────────────────────────────────────────────────────────
const majsoulFixtures = Object.entries(metadata).filter(([key]) =>
  key.startsWith("majsoul/")
);

(majsoulFixtures.length === 0 ? describe.skip : describe)(
  "Majsoul replay adapter — real-log oracle",
  () => {
    for (const [relPath, meta] of majsoulFixtures) {
      it(`${relPath} (${meta.kind})`, () => {
        const record = loadMajsoulFixture(relPath);
        const log = parseMajsoulReplay(record);
        assertOracle(log, meta);
      });

      it(`${relPath} is idempotent`, () => {
        const record = loadMajsoulFixture(relPath);
        const a = parseMajsoulReplay(record);
        const b = parseMajsoulReplay(loadMajsoulFixture(relPath));
        expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
      });
    }
  }
);

// ─── Tenhou (XML / JSON) ────────────────────────────────────────────
// Tenhou XML fixtures live in tenhou-xml/<logId>.xml. The logId
// embedded in the filename (sans extension) is what we pass to
// `parseTenhouXmlReplay` as `sourceGameId`.
function loadTenhouXmlFixture(relPath: string): {
  xml: string;
  logId: string;
} {
  const xml = readFileSync(resolve(FIXTURES_DIR, relPath), "utf8");
  const file = relPath.split("/").pop()!;
  const logId = file.replace(/\.xml$/, "");
  return { xml, logId };
}

const tenhouXmlFixtures = Object.entries(metadata).filter(([key]) =>
  key.startsWith("tenhou-xml/")
);

(tenhouXmlFixtures.length === 0 ? describe.skip : describe)(
  "Tenhou XML replay adapter — real-log oracle",
  () => {
    for (const [relPath, meta] of tenhouXmlFixtures) {
      it(`${relPath} (${meta.kind})`, () => {
        const { xml, logId } = loadTenhouXmlFixture(relPath);
        const log = parseTenhouXmlReplay(xml, logId);
        assertOracle(log, meta);
      });

      it(`${relPath} is idempotent`, () => {
        const { xml, logId } = loadTenhouXmlFixture(relPath);
        const a = parseTenhouXmlReplay(xml, logId);
        const b = parseTenhouXmlReplay(xml, logId);
        expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
      });
    }
  }
);

// ─── Riichi City ────────────────────────────────────────────────────
/**
 * Riichi City `GameData` does not carry seat metadata at the
 * top level — seat order is derived from the first round's
 * `StartingHand` events (each carries `userId`), and nicknames
 * are then hydrated from the per-round `players` snapshot. Mirrors
 * the helper in `RiichiCityLeagueConnector.deriveSeatOrder`.
 */
function deriveSeatOrder(game: GameData): {
  seatToUserId: string[];
  seatToNickname: string[];
} {
  const seatToUserId: string[] = [];
  const seatToNickname: string[] = [];
  const round0 = game.handRecord[0];
  if (!round0) {
    return { seatToUserId, seatToNickname };
  }

  const nicknameByUserId = new Map<string, string>();
  for (const p of round0.players ?? []) {
    nicknameByUserId.set(p.userId.toString(), p.nickname);
  }

  for (const event of round0.handEventRecord) {
    if (event.eventType === EventType.StartingHand) {
      const uid = event.userId.toString();
      if (!seatToUserId.includes(uid)) {
        seatToUserId.push(uid);
        const seatIdx = seatToUserId.length - 1;
        seatToNickname.push(nicknameByUserId.get(uid) || `Seat ${seatIdx}`);
      }
    }
  }
  return { seatToUserId, seatToNickname };
}

function loadRiichiCityFixture(relPath: string): GameData {
  return JSON.parse(
    readFileSync(resolve(FIXTURES_DIR, relPath), "utf8")
  ) as GameData;
}

function parseRiichiCityFixture(relPath: string): ReplayLog {
  const game = loadRiichiCityFixture(relPath);
  const { seatToUserId, seatToNickname } = deriveSeatOrder(game);
  return parseRiichiCityReplay(game, seatToUserId, seatToNickname);
}

const riichiCityFixtures = Object.entries(metadata).filter(([key]) =>
  key.startsWith("riichicity/")
);

(riichiCityFixtures.length === 0 ? describe.skip : describe)(
  "Riichi City replay adapter — real-log oracle",
  () => {
    for (const [relPath, meta] of riichiCityFixtures) {
      it(`${relPath} (${meta.kind})`, () => {
        const log = parseRiichiCityFixture(relPath);
        assertOracle(log, meta);
      });

      it(`${relPath} is idempotent`, () => {
        const a = parseRiichiCityFixture(relPath);
        const b = parseRiichiCityFixture(relPath);
        expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
      });
    }
  }
);
