import GameMatch, { type GameMatchLoaderData } from "~/game/routes/match";
import { requireGameEnabled, getClientGameFlag } from "~/game/feature-gate";
import { listPresets } from "~/game/rules/presets";
import { MatchModel } from "~/core/models/game/Match";
import { isbot } from "isbot";
import type { Route } from "./+types/game-match";
import { getGameServerHttpUrl } from "~/services/gameServer.server";
import { basePath } from "~/utils/basePath";
import { connectToDatabase } from "~/utils/dbConnection.server";
import { requireGameUser } from "~/utils/gameAuth.server";

type GameStatus = "waiting" | "playing" | "finished" | "aborted";

interface GamePreviewDetails {
  ruleSetId: string | null;
  status: GameStatus | null;
  duplicate: boolean;
}

interface GamePageMetadata {
  title: string;
  description: string;
  canonicalUrl: string;
  imageUrl: string;
}

interface GameMatchRouteLoaderData extends GameMatchLoaderData {
  metadata: GamePageMetadata;
}

const GAME_METADATA_TIMEOUT_MS = 2_000;
const RULE_SET_NAMES = new Map(
  listPresets().map((preset) => [preset.id, preset.displayName])
);

function publicOrigin(request: Request): string {
  const forwardedProto = request.headers.get("X-Forwarded-Proto");
  const forwardedHost =
    request.headers.get("X-Forwarded-Host") ?? request.headers.get("Host");
  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }
  return new URL(request.url).origin;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStatus(value: unknown): GameStatus | null {
  if (
    value === "waiting" ||
    value === "playing" ||
    value === "finished" ||
    value === "aborted"
  ) {
    return value;
  }
  return null;
}

function isDuplicateMode(value: unknown): boolean {
  return isRecord(value) && value.type === "duplicate";
}

function parseRoomDetails(
  value: unknown,
  matchId: string
): GamePreviewDetails | null {
  if (!isRecord(value) || value.matchId !== matchId) {
    return null;
  }
  return {
    ruleSetId:
      typeof value.presetId === "string" ? value.presetId.trim() || null : null,
    status: parseStatus(value.status),
    duplicate: isDuplicateMode(value.mode),
  };
}

async function loadLiveGameDetails(
  matchId: string
): Promise<GamePreviewDetails | null> {
  const gameServerUrl = getGameServerHttpUrl();
  if (!gameServerUrl) {
    return null;
  }

  const response = await fetch(`${gameServerUrl}/rooms`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(GAME_METADATA_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Game server rooms request failed (${response.status}).`);
  }

  const payload: unknown = await response.json();
  if (!isRecord(payload) || !Array.isArray(payload.rooms)) {
    throw new Error("Game server rooms response has an invalid shape.");
  }

  for (const room of payload.rooms) {
    const details = parseRoomDetails(room, matchId);
    if (details) {
      return details;
    }
  }
  return null;
}

async function loadPersistedGameDetails(
  matchId: string
): Promise<GamePreviewDetails | null> {
  await connectToDatabase();
  const match = await MatchModel.findById(matchId)
    .select("ruleSet status mode")
    .lean();
  if (!match) {
    return null;
  }
  return {
    ruleSetId: match.ruleSet?.trim() || null,
    status: parseStatus(match.status),
    duplicate: isDuplicateMode(match.mode),
  };
}

async function loadGameDetails(
  matchId: string
): Promise<GamePreviewDetails | null> {
  try {
    const liveDetails = await loadLiveGameDetails(matchId);
    if (liveDetails) {
      return liveDetails;
    }
  } catch (error) {
    console.error("Failed to load live game metadata:", error);
  }

  try {
    return await loadPersistedGameDetails(matchId);
  } catch (error) {
    console.error("Failed to load persisted game metadata:", error);
    return null;
  }
}

function statusDescription(status: GameStatus | null): string | null {
  switch (status) {
    case "waiting":
      return "waiting for players";
    case "playing":
      return "in progress";
    case "finished":
      return "finished";
    case "aborted":
      return "ended";
    default:
      return null;
  }
}

function metadataForRequest(
  request: Request,
  matchId: string,
  details: GamePreviewDetails | null
): GamePageMetadata {
  const origin = publicOrigin(request);
  const ruleSetName = details?.ruleSetId
    ? (RULE_SET_NAMES.get(details.ruleSetId) ?? details.ruleSetId)
    : null;
  const status = statusDescription(details?.status ?? null);
  const description = [
    ruleSetName ? `Ruleset: ${ruleSetName}.` : "Online riichi mahjong game.",
    details?.duplicate ? "Mode: Duplicate." : null,
    "Spectator delay: none (live).",
    status ? `Status: ${status}.` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" ");

  return {
    title: ruleSetName
      ? `${ruleSetName} Game | TNT Paris Mahjong`
      : "Mahjong Game | TNT Paris Mahjong",
    description,
    canonicalUrl: `${origin}${basePath}/game/${encodeURIComponent(matchId)}`,
    imageUrl: `${origin}${basePath}/banner/TNT_logo-WHITE.png`,
  };
}

export async function loader({
  params,
  request,
}: Route.LoaderArgs): Promise<GameMatchRouteLoaderData> {
  requireGameEnabled();
  const userAgent = request.headers.get("User-Agent");
  if (!userAgent || !isbot(userAgent)) {
    await requireGameUser(request);
  }
  const details = await loadGameDetails(params.matchId);
  return {
    matchId: params.matchId,
    flag: getClientGameFlag(),
    metadata: metadataForRequest(request, params.matchId, details),
  };
}

export function meta({ data }: Route.MetaArgs) {
  const metadata = data?.metadata;
  if (!metadata) {
    return [{ title: "Mahjong Game | TNT Paris Mahjong" }];
  }

  return [
    { title: metadata.title },
    { name: "description", content: metadata.description },
    { name: "robots", content: "noindex, nofollow" },
    { tagName: "link", rel: "canonical", href: metadata.canonicalUrl },
    { property: "og:title", content: metadata.title },
    { property: "og:description", content: metadata.description },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: "TNT Paris Mahjong" },
    { property: "og:url", content: metadata.canonicalUrl },
    { property: "og:image", content: metadata.imageUrl },
    { property: "og:image:width", content: "306" },
    { property: "og:image:height", content: "306" },
    {
      property: "og:image:alt",
      content: "TNT Paris Mahjong logo",
    },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: metadata.title },
    { name: "twitter:description", content: metadata.description },
    { name: "twitter:image", content: metadata.imageUrl },
  ];
}

export default function GameMatchRoute({ loaderData }: Route.ComponentProps) {
  return <GameMatch loaderData={loaderData} />;
}
