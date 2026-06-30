# Replay adapter fixtures

Phase 4.5 step 11 calls for a **test oracle**: 2–3 real fixture logs
per platform (one tsumo, one ron, one abortive draw) that each
adapter parses, then we replay the resulting `ReplayLog` events
through the engine and assert the final scores + win events match
what the source platform reported.

The synthetic-fixture spec files
(`app/api/<platform>/replayAdapter.spec.ts`) already exercise the
adapter's correctness on hand-crafted inputs. The real-log oracle is
the byte-equality guard against drift when the underlying platform
protocol changes shape.

## Layout

Drop raw logs here, one subdirectory per source:

```
app/api/_fixtures/replay/
  majsoul/      *.gameRecord.bin    or *.json  (raw GameRecord)
  tenhou-xml/   *.mjlog.xml         (raw mjloggm XML)
  tenhou-json/  *.json              (Tenhou JSON log format)
  riichicity/   *.gameData.json     (raw GameData)
  metadata.json (per-fixture expected outcomes)
```

`metadata.json` schema (one entry per fixture):

```jsonc
{
  "majsoul/240419-abc.gameRecord.bin": {
    "kind": "tsumo", // "tsumo" | "ron" | "exhaustive" | "abort"
    "expectedFinalScores": [33000, 25000, 24000, 18000],
    "expectedWinSeats": [0], // seat indices in win-event order
    "expectedHandCount": 8,
  },
  // …
}
```

## Oracle test harness

Skip the test suite at the file level when the fixtures directory
is empty (the real logs aren't checked in — they ship per-developer
or live in a separate private artifact). The harness lives in
[`app/api/_fixtures/replay/oracle.spec.ts`](./oracle.spec.ts) (to
be added once the first fixture lands).

The harness, when fixtures exist, does:

1. Load each file + its `metadata.json` entry.
2. Run the platform's `parseXxxReplay` to produce a `ReplayLog`.
3. Fold the events with `replayReducer(log, log.events.length - 1)`.
4. Assert `view.scores === metadata.expectedFinalScores`.
5. Assert each `win` event's `seat` matches `metadata.expectedWinSeats[i]`.
6. **Idempotency**: parse the raw log twice, assert
   `JSON.stringify(a) === JSON.stringify(b)`.

The first three platforms each ship a hand-rolled idempotency test
on synthetic fixtures already (`*.spec.ts` files in each adapter
directory) — that closes the nondeterminism risk without needing
real logs. The real-log harness is purely the platform-byte-
equality guard.

## Getting real logs

- **Majsoul**: any tournament admin can pull a `GameRecord` for an
  in-tournament game via the existing `MajsoulLeagueConnector.
getContestGameRecord` helper. Save the raw response (pre-parse)
  with `JSON.stringify(record, null, 2)` to disk.
- **Tenhou**: `TenhouService.fetchGameLog(gameId)` returns the raw
  XML. For tournament rooms only XML is available; for individual
  ranked games Tenhou also publishes a JSON download from the log
  viewer (look in the network tab when opening a paifu).
- **Riichi City**: `RiichiCityConnector.getContestGameRecord(id)`
  returns the raw `GameData` shape.

Strip player names / personal data before checking fixtures in if
the league config is private.

## When fixtures change shape

If a platform changes its log format and an adapter is updated:

1. Re-record fresh fixtures for that platform.
2. Bump `REPLAY_LOG_SCHEMA_VERSION` in
   [`app/game/replay/types.ts`](../../game/replay/types.ts) so the
   hydration pipeline re-parses existing rows.
3. Update the fidelity matrix in
   [`app/game/replay/README.md`](../../game/replay/README.md) with
   any new caveats.
