import { createHash } from "node:crypto";
import mongoose from "mongoose";
import { ReplayLogModel } from "~/core/models/game/ReplayLog";
import { ReplayReviewModel } from "~/core/models/game/ReplayReview";
import { MatchModel } from "~/core/models/game/Match";
import { GameModel } from "~/core/models/tournament/Game";
import { LeagueModel } from "~/core/models/tournament/League";
import { UserModel } from "~/core/models/shared/User";
import { listPresets } from "~/game/rules/presets";
import { normalizeReplayId } from "~/game/replay/normalizeReplayId";
import { normalizeEpochMilliseconds } from "~/game/replay/timestamp";
import type { ReplaySource } from "~/game/replay/types";
import type {
  MyReplayContext,
  MyReplayGroup,
  MyReplayReason,
  MyReplayRuleset,
  MyReplayReview,
} from "~/types/myReplays";
import { slugify } from "~/utils/slugify";

interface UserIdentityDocument {
  majsoulIdentity?: { name?: string };
  tenhouIdentity?: { name?: string };
  riichiCityIdentity?: { name?: string };
}

interface ReplayLogListDocument {
  _id: mongoose.Types.ObjectId;
  source: ReplaySource;
  sourceGameId: string;
  ruleSet: string;
  startedAt: number;
  endedAt: number;
  creationTriggeredBy?: mongoose.Types.ObjectId;
  seats?: Array<{
    userDbId?: mongoose.Types.ObjectId;
    displayName: string;
    finalScore?: number;
    place?: number;
  }>;
}

interface ReplayEventsDocument {
  _id: mongoose.Types.ObjectId;
  events?: unknown[];
}

interface ReviewListDocument {
  shortId: string;
  source: ReplaySource;
  sourceGameId: string;
  target?: {
    user?: mongoose.Types.ObjectId;
    name: string;
  };
  commentedByUser: boolean;
  updatedAt?: Date;
  createdAt?: Date;
  commentCount: number;
}

interface MatchListDocument {
  _id: string;
  ruleSet: string;
  startedAt?: Date;
  endedAt?: Date;
}

interface TournamentGameListDocument {
  gameId?: string;
  platform: "majsoul" | "tenhou" | "riichiCity" | "IRL";
  rules: "EMA" | "WRC" | "ONLINE" | "MLEAGUE" | "INDONESIAN";
  league?: mongoose.Types.ObjectId | null;
  replayLogRef?: mongoose.Types.ObjectId | null;
  startTime: Date;
}

interface LeagueListDocument {
  _id: mongoose.Types.ObjectId;
  name: string;
  isDisplayed: boolean;
}

interface ReplaySeed {
  source: ReplaySource;
  sourceGameId: string;
  reasons: Set<MyReplayReason>;
}

const PARENT_REASON_ORDER: MyReplayReason[] = ["created", "played"];
const REVIEW_REASON_ORDER: MyReplayReason[] = ["commented", "reviewed"];

const SOURCE_LABELS: Record<ReplaySource, string> = {
  ingame: "Kandora",
  majsoul: "Mahjong Soul",
  tenhou: "Tenhou",
  riichicity: "Riichi City",
};

const TOURNAMENT_RULESETS: Record<string, MyReplayRuleset> = {
  EMA: { id: "ema", label: "EMA" },
  WRC: { id: "wrc", label: "WRC" },
  ONLINE: { id: "online", label: "Online" },
  MLEAGUE: { id: "m-league", label: "M-League" },
  INDONESIAN: { id: "indonesian", label: "Indonesian" },
};

const PRESET_RULESETS = new Map(
  listPresets().map((preset) => [
    preset.id,
    { id: preset.id, label: preset.displayName },
  ])
);

function canonicalReplayId(source: ReplaySource, sourceGameId: string): string {
  return source === "ingame" ? sourceGameId : normalizeReplayId(sourceGameId);
}

function replayKey(source: ReplaySource, sourceGameId: string): string {
  return JSON.stringify([source, canonicalReplayId(source, sourceGameId)]);
}

function asTimestamp(value: Date | number | undefined): number | null {
  if (value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
  }
  // ReplayLog numbers may include legacy Riichi City seconds or accidentally
  // over-multiplied microseconds; normalize them before filtering and sorting.
  return normalizeEpochMilliseconds(value) || null;
}

function sourceForGamePlatform(
  platform: TournamentGameListDocument["platform"]
): ReplaySource | null {
  switch (platform) {
    case "majsoul":
      return "majsoul";
    case "tenhou":
      return "tenhou";
    case "riichiCity":
      return "riichicity";
    default:
      return null;
  }
}

function replayUrl(sourceGameId: string): string {
  return `/watch/replay/${encodeURIComponent(sourceGameId)}`;
}

function chooseFallbackGame(
  current: TournamentGameListDocument | undefined,
  candidate: TournamentGameListDocument
): TournamentGameListDocument {
  if (!current || (!current.league && candidate.league)) {
    return candidate;
  }
  return current;
}

function resolveContext(
  source: ReplaySource,
  game: TournamentGameListDocument | undefined,
  league: LeagueListDocument | undefined
): MyReplayContext {
  if (game?.league) {
    return {
      kind: "tournament",
      ...(league?.name ? { tournamentName: league.name } : {}),
      ...(league?.name && league.isDisplayed
        ? {
            tournamentUrl: `/online-tournaments/${encodeURIComponent(
              slugify(league.name)
            )}/presentation`,
          }
        : {}),
    };
  }
  return { kind: source === "ingame" ? "friendly" : "external" };
}

function resolveRuleset(
  source: ReplaySource,
  replay: ReplayLogListDocument | undefined,
  match: MatchListDocument | undefined,
  game: TournamentGameListDocument | undefined
): MyReplayRuleset {
  if (game?.league) {
    return (
      TOURNAMENT_RULESETS[game.rules] ?? {
        id: game.rules.toLowerCase(),
        label: game.rules,
      }
    );
  }
  if (source === "ingame") {
    const storedRuleset = replay?.ruleSet || match?.ruleSet;
    if (storedRuleset) {
      return (
        PRESET_RULESETS.get(storedRuleset) ?? {
          id: storedRuleset,
          label: storedRuleset,
        }
      );
    }
  }
  return {
    id: `platform:${source}`,
    label: SOURCE_LABELS[source],
  };
}

function addSeed(
  seeds: Map<string, ReplaySeed>,
  source: ReplaySource,
  sourceGameId: string,
  reason: MyReplayReason
): void {
  const canonicalSourceGameId = canonicalReplayId(source, sourceGameId);
  const key = replayKey(source, canonicalSourceGameId);
  const existing = seeds.get(key);
  if (existing) {
    existing.reasons.add(reason);
    return;
  }
  seeds.set(key, {
    source,
    sourceGameId: canonicalSourceGameId,
    reasons: new Set([reason]),
  });
}

function replayOutcomeFingerprint(
  replay: ReplayLogListDocument | undefined
): string | null {
  if (!replay) {
    return null;
  }

  const outcomes: Array<[string, number, number]> = [];
  for (const seat of replay.seats ?? []) {
    const displayName = seat.displayName.trim();
    if (
      !displayName ||
      typeof seat.finalScore !== "number" ||
      !Number.isFinite(seat.finalScore) ||
      typeof seat.place !== "number" ||
      !Number.isFinite(seat.place)
    ) {
      return null;
    }
    outcomes.push([displayName, seat.finalScore, seat.place]);
  }
  if (outcomes.length < 3) {
    return null;
  }
  outcomes.sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right))
  );
  return JSON.stringify([replay.source, outcomes]);
}

function canonicalGameplayValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalGameplayValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => key !== "liveWall" && key !== "deadWall")
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalGameplayValue(child)])
    );
  }
  return value;
}

function replayGameplayFingerprint(
  events: unknown[] | undefined
): string | null {
  if (!events || events.length === 0) {
    return null;
  }
  return createHash("sha256")
    .update(JSON.stringify(canonicalGameplayValue(events)))
    .digest("hex");
}

async function deduplicateTournamentReplayGroups(
  groups: MyReplayGroup[],
  replayByKey: Map<string, ReplayLogListDocument>
): Promise<MyReplayGroup[]> {
  const groupsByOutcome = new Map<string, MyReplayGroup[]>();
  for (const group of groups) {
    const fingerprint = replayOutcomeFingerprint(replayByKey.get(group.key));
    if (!fingerprint) {
      continue;
    }
    const matchingGroups = groupsByOutcome.get(fingerprint) ?? [];
    matchingGroups.push(group);
    groupsByOutcome.set(fingerprint, matchingGroups);
  }

  const candidateGroups = [...groupsByOutcome.values()].filter(
    (matchingGroups) =>
      matchingGroups.some((group) => group.context.kind === "tournament") &&
      matchingGroups.some((group) => group.context.kind === "external")
  );
  const candidateReplayIds = [
    ...new Set(
      candidateGroups.flatMap((matchingGroups) =>
        matchingGroups.flatMap((group) => {
          const replay = replayByKey.get(group.key);
          return replay ? [String(replay._id)] : [];
        })
      )
    ),
  ].map((id) => new mongoose.Types.ObjectId(id));
  if (candidateReplayIds.length === 0) {
    return groups;
  }

  const replayEvents = await ReplayLogModel.find(
    { _id: { $in: candidateReplayIds } },
    { events: 1 }
  )
    .lean<ReplayEventsDocument[]>()
    .exec();
  const gameplayFingerprintByReplayId = new Map(
    replayEvents.flatMap((replay) => {
      const fingerprint = replayGameplayFingerprint(replay.events);
      return fingerprint ? [[String(replay._id), fingerprint] as const] : [];
    })
  );
  const groupsByFingerprint = new Map<string, MyReplayGroup[]>();
  for (const matchingGroups of candidateGroups) {
    for (const group of matchingGroups) {
      const replay = replayByKey.get(group.key);
      const gameplayFingerprint = replay
        ? gameplayFingerprintByReplayId.get(String(replay._id))
        : undefined;
      const outcomeFingerprint = replayOutcomeFingerprint(replay);
      if (!gameplayFingerprint || !outcomeFingerprint) {
        continue;
      }
      const fingerprint = JSON.stringify([
        outcomeFingerprint,
        gameplayFingerprint,
      ]);
      const groupsWithMatchingGameplay =
        groupsByFingerprint.get(fingerprint) ?? [];
      groupsWithMatchingGameplay.push(group);
      groupsByFingerprint.set(fingerprint, groupsWithMatchingGameplay);
    }
  }

  const mergedTournamentGroups = new Map<string, MyReplayGroup>();
  const duplicateExternalKeys = new Set<string>();
  for (const matchingGroups of groupsByFingerprint.values()) {
    const tournamentGroups = matchingGroups.filter(
      (group) => group.context.kind === "tournament"
    );
    const externalGroups = matchingGroups.filter(
      (group) => group.context.kind === "external"
    );
    if (tournamentGroups.length !== 1 || externalGroups.length === 0) {
      continue;
    }

    const tournamentGroup = tournamentGroups[0];
    const mergedReasons = new Set(tournamentGroup.reasons);
    const reviewsByKey = new Map(
      tournamentGroup.reviews.map((review) => [review.key, review])
    );
    for (const externalGroup of externalGroups) {
      duplicateExternalKeys.add(externalGroup.key);
      for (const reason of externalGroup.reasons) {
        mergedReasons.add(reason);
      }
      for (const review of externalGroup.reviews) {
        reviewsByKey.set(review.key, review);
      }
    }
    const reviews = [...reviewsByKey.values()].sort(
      (left, right) =>
        (right.lastModified ?? Number.NEGATIVE_INFINITY) -
          (left.lastModified ?? Number.NEGATIVE_INFINITY) ||
        left.shortId.localeCompare(right.shortId)
    );
    mergedTournamentGroups.set(tournamentGroup.key, {
      ...tournamentGroup,
      reasons: PARENT_REASON_ORDER.filter((reason) =>
        mergedReasons.has(reason)
      ),
      commentCount: reviews.reduce(
        (total, review) => total + review.commentCount,
        0
      ),
      reviews,
    });
  }

  return groups.flatMap((group) => {
    if (duplicateExternalKeys.has(group.key)) {
      return [];
    }
    return [mergedTournamentGroups.get(group.key) ?? group];
  });
}

export async function getMyReplays(
  userId: string
): Promise<MyReplayGroup[] | null> {
  if (!mongoose.isValidObjectId(userId)) {
    return null;
  }
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const user = await UserModel.findOne({
    _id: userObjectId,
    isDeleted: { $ne: true },
  })
    .select("majsoulIdentity.name tenhouIdentity.name riichiCityIdentity.name")
    .lean<UserIdentityDocument | null>()
    .exec();
  if (!user) {
    return null;
  }

  const replayRelations: Array<Record<string, unknown>> = [
    { creationTriggeredBy: userObjectId },
    { source: "ingame", "seats.userDbId": userObjectId },
  ];
  const externalNames: Array<[ReplaySource, string | undefined]> = [
    ["majsoul", user.majsoulIdentity?.name?.trim()],
    ["tenhou", user.tenhouIdentity?.name?.trim()],
    ["riichicity", user.riichiCityIdentity?.name?.trim()],
  ];
  const externalNameBySource = new Map<ReplaySource, string>();
  for (const [source, displayName] of externalNames) {
    if (displayName) {
      externalNameBySource.set(source, displayName);
      replayRelations.push({ source, "seats.displayName": displayName });
    }
  }

  const [directReplays, matches] = await Promise.all([
    ReplayLogModel.find(
      { $or: replayRelations },
      {
        source: 1,
        sourceGameId: 1,
        ruleSet: 1,
        startedAt: 1,
        endedAt: 1,
        creationTriggeredBy: 1,
        "seats.userDbId": 1,
        "seats.displayName": 1,
        "seats.finalScore": 1,
        "seats.place": 1,
      }
    )
      .lean<ReplayLogListDocument[]>()
      .exec(),
    MatchModel.find(
      { status: "finished", "players.userId": userId },
      { ruleSet: 1, startedAt: 1, endedAt: 1 }
    )
      .lean<MatchListDocument[]>()
      .exec(),
  ]);

  const reviews = await ReplayReviewModel.aggregate<ReviewListDocument>([
    {
      $match: {
        $or: [
          { "reviewers.user": userObjectId },
          { "edits.author": userObjectId },
          { "target.user": userObjectId },
          {
            createdBy: userObjectId,
            edits: {
              $elemMatch: {
                $or: [{ author: { $exists: false } }, { author: null }],
              },
            },
          },
        ],
      },
    },
    {
      $project: {
        _id: 0,
        shortId: 1,
        source: 1,
        sourceGameId: 1,
        target: 1,
        commentedByUser: {
          $or: [
            {
              $in: [userObjectId, { $ifNull: ["$reviewers.user", []] }],
            },
            {
              $in: [userObjectId, { $ifNull: ["$edits.author", []] }],
            },
            {
              $and: [
                { $eq: ["$createdBy", userObjectId] },
                {
                  $gt: [
                    {
                      $size: {
                        $filter: {
                          input: { $ifNull: ["$edits", []] },
                          as: "edit",
                          cond: {
                            $eq: [{ $ifNull: ["$$edit.author", null] }, null],
                          },
                        },
                      },
                    },
                    0,
                  ],
                },
              ],
            },
          ],
        },
        updatedAt: 1,
        createdAt: 1,
        commentCount: { $size: { $ifNull: ["$edits", []] } },
      },
    },
  ]).exec();

  const replayByKey = new Map(
    directReplays.map((replay) => [
      replayKey(replay.source, replay.sourceGameId),
      replay,
    ])
  );
  const matchByKey = new Map<string, MatchListDocument>();
  const seeds = new Map<string, ReplaySeed>();
  for (const replay of directReplays) {
    if (
      replay.source !== "ingame" &&
      String(replay.creationTriggeredBy ?? "") === userId
    ) {
      addSeed(seeds, replay.source, replay.sourceGameId, "created");
    }
    const played =
      replay.source === "ingame"
        ? replay.seats?.some((seat) => String(seat.userDbId ?? "") === userId)
        : replay.seats?.some(
            (seat) =>
              seat.displayName === externalNameBySource.get(replay.source)
          );
    if (played) {
      addSeed(seeds, replay.source, replay.sourceGameId, "played");
    }
  }
  for (const match of matches) {
    const key = replayKey("ingame", match._id);
    matchByKey.set(key, match);
    addSeed(seeds, "ingame", match._id, "played");
  }
  const reasonsByReviewId = new Map<string, MyReplayReason[]>();
  for (const review of reviews) {
    const reasonSet = new Set<MyReplayReason>();
    if (review.commentedByUser) {
      reasonSet.add("commented");
    }
    if (String(review.target?.user ?? "") === userId) {
      reasonSet.add("reviewed");
    }
    const reasons = REVIEW_REASON_ORDER.filter((reason) =>
      reasonSet.has(reason)
    );
    if (reasons.length === 0) {
      continue;
    }
    reasonsByReviewId.set(review.shortId, reasons);
    for (const reason of reasons) {
      addSeed(seeds, review.source, review.sourceGameId, reason);
    }
  }

  const missingReplayFilters = [...seeds.values()]
    .filter(
      ({ source, sourceGameId }) =>
        !replayByKey.has(replayKey(source, sourceGameId))
    )
    .map(({ source, sourceGameId }) => ({ source, sourceGameId }));
  if (missingReplayFilters.length > 0) {
    const supplementalReplays = await ReplayLogModel.find(
      { $or: missingReplayFilters },
      {
        source: 1,
        sourceGameId: 1,
        ruleSet: 1,
        startedAt: 1,
        endedAt: 1,
        "seats.displayName": 1,
        "seats.finalScore": 1,
        "seats.place": 1,
      }
    )
      .lean<ReplayLogListDocument[]>()
      .exec();
    for (const replay of supplementalReplays) {
      replayByKey.set(replayKey(replay.source, replay.sourceGameId), replay);
    }
  }

  const replayIds = [...replayByKey.values()].map((replay) => replay._id);
  const idsBySource = new Map<ReplaySource, string[]>();
  for (const seed of seeds.values()) {
    const ids = idsBySource.get(seed.source) ?? [];
    ids.push(seed.sourceGameId);
    idsBySource.set(seed.source, ids);
  }
  const gameFilters: Array<Record<string, unknown>> = [];
  if (replayIds.length > 0) {
    gameFilters.push({ replayLogRef: { $in: replayIds } });
  }
  const gamePlatformBySource: Partial<
    Record<ReplaySource, TournamentGameListDocument["platform"]>
  > = {
    majsoul: "majsoul",
    tenhou: "tenhou",
    riichicity: "riichiCity",
  };
  for (const [source, ids] of idsBySource) {
    const platform = gamePlatformBySource[source];
    if (platform && ids.length > 0) {
      gameFilters.push({ platform, gameId: { $in: ids } });
    }
  }

  const games =
    gameFilters.length === 0
      ? []
      : await GameModel.find(
          { $or: gameFilters },
          {
            gameId: 1,
            platform: 1,
            rules: 1,
            league: 1,
            replayLogRef: 1,
            startTime: 1,
          }
        )
          .lean<TournamentGameListDocument[]>()
          .exec();
  const gameByReplayId = new Map<string, TournamentGameListDocument>();
  const gameByKey = new Map<string, TournamentGameListDocument>();
  for (const game of games) {
    if (game.replayLogRef) {
      const replayId = String(game.replayLogRef);
      gameByReplayId.set(
        replayId,
        chooseFallbackGame(gameByReplayId.get(replayId), game)
      );
    }
    const source = sourceForGamePlatform(game.platform);
    if (source && game.gameId) {
      const key = replayKey(source, game.gameId);
      gameByKey.set(key, chooseFallbackGame(gameByKey.get(key), game));
    }
  }

  const leagueIds = [
    ...new Set(
      games.flatMap((game) => (game.league ? [String(game.league)] : []))
    ),
  ];
  const leagues =
    leagueIds.length === 0
      ? []
      : await LeagueModel.find(
          { _id: { $in: leagueIds } },
          { name: 1, isDisplayed: 1 }
        )
          .lean<LeagueListDocument[]>()
          .exec();
  const leagueById = new Map(
    leagues.map((league) => [String(league._id), league])
  );

  const reviewsByKey = new Map<string, MyReplayReview[]>();
  for (const review of reviews) {
    const reasons = reasonsByReviewId.get(review.shortId);
    if (!reasons) {
      continue;
    }
    const key = replayKey(review.source, review.sourceGameId);
    const gameReplayUrl = replayUrl(review.sourceGameId);
    const reviewedPlayerName = review.target?.name.trim() || null;
    const rows = reviewsByKey.get(key) ?? [];
    rows.push({
      key: `review:${review.shortId}`,
      shortId: review.shortId,
      reviewedPlayerName,
      reasons,
      lastModified: asTimestamp(review.updatedAt ?? review.createdAt),
      commentCount: review.commentCount,
      reviewUrl: `${gameReplayUrl}?${new URLSearchParams({
        review: review.shortId,
      }).toString()}`,
    });
    reviewsByKey.set(key, rows);
  }

  const groups: MyReplayGroup[] = [];
  for (const [key, seed] of seeds) {
    const replay = replayByKey.get(key);
    const match = matchByKey.get(key);
    const game = replay
      ? (gameByReplayId.get(String(replay._id)) ?? gameByKey.get(key))
      : gameByKey.get(key);
    const league = game?.league
      ? leagueById.get(String(game.league))
      : undefined;
    const relatedReviews = (reviewsByKey.get(key) ?? []).sort(
      (left, right) =>
        (right.lastModified ?? Number.NEGATIVE_INFINITY) -
          (left.lastModified ?? Number.NEGATIVE_INFINITY) ||
        left.shortId.localeCompare(right.shortId)
    );
    const gameDate =
      asTimestamp(replay?.startedAt) ??
      asTimestamp(game?.startTime) ??
      asTimestamp(match?.startedAt);
    groups.push({
      key,
      source: seed.source,
      sourceGameId: seed.sourceGameId,
      reasons: PARENT_REASON_ORDER.filter((reason) => seed.reasons.has(reason)),
      gameDate,
      context: resolveContext(seed.source, game, league),
      ruleset: resolveRuleset(seed.source, replay, match, game),
      replayUrl: replayUrl(seed.sourceGameId),
      commentCount: relatedReviews.reduce(
        (total, review) => total + review.commentCount,
        0
      ),
      reviews: relatedReviews,
    });
  }

  const deduplicatedGroups = await deduplicateTournamentReplayGroups(
    groups,
    replayByKey
  );
  return deduplicatedGroups.sort(
    (left, right) =>
      (right.gameDate ?? Number.NEGATIVE_INFINITY) -
        (left.gameDate ?? Number.NEGATIVE_INFINITY) ||
      left.key.localeCompare(right.key)
  );
}
