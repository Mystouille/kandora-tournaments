import { afterEach, describe, expect, it, vi } from "vitest";
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
  createMemoryMobileMatchRepository,
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

function replayArchive(sourceGameId: string, startedAt: number) {
  return {
    matchId: sourceGameId,
    startedAt: new Date(startedAt),
    endedAt: new Date(startedAt + 1_000),
    ruleSet: "m-league",
    events: [],
    seats: [0, 1, 2, 3].map((seat) => ({
      seat: seat as 0 | 1 | 2 | 3,
      userDbId: `user-${seat}`,
      displayName: `Player ${seat}`,
      finalScore: 40_000 - seat * 10_000,
      place: (seat + 1) as 1 | 2 | 3 | 4,
    })),
  };
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

  it("archives an ID-free replay summary beside the full payload", async () => {
    const database = new RecordingDatabase();
    const repository = createSqliteMatchRepository(database);

    await repository.archiveReplayLog(
      replayArchive("mobile-replay-summary", 1_700_000_000_000)
    );

    expect(database.runs).toHaveLength(1);
    expect(database.runs[0].statement).toContain("summary_json");
    expect(JSON.parse(String(database.runs[0].values[3]))).toEqual({
      source: "ingame",
      sourceGameId: "mobile-replay-summary",
      ruleSet: "m-league",
      startedAt: 1_700_000_000_000,
      endedAt: 1_700_000_001_000,
      seats: [
        { seat: 0, displayName: "Player 0", finalScore: 40_000, place: 1 },
        { seat: 1, displayName: "Player 1", finalScore: 30_000, place: 2 },
        { seat: 2, displayName: "Player 2", finalScore: 20_000, place: 3 },
        { seat: 3, displayName: "Player 3", finalScore: 10_000, place: 4 },
      ],
    });
    expect(String(database.runs[0].values[3])).not.toContain("userDbId");
  });

  it("loads, sorts, and backfills legacy replay summaries", async () => {
    const database = new RecordingDatabase();
    const older = replayArchive("older", 1_700_000_000_000);
    const newer = replayArchive("newer", 1_800_000_000_000);
    database.rows = [newer, older].map((archive) => ({
      source: "ingame",
      source_game_id: archive.matchId,
      payload_json: JSON.stringify({
        source: "ingame",
        sourceGameId: archive.matchId,
        ruleSet: archive.ruleSet,
        startedAt: archive.startedAt.getTime(),
        endedAt: archive.endedAt.getTime(),
        seats: archive.seats,
        events: [{ type: "match_start" }],
      }),
      summary_json: null,
    }));
    const repository = createSqliteMatchRepository(database);

    const summaries = await repository.listReplaySummaries();

    expect(summaries.map((summary) => summary.sourceGameId)).toEqual([
      "newer",
      "older",
    ]);
    expect(summaries[0].seats[0]).not.toHaveProperty("userDbId");
    expect(database.transactions).toHaveLength(1);
    expect(database.transactions[0]).toHaveLength(2);
    expect(database.transactions[0][0].statement).toContain(
      "SET summary_json = ?"
    );
  });

  it("loads the full replay payload by source and game id", async () => {
    const database = new RecordingDatabase();
    const archive = replayArchive("local-replay", 1_700_000_000_000);
    database.rows = [
      {
        payload_json: JSON.stringify({
          source: "ingame",
          sourceGameId: archive.matchId,
          ruleSet: archive.ruleSet,
          startedAt: archive.startedAt.getTime(),
          endedAt: archive.endedAt.getTime(),
          seats: archive.seats,
          events: archive.events,
          schemaVersion: 6,
        }),
      },
    ];
    const repository = createSqliteMatchRepository(database);

    await expect(
      repository.getReplayLog("ingame", "local-replay")
    ).resolves.toMatchObject({
      source: "ingame",
      sourceGameId: "local-replay",
      events: [],
    });
  });

  it("isolates malformed replay rows", async () => {
    const database = new RecordingDatabase();
    database.rows = [
      {
        source: "ingame",
        source_game_id: "broken",
        payload_json: "not-json",
        summary_json: null,
      },
    ];
    const repository = createSqliteMatchRepository(database);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await expect(repository.listReplaySummaries()).resolves.toEqual([]);
    expect(consoleError).toHaveBeenCalledWith(
      "Skipping invalid mobile replay ingame/broken"
    );
    consoleError.mockRestore();
  });

  it("lists replay archives created by the browser-memory repository", async () => {
    const { repository, replayStore } = createMemoryMobileMatchRepository();
    await repository.archiveReplayLog(
      replayArchive("older", 1_700_000_000_000)
    );
    await repository.archiveReplayLog(
      replayArchive("newer", 1_800_000_000_000)
    );

    await expect(replayStore.listReplaySummaries()).resolves.toEqual([
      expect.objectContaining({ sourceGameId: "newer" }),
      expect.objectContaining({ sourceGameId: "older" }),
    ]);
    await expect(
      replayStore.getReplayLog("ingame", "newer")
    ).resolves.toMatchObject({ sourceGameId: "newer", events: [] });
  });
});
