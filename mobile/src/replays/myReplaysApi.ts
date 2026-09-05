import { z } from "zod";
import type { MobileAuthSession } from "../auth/mobileAuth";
import { webAppPath } from "../shell";
import { MobileReplayLogSchema } from "./replayLog";

const ReplaySourceSchema = z.enum([
  "ingame",
  "majsoul",
  "tenhou",
  "riichicity",
]);

const ReplayReasonSchema = z.enum([
  "created",
  "played",
  "commented",
  "reviewed",
]);

const ReplaySeatSchema = z.object({
  seat: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  displayName: z.string(),
  finalScore: z.number().finite(),
  place: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
});

const ReplayContextSchema = z.object({
  kind: z.enum(["friendly", "tournament", "external"]),
  tournamentName: z.string().optional(),
  tournamentUrl: z.string().optional(),
});

const ReplayReviewSchema = z.object({
  key: z.string().min(1),
  shortId: z.string().min(1),
  reviewedPlayerName: z.string().nullable(),
  reasons: z.array(ReplayReasonSchema),
  lastModified: z.number().finite().nullable(),
  commentCount: z.number().int().nonnegative(),
  reviewUrl: z.string().startsWith("/"),
});

const MyReplayApiGroupSchema = z.object({
  key: z.string().min(1),
  source: ReplaySourceSchema,
  sourceGameId: z.string().min(1),
  reasons: z.array(ReplayReasonSchema),
  gameDate: z.number().finite().nullable(),
  seats: z.array(ReplaySeatSchema).max(4),
  context: ReplayContextSchema,
  ruleset: z.object({ id: z.string().min(1), label: z.string().min(1) }),
  replayUrl: z.string().startsWith("/"),
  commentCount: z.number().int().nonnegative(),
  reviews: z.array(ReplayReviewSchema),
});

const MyReplaysApiResponseSchema = z.object({
  replays: z.array(MyReplayApiGroupSchema),
});

const MyReplayReviewDetailsSchema = z.object({
  shortId: z.string().min(1),
  seat: z.number().int().min(0).max(3).nullable(),
  targetName: z.string().nullable(),
  edits: z.array(
    z.object({
      eventIndex: z.number().int().nonnegative(),
      authorName: z.string(),
      colorIndex: z.number().int().nonnegative(),
      text: z.string(),
      drawingBase64: z.string().nullable(),
      updatedAt: z.string(),
    })
  ),
});

const MyReplayLogApiResponseSchema = z.object({
  log: MobileReplayLogSchema,
  seatEnrichment: z
    .array(
      z
        .object({
          teamName: z.string().nullable(),
          teamLogoUrl: z.string().nullable(),
        })
        .nullable()
    )
    .length(4),
  review: MyReplayReviewDetailsSchema.nullable()
    .optional()
    .transform((review) => review ?? null),
});

export type MyReplayApiGroup = z.infer<typeof MyReplayApiGroupSchema>;
export type MyReplayLogDetails = z.infer<typeof MyReplayLogApiResponseSchema>;

export class MyReplaysHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null
  ) {
    super(message);
    this.name = "MyReplaysHttpError";
  }
}

async function myReplaysHttpError(
  response: Response,
  message: string
): Promise<MyReplaysHttpError> {
  let code: string | null = null;
  if (response.headers.get("content-type")?.includes("application/json")) {
    try {
      const body = (await response.json()) as { error?: unknown };
      code = typeof body.error === "string" ? body.error : null;
    } catch {}
  }
  return new MyReplaysHttpError(message, response.status, code);
}

export async function fetchMyReplays(
  baseUrl: string,
  session: MobileAuthSession,
  fetcher: typeof fetch = fetch
): Promise<MyReplayApiGroup[]> {
  const response = await fetcher(webAppPath(baseUrl, "/api/my-replays"), {
    method: "POST",
    body: new URLSearchParams({ token: session.token }),
  });
  if (!response.ok) {
    throw await myReplaysHttpError(
      response,
      `My Replays request failed (${response.status})`
    );
  }
  return MyReplaysApiResponseSchema.parse(await response.json()).replays;
}

export async function fetchMyReplayLog(
  baseUrl: string,
  session: MobileAuthSession,
  source: MyReplayApiGroup["source"],
  sourceGameId: string,
  reviewShortId: string | null = null,
  fetcher: typeof fetch = fetch
) {
  const body = new URLSearchParams({
    token: session.token,
    source,
    sourceGameId,
  });
  if (reviewShortId !== null) {
    body.set("reviewShortId", reviewShortId);
  }
  const response = await fetcher(webAppPath(baseUrl, "/api/my-replays/log"), {
    method: "POST",
    body,
  });
  if (!response.ok) {
    throw await myReplaysHttpError(
      response,
      `Replay log request failed (${response.status})`
    );
  }
  const details = MyReplayLogApiResponseSchema.parse(await response.json());
  if (reviewShortId !== null && details.review === null) {
    throw new MyReplaysHttpError(
      "Replay review response is unavailable",
      501,
      "review_unavailable"
    );
  }
  return {
    ...details,
    seatEnrichment: details.seatEnrichment.map((enrichment) => {
      if (enrichment === null || enrichment.teamLogoUrl === null) {
        return enrichment;
      }
      try {
        return {
          ...enrichment,
          teamLogoUrl: webAppPath(baseUrl, enrichment.teamLogoUrl),
        };
      } catch {
        return { ...enrichment, teamLogoUrl: null };
      }
    }),
  };
}
