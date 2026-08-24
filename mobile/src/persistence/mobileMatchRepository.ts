import { Capacitor } from "@capacitor/core";
import { z } from "zod";
import {
  createMemoryMatchRepository,
  parseMatchRecoveryRecord,
  type MatchRecoveryRecord,
  type MatchRepository,
} from "~/game/server/src/repository";
import {
  parseMatchCheckpoint,
  type MatchCheckpoint,
} from "~/game/server/src/checkpoint";
import { REPLAY_LOG_SCHEMA_VERSION } from "~/game/replay/types";

const DATABASE_NAME = "kandora_mobile";
const DATABASE_VERSION = 1;

const RecoveryRowSchema = z.object({
  checkpoint_json: z.string().nullable(),
  pending_command_json: z.string().nullable(),
  terminal_at: z.number().nullable(),
});

export interface MobileMatchRepositoryHandle {
  repository: MatchRepository;
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
  query(
    statement: string,
    values?: unknown[]
  ): Promise<{ values?: unknown[] }>;
  run(
    statement: string,
    values?: unknown[]
  ): Promise<{ changes?: { changes?: number } }>;
}

function serialize(value: unknown): string {
  return JSON.stringify(value);
}

function affectedRows(result: {
  changes?: { changes?: number };
}): number {
  return result.changes?.changes ?? 0;
}

class SqliteMatchRepository implements MatchRepository {
  constructor(private readonly database: MobileSqliteDatabase) {}

  async createMatch(args: Parameters<MatchRepository["createMatch"]>[0]) {
    await this.database.run(
      `INSERT INTO mobile_matches (
         match_id, seed, players_json, session_id, game_index,
         status, started_at, events_json, final_scores_json
       ) VALUES (?, ?, ?, ?, ?, 'playing', ?, '[]', NULL)
       ON CONFLICT(match_id) DO NOTHING`,
      [
        args.matchId,
        args.seed,
        serialize(args.players),
        args.sessionId ?? null,
        args.gameIndex ?? null,
        Date.now(),
      ]
    );
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
  }

  async archiveReplayLog(
    args: Parameters<MatchRepository["archiveReplayLog"]>[0]
  ) {
    const source = args.source ?? "ingame";
    const sourceGameId = args.sourceGameId ?? args.matchId;
    const payload = {
      source,
      sourceGameId,
      ruleSet: args.ruleSet,
      ...(args.ruleSetDetails
        ? { ruleSetDetails: args.ruleSetDetails }
        : {}),
      startedAt: args.startedAt.getTime(),
      endedAt: args.endedAt.getTime(),
      seats: args.seats,
      events: args.events,
      schemaVersion: REPLAY_LOG_SCHEMA_VERSION,
    };
    await this.database.run(
      `INSERT INTO mobile_replays (
         source, source_game_id, payload_json, updated_at
       ) VALUES (?, ?, ?, ?)
       ON CONFLICT(source, source_game_id) DO UPDATE SET
         payload_json = excluded.payload_json,
         updated_at = excluded.updated_at`,
      [source, sourceGameId, serialize(payload), Date.now()]
    );
  }

  async saveCheckpoint(args: {
    matchId: string;
    checkpoint: MatchCheckpoint;
  }) {
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
      throw new Error(`Cannot save checkpoint for terminal match ${args.matchId}`);
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
    await this.database.run(
      "DELETE FROM match_recovery WHERE match_id = ?",
      [matchId]
    );
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
     CREATE TABLE IF NOT EXISTS mobile_replays (
       source TEXT NOT NULL,
       source_game_id TEXT NOT NULL,
       payload_json TEXT NOT NULL,
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
): MatchRepository {
  return new SqliteMatchRepository(database);
}

export async function openMobileMatchRepository(): Promise<MobileMatchRepositoryHandle> {
  if (!Capacitor.isNativePlatform()) {
    let activeMatch: MobileActiveMatch | null = null;
    return {
      repository: createMemoryMatchRepository(),
      storage: "memory",
      getActiveMatch: async () => activeMatch,
      setActiveMatch: async (nextActiveMatch) => {
        activeMatch = nextActiveMatch;
      },
      close: async () => undefined,
    };
  }

  const { CapacitorSQLite, SQLiteConnection } = await import(
    "@capacitor-community/sqlite"
  );
  const sqlite = new SQLiteConnection(CapacitorSQLite);
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

  return {
    repository: createSqliteMatchRepository(database),
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
        await database.run(
          "DELETE FROM mobile_metadata WHERE key IN (?, ?)",
          ["active_match_id", "active_match_owner"]
        );
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