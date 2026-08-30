import { afterEach, describe, expect, it } from "vitest";
import {
  MatchProcess,
  setDelayAfterDiscardMs,
  setReadyCheckMs,
} from "~/game/server/src/match";
import {
  ephemeralMatchRepository,
  type MatchRecoveryRecord,
} from "~/game/server/src/repository";
import {
  createSqliteMatchRepository,
  type MobileSqliteDatabase,
} from "./mobileMatchRepository";

class RecordingDatabase implements MobileSqliteDatabase {
  changes = 1;
  rows: unknown[] = [];
  readonly runs: Array<{ statement: string; values: unknown[] }> = [];
  readonly transactions: Array<
    Array<{ statement: string; values?: unknown[] }>
  > = [];

  async execute() {
    return { changes: { changes: 0 } };
  }

  async query() {
    return { values: this.rows };
  }

  async run(statement: string, values: unknown[] = []) {
    this.runs.push({ statement, values });
    return { changes: { changes: this.changes } };
  }

  async executeTransaction(
    tasks: Array<{ statement: string; values?: unknown[] }>
  ) {
    this.transactions.push(tasks);
    return { changes: { changes: this.changes } };
  }
}

function players() {
  return [0, 1, 2, 3].map((seat) => ({
    userId: `human-${seat}`,
    displayName: `Human ${seat}`,
    isBot: false,
  }));
}

describe("mobile SQLite match repository", () => {
  afterEach(() => {
    setReadyCheckMs(5_000);
    setDelayAfterDiscardMs(350);
  });

  it("appends a contiguous event batch and advances its cursor transactionally", async () => {
    const database = new RecordingDatabase();
    database.rows = [{ status: "playing", next_seq: 4 }];
    const repository = createSqliteMatchRepository(database);

    await repository.appendMatchEvents({
      matchId: "mobile-journal",
      events: [4, 5].map((seq) => ({
        seq,
        emittedAt: 10_000 + seq,
        event: { type: "furiten", seat: 0, active: seq === 4 },
      })),
    });

    expect(database.transactions).toHaveLength(1);
    expect(database.transactions[0]).toHaveLength(3);
    expect(database.transactions[0][0].statement).toContain(
      "INSERT INTO mobile_match_events"
    );
    expect(database.transactions[0][2]).toMatchObject({
      statement: expect.stringContaining("UPDATE mobile_match_journals"),
      values: [6, "mobile-journal", 4],
    });
  });

  it("stores and reloads one atomic pending-command record", async () => {
    const database = new RecordingDatabase();
    const repository = createSqliteMatchRepository(database);
    const match = new MatchProcess("mobile-sqlite-command", 81, players(), {
      repository: ephemeralMatchRepository,
    });
    setReadyCheckMs(0);
    setDelayAfterDiscardMs(0);
    await match.start();
    const checkpoint = match.createCheckpoint();
    if (
      checkpoint.status !== "playing" ||
      checkpoint.checkpointKind !== "action_window"
    ) {
      throw new Error("expected an action checkpoint");
    }
    const action = checkpoint.actionWindow.legalActions.find(
      (candidate) => candidate.type === "discard"
    );
    if (action === undefined) {
      throw new Error("expected a discard action");
    }

    await repository.saveCommandTransaction({
      matchId: match.matchId,
      checkpoint,
      command: {
        type: "act",
        seat: checkpoint.actionWindow.seat,
        actionId: action.id,
      },
    });

    expect(database.runs).toHaveLength(1);
    expect(database.runs[0].statement).toContain(
      "pending_command_json = excluded.pending_command_json"
    );
    const pendingCommandJson = database.runs[0].values[2];
    expect(JSON.parse(String(pendingCommandJson))).toEqual({
      type: "act",
      seat: checkpoint.actionWindow.seat,
      actionId: action.id,
    });

    database.rows = [
      {
        checkpoint_json: String(database.runs[0].values[1]),
        pending_command_json: String(pendingCommandJson),
        terminal_at: null,
      },
    ];
    const expected = {
      checkpoint,
      pendingCommand: {
        type: "act" as const,
        seat: checkpoint.actionWindow.seat,
        actionId: action.id,
      },
    } satisfies MatchRecoveryRecord;
    await expect(repository.loadRecoveryRecord(match.matchId)).resolves.toEqual(
      expected
    );
  });

  it("rejects a checkpoint write when the terminal row wins", async () => {
    const database = new RecordingDatabase();
    database.changes = 0;
    const repository = createSqliteMatchRepository(database);
    const room = MatchProcess.createWaitingRoom("mobile-sqlite-terminal", 82, {
      repository: ephemeralMatchRepository,
    });
    const checkpoint = room.createCheckpoint();

    await expect(
      repository.saveCheckpoint({ matchId: room.matchId, checkpoint })
    ).rejects.toThrow(/terminal match/);
  });

  it("marks only an existing recovery row terminal", async () => {
    const database = new RecordingDatabase();
    const repository = createSqliteMatchRepository(database);

    await repository.markCheckpointTerminal({
      matchId: "mobile-sqlite-tombstone",
      finishedAt: 123_456,
    });

    expect(database.runs).toHaveLength(1);
    expect(database.runs[0].statement.trim()).toMatch(/^UPDATE match_recovery/);
    expect(database.runs[0].statement).not.toContain("INSERT");
    expect(database.runs[0].values).toEqual([
      123_456,
      expect.any(Number),
      "mobile-sqlite-tombstone",
    ]);
  });
});
