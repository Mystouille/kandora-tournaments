import { Capacitor } from "@capacitor/core";
import { z } from "zod";
import {
  assertContiguousMatchEvents,
  createMemoryMatchRepository,
  parseMatchRecoveryRecord,
  type MatchEventJournalStore,
  type MatchRecoveryRecord,
  type MatchRepository,
  type MemoryMatchRepository,
} from "~/game/server/src/repository";
import {
  parseMatchCheckpoint,
  type MatchCheckpoint,
} from "~/game/server/src/checkpoint";
import { REPLAY_LOG_SCHEMA_VERSION } from "~/game/replay/types";

const DATABASE_NAME = "kandora_mobile";
const DATABASE_VERSION = 2;

const MOBILE_REPLAYS_V1_SCHEMA = `CREATE TABLE IF NOT EXISTS mobile_replays (
  source TEXT NOT NULL,
  source_game_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (source, source_game_id)
)`;

const ReplaySourceSchema = z.enum([
  "ingame",
  "majsoul",
  "tenhou",
  "riichicity",
]);

const MobileReplaySeatSchema = z.object({
  seat: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  displayName: z.string(),
  finalScore: z.number().finite(),
  place: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
});

const MobileStoredReplaySummarySchema = z.object({
  source: ReplaySourceSchema,
  sourceGameId: z.string().min(1),
  ruleSet: z.string().min(1),
  startedAt: z.number().finite(),
  endedAt: z.number().finite(),
  seats: z.array(MobileReplaySeatSchema).max(4),
});

const StoredReplayRowSchema = z.object({
  source: z.string(),
  source_game_id: z.string(),
  payload_json: z.string(),
  summary_json: z.string().nullable().optional(),
});

export type MobileStoredReplaySummary = z.infer<
  typeof MobileStoredReplaySummarySchema
>;

export interface MobileReplayStore {
  listReplaySummaries(): Promise<MobileStoredReplaySummary[]>;
}

const RecoveryRowSchema = z.object({
  checkpoint_json: z.string().nullable(),
  pending_command_json: z.string().nullable(),
  terminal_at: z.number().nullable(),
});

const JournalStateRowSchema = z.object({
  status: z.enum(["playing", "finished", "aborted"]),
  next_seq: z.number().int().nonnegative(),
});

export interface MobileMatchRepositoryHandle {
  repository: MatchRepository;
  eventJournalStore: MatchEventJournalStore;
  replayStore: MobileReplayStore;
  storage: "sqlite" | "memory";
  getActiveMatch(): Promise<MobileActiveMatch | null>;
  setActiveMatch(activeMatch: MobileActiveMatch | null): Promise<void>;
  close(): Promise<void>;
}

export interface MobileActiveMatch {
  matchId: string;
  owner: "solo" | "nearby-host";
}

export interface MobileSqliteDatabase {
  execute(
    statements: string,
    transaction?: boolean
  ): Promise<{ changes?: { changes?: number } }>;
  query(statement: string, values?: unknown[]): Promise<{ values?: unknown[] }>;
  run(
    statement: string,
    values?: unknown[]
  ): Promise<{ changes?: { changes?: number } }>;
  executeTransaction(
    tasks: Array<{ statement: string; values?: unknown[] }>
  ): Promise<{ changes?: { changes?: number } }>;
}

function serialize(value: unknown): string {
  return JSON.stringify(value);
}

function affectedRows(result: { changes?: { changes?: number } }): number {
  return result.changes?.changes ?? 0;
}

function storedReplaySummary(
  args: Parameters<MatchRepository["archiveReplayLog"]>[0]
): MobileStoredReplaySummary {
  return MobileStoredReplaySummarySchema.parse({
    source: args.source ?? "ingame",
    sourceGameId: args.sourceGameId ?? args.matchId,
    ruleSet: args.ruleSet,
    startedAt: args.startedAt.getTime(),
    endedAt: args.endedAt.getTime(),
    seats: args.seats.map(({ seat, displayName, finalScore, place }) => ({
      seat,
      displayName,
      finalScore,
      place,
    })),
  });
}

function parseStoredReplaySummary(
  raw: string
): MobileStoredReplaySummary | null {
  try {
    return MobileStoredReplaySummarySchema.parse(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

function sortReplaySummaries(
  summaries: MobileStoredReplaySummary[]
): MobileStoredReplaySummary[] {
  return summaries.sort(
    (left, right) =>
      right.startedAt - left.startedAt ||
      right.endedAt - left.endedAt ||
      left.sourceGameId.localeCompare(right.sourceGameId)
  );
}

class SqliteMatchRepository
  implements MatchRepository, MatchEventJournalStore, MobileReplayStore
{
  constructor(private readonly database: MobileSqliteDatabase) {}

  async createMatch(args: Parameters<MatchRepository["createMatch"]>[0]) {
    await this.database.executeTransaction([
      {
        statement: `INSERT INTO mobile_matches (
           match_id, seed, players_json, session_id, game_index,
           status, started_at, events_json, final_scores_json
         ) VALUES (?, ?, ?, ?, ?, 'playing', ?, '[]', NULL)
         ON CONFLICT(match_id) DO NOTHING`,
        values: [
          args.matchId,
          args.seed,
          serialize(args.players),
          args.sessionId ?? null,
          args.gameIndex ?? null,
          Date.now(),
        ],
      },
      {
        statement: `INSERT INTO mobile_match_journals (
           match_id, status, next_seq
         ) VALUES (?, 'playing', ?)
         ON CONFLICT(match_id) DO NOTHING`,
        values: [args.matchId, args.initialEventSeq],
      },
    ]);
  }

  async archiveMatch(args: Parameters<MatchRepository["archiveMatch"]>[0]) {
    const result = await this.database.run(
      `UPDATE mobile_matches
       SET status = 'finished', ended_at = ?, events_json = ?,
           final_scores_json = ?
       WHERE match_id = ?`,
      [
        Date.now(),
        serialize(args.events),
        serialize(args.finalScores),
        args.matchId,
      ]
    );
    if (affectedRows(result) !== 1) {
      throw new Error(`Cannot archive unknown mobile match ${args.matchId}`);
    }
    const nextSeq =
      args.events.length === 0
        ? 0
        : assertContiguousMatchEvents(args.events).nextSeq;
    await this.database.executeTransaction([
      {
        statement: `INSERT INTO mobile_match_journals (
           match_id, status, next_seq
         ) VALUES (?, 'finished', ?)
         ON CONFLICT(match_id) DO UPDATE SET
           status = 'finished', next_seq = excluded.next_seq`,
        values: [args.matchId, nextSeq],
      },
      {
        statement: "DELETE FROM mobile_match_events WHERE match_id = ?",
        values: [args.matchId],
      },
    ]);
  }

  async appendMatchEvents(
    args: Parameters<MatchEventJournalStore["appendMatchEvents"]>[0]
  ) {
    const { firstSeq, nextSeq } = assertContiguousMatchEvents(args.events);
    const stored = await this.loadMatchEventJournalState(args.matchId);
    if (stored === null) {
      throw new Error(
        `Cannot append events for unknown mobile match ${args.matchId}`
      );
    }
    if (stored.status !== "playing" || stored.nextSeq >= nextSeq) {
      return;
    }
    if (stored.nextSeq !== firstSeq) {
      throw new Error(
        `Mobile match ${args.matchId} expected event seq ${stored.nextSeq}, got ${firstSeq}`
      );
    }
    await this.database.executeTransaction([
      ...args.events.map((entry) => ({
        statement: `INSERT INTO mobile_match_events (
           match_id, seq, emitted_at, event_json
         ) VALUES (?, ?, ?, ?)
         ON CONFLICT(match_id, seq) DO NOTHING`,
        values: [
          args.matchId,
          entry.seq,
          entry.emittedAt,
          serialize(entry.event),
        ],
      })),
      {
        statement: `UPDATE mobile_match_journals
         SET next_seq = ?
         WHERE match_id = ? AND status = 'playing' AND next_seq = ?`,
        values: [nextSeq, args.matchId, firstSeq],
      },
    ]);
  }

  async loadMatchEventJournalState(matchId: string): Promise<{
    status: "playing" | "finished" | "aborted";
    nextSeq: number;
  } | null> {
    const result = await this.database.query(
      `SELECT status, next_seq FROM mobile_match_journals
       WHERE match_id = ?`,
      [matchId]
    );
    const row = JournalStateRowSchema.safeParse(result.values?.[0]);
    return row.success
      ? { status: row.data.status, nextSeq: row.data.next_seq }
      : null;
  }

  async archiveReplayLog(
    args: Parameters<MatchRepository["archiveReplayLog"]>[0]
  ) {
    const source = args.source ?? "ingame";
    const sourceGameId = args.sourceGameId ?? args.matchId;
    const summary = storedReplaySummary(args);
    const payload = {
      source,
      sourceGameId,
      ruleSet: args.ruleSet,
      ...(args.ruleSetDetails ? { ruleSetDetails: args.ruleSetDetails } : {}),
      startedAt: args.startedAt.getTime(),
      endedAt: args.endedAt.getTime(),
      seats: args.seats,
      events: args.events,
      schemaVersion: REPLAY_LOG_SCHEMA_VERSION,
    };
    await this.database.run(
      `INSERT INTO mobile_replays (
         source, source_game_id, payload_json, summary_json, updated_at
       ) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(source, source_game_id) DO UPDATE SET
         payload_json = excluded.payload_json,
         summary_json = excluded.summary_json,
         updated_at = excluded.updated_at`,
      [source, sourceGameId, serialize(payload), serialize(summary), Date.now()]
    );
  }

  async listReplaySummaries(): Promise<MobileStoredReplaySummary[]> {
    const result = await this.database.query(
      `SELECT source, source_game_id, payload_json, summary_json
       FROM mobile_replays
       WHERE source = ?`,
      ["ingame"]
    );
    const summaries: MobileStoredReplaySummary[] = [];
    const backfills: Array<{ statement: string; values: unknown[] }> = [];
    for (const value of result.values ?? []) {
      const row = StoredReplayRowSchema.safeParse(value);
      if (!row.success) {
        console.error("Skipping an invalid mobile replay row");
        continue;
      }
      const stored = row.data.summary_json
        ? parseStoredReplaySummary(row.data.summary_json)
        : null;
      const summary = stored ?? parseStoredReplaySummary(row.data.payload_json);
      if (summary === null || summary.source !== "ingame") {
        console.error(
          `Skipping invalid mobile replay ${row.data.source}/${row.data.source_game_id}`
        );
        continue;
      }
      summaries.push(summary);
      if (!row.data.summary_json) {
        backfills.push({
          statement: `UPDATE mobile_replays
                      SET summary_json = ?
                      WHERE source = ? AND source_game_id = ?
                        AND summary_json IS NULL`,
          values: [
            serialize(summary),
            row.data.source,
            row.data.source_game_id,
          ],
        });
      }
    }
    if (backfills.length > 0) {
      try {
        await this.database.executeTransaction(backfills);
      } catch (error) {
        console.error("Failed to backfill mobile replay summaries:", error);
      }
    }
    return sortReplaySummaries(summaries);
  }

  async saveCheckpoint(args: { matchId: string; checkpoint: MatchCheckpoint }) {
    const checkpoint = parseMatchCheckpoint(args.checkpoint);
    const result = await this.database.run(
      `INSERT INTO match_recovery (
         match_id, checkpoint_json, pending_command_json,
         terminal_at, updated_at
       ) VALUES (?, ?, NULL, NULL, ?)
       ON CONFLICT(match_id) DO UPDATE SET
         checkpoint_json = excluded.checkpoint_json,
         pending_command_json = NULL,
         updated_at = excluded.updated_at
       WHERE match_recovery.terminal_at IS NULL`,
      [args.matchId, serialize(checkpoint), Date.now()]
    );
    if (affectedRows(result) !== 1) {
      throw new Error(
        `Cannot save checkpoint for terminal match ${args.matchId}`
      );
    }
  }

  async saveCommandTransaction(
    args: Parameters<MatchRepository["saveCommandTransaction"]>[0]
  ) {
    const recovery = parseMatchRecoveryRecord({
      checkpoint: args.checkpoint,
      pendingCommand: args.command,
    });
    const result = await this.database.run(
      `INSERT INTO match_recovery (
         match_id, checkpoint_json, pending_command_json,
         terminal_at, updated_at
       ) VALUES (?, ?, ?, NULL, ?)
       ON CONFLICT(match_id) DO UPDATE SET
         checkpoint_json = excluded.checkpoint_json,
         pending_command_json = excluded.pending_command_json,
         updated_at = excluded.updated_at
       WHERE match_recovery.terminal_at IS NULL`,
      [
        args.matchId,
        serialize(recovery.checkpoint),
        serialize(recovery.pendingCommand),
        Date.now(),
      ]
    );
    if (affectedRows(result) !== 1) {
      throw new Error(`Cannot save command for terminal match ${args.matchId}`);
    }
  }

  async loadCheckpoint(matchId: string): Promise<MatchCheckpoint | null> {
    return (await this.loadRecoveryRecord(matchId))?.checkpoint ?? null;
  }

  async loadRecoveryRecord(
    matchId: string
  ): Promise<MatchRecoveryRecord | null> {
    const result = await this.database.query(
      `SELECT checkpoint_json, pending_command_json, terminal_at
       FROM match_recovery WHERE match_id = ?`,
      [matchId]
    );
    if (result.values === undefined || result.values.length === 0) {
      return null;
    }
    const row = RecoveryRowSchema.parse(result.values[0]);
    if (row.terminal_at !== null || row.checkpoint_json === null) {
      return null;
    }
    return parseMatchRecoveryRecord({
      checkpoint: JSON.parse(row.checkpoint_json) as unknown,
      pendingCommand:
        row.pending_command_json === null
          ? null
          : (JSON.parse(row.pending_command_json) as unknown),
    });
  }

  async markCheckpointTerminal(
    args: Parameters<MatchRepository["markCheckpointTerminal"]>[0]
  ) {
    await this.database.run(
      `UPDATE match_recovery
       SET checkpoint_json = NULL, pending_command_json = NULL,
           terminal_at = ?, updated_at = ?
       WHERE match_id = ?`,
      [args.finishedAt, Date.now(), args.matchId]
    );
  }

  async deleteCheckpoint(matchId: string) {
    await this.database.run("DELETE FROM match_recovery WHERE match_id = ?", [
      matchId,
    ]);
  }
}

async function initializeSchema(database: MobileSqliteDatabase) {
  await database.execute(
    `PRAGMA foreign_keys = ON;
     CREATE TABLE IF NOT EXISTS match_recovery (
       match_id TEXT PRIMARY KEY NOT NULL,
       checkpoint_json TEXT,
       pending_command_json TEXT,
       terminal_at INTEGER,
       updated_at INTEGER NOT NULL
     );
     CREATE TABLE IF NOT EXISTS mobile_matches (
       match_id TEXT PRIMARY KEY NOT NULL,
       seed INTEGER NOT NULL,
       players_json TEXT NOT NULL,
       session_id TEXT,
       game_index INTEGER,
       status TEXT NOT NULL CHECK(status IN ('playing', 'finished')),
       started_at INTEGER NOT NULL,
       ended_at INTEGER,
       events_json TEXT NOT NULL,
       final_scores_json TEXT
     );
     CREATE TABLE IF NOT EXISTS mobile_match_journals (
       match_id TEXT PRIMARY KEY NOT NULL,
       status TEXT NOT NULL CHECK(status IN ('playing', 'finished', 'aborted')),
       next_seq INTEGER NOT NULL
     );
     CREATE TABLE IF NOT EXISTS mobile_match_events (
       match_id TEXT NOT NULL,
       seq INTEGER NOT NULL,
       emitted_at INTEGER NOT NULL,
       event_json TEXT NOT NULL,
       PRIMARY KEY (match_id, seq)
     );
     CREATE TABLE IF NOT EXISTS mobile_replays (
       source TEXT NOT NULL,
       source_game_id TEXT NOT NULL,
       payload_json TEXT NOT NULL,
       summary_json TEXT,
       updated_at INTEGER NOT NULL,
       PRIMARY KEY (source, source_game_id)
     );
     CREATE TABLE IF NOT EXISTS mobile_metadata (
       key TEXT PRIMARY KEY NOT NULL,
       value TEXT NOT NULL
     );`,
    true
  );
}

export function createSqliteMatchRepository(
  database: MobileSqliteDatabase
): MatchRepository & MatchEventJournalStore & MobileReplayStore {
  return new SqliteMatchRepository(database);
}

export function createMemoryMobileMatchRepository(): {
  repository: MemoryMatchRepository;
  replayStore: MobileReplayStore;
} {
  const baseRepository = createMemoryMatchRepository();
  const summaries = new Map<string, MobileStoredReplaySummary>();
  const repository: MemoryMatchRepository = {
    ...baseRepository,
    archiveReplayLog: async (args) => {
      await baseRepository.archiveReplayLog(args);
      const summary = storedReplaySummary(args);
      summaries.set(
        JSON.stringify([summary.source, summary.sourceGameId]),
        summary
      );
    },
  };
  return {
    repository,
    replayStore: {
      listReplaySummaries: async () =>
        sortReplaySummaries(
          [...summaries.values()]
            .filter((summary) => summary.source === "ingame")
            .map((summary) => MobileStoredReplaySummarySchema.parse(summary))
        ),
    },
  };
}

export async function openMobileMatchRepository(): Promise<MobileMatchRepositoryHandle> {
  if (!Capacitor.isNativePlatform()) {
    let activeMatch: MobileActiveMatch | null = null;
    const { repository, replayStore } = createMemoryMobileMatchRepository();
    return {
      repository,
      eventJournalStore: repository,
      replayStore,
      storage: "memory",
      getActiveMatch: async () => activeMatch,
      setActiveMatch: async (nextActiveMatch) => {
        activeMatch = nextActiveMatch;
      },
      close: async () => undefined,
    };
  }

  const { CapacitorSQLite, SQLiteConnection } =
    await import("@capacitor-community/sqlite");
  const sqlite = new SQLiteConnection(CapacitorSQLite);
  await sqlite.addUpgradeStatement(DATABASE_NAME, [
    {
      toVersion: 1,
      statements: [MOBILE_REPLAYS_V1_SCHEMA],
    },
    {
      toVersion: 2,
      statements: ["ALTER TABLE mobile_replays ADD COLUMN summary_json TEXT"],
    },
  ]);
  const existing = await sqlite.isConnection(DATABASE_NAME, false);
  const database = existing.result
    ? await sqlite.retrieveConnection(DATABASE_NAME, false)
    : await sqlite.createConnection(
        DATABASE_NAME,
        false,
        "no-encryption",
        DATABASE_VERSION,
        false
      );
  const opened = await database.isDBOpen();
  if (!opened.result) {
    await database.open();
  }
  await initializeSchema(database);

  const repository = createSqliteMatchRepository(database);

  return {
    repository,
    eventJournalStore: repository,
    replayStore: repository,
    storage: "sqlite",
    getActiveMatch: async () => {
      const metadata = await database.query(
        "SELECT key, value FROM mobile_metadata WHERE key IN (?, ?)",
        ["active_match_id", "active_match_owner"]
      );
      const values = z
        .array(z.object({ key: z.string(), value: z.string() }))
        .safeParse(metadata.values ?? []);
      if (values.success) {
        const matchId = values.data.find(
          (entry) => entry.key === "active_match_id"
        )?.value;
        const owner = values.data.find(
          (entry) => entry.key === "active_match_owner"
        )?.value;
        if (matchId !== undefined) {
          return {
            matchId,
            owner:
              owner === "nearby-host" || matchId.startsWith("nearby-")
                ? "nearby-host"
                : "solo",
          };
        }
      }
      const latest = await database.query(
        `SELECT match_id FROM match_recovery
         WHERE terminal_at IS NULL AND checkpoint_json IS NOT NULL
         ORDER BY updated_at DESC LIMIT 1`
      );
      const fallback = z
        .object({ match_id: z.string() })
        .safeParse(latest.values?.[0]);
      if (!fallback.success) {
        return null;
      }
      return {
        matchId: fallback.data.match_id,
        owner: fallback.data.match_id.startsWith("nearby-")
          ? "nearby-host"
          : "solo",
      };
    },
    setActiveMatch: async (activeMatch) => {
      if (activeMatch === null) {
        await database.run("DELETE FROM mobile_metadata WHERE key IN (?, ?)", [
          "active_match_id",
          "active_match_owner",
        ]);
        return;
      }
      await database.run(
        `INSERT INTO mobile_metadata (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        ["active_match_id", activeMatch.matchId]
      );
      await database.run(
        `INSERT INTO mobile_metadata (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        ["active_match_owner", activeMatch.owner]
      );
    },
    close: async () => {
      const active = await sqlite.isConnection(DATABASE_NAME, false);
      if (active.result) {
        await sqlite.closeConnection(DATABASE_NAME, false);
      }
    },
  };
}
