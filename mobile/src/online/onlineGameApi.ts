import { z } from "zod";
import type { GameWSConnectionDetails } from "~/game/client/ws";
import type { SpectatorDelayMs } from "~/game/protocol/spectatorDelay";
import { GameVariantMetadata } from "~/game/protocol/seat";
import { MatchModeConfigSchema } from "~/game/protocol/matchMode";
import { GameSetupSchema, type GameSetup } from "~/game/rules/gameSetup";
import {
  ActiveMatchResponseSchema,
  type ActiveMatchSummary,
} from "~/game/protocol/activeMatch";
import type { MobileAuthSession } from "../auth/mobileAuth";
import {
  absoluteSeatEnrichment,
  type MobileSeatEnrichment,
} from "../seatEnrichment";
import { webAppPath } from "../shell";

const CreateRoomResponseSchema = z.object({
  matchId: z.string().min(1),
  ...GameVariantMetadata,
  mode: MatchModeConfigSchema.optional(),
});
const WatchGameResponseSchema = z.object({
  ok: z.literal(true),
  matchId: z.string().min(1),
});
const GameSessionResponseSchema = z.object({
  token: z.string().min(1),
  wsUrl: z.string().nullable(),
  wsPath: z.string().startsWith("/"),
});
const GameEnrichmentResponseSchema = z.object({
  seats: z.array(
    z.object({
      seat: z.number().int().min(0).max(3),
      teamName: z.string().nullable().optional(),
      teamLogoUrl: z.string().nullable().optional(),
    })
  ),
});

export type OnlineGameEnrichment = [
  MobileSeatEnrichment | null,
  MobileSeatEnrichment | null,
  MobileSeatEnrichment | null,
  MobileSeatEnrichment | null,
];

export function emptyOnlineGameEnrichment(): OnlineGameEnrichment {
  return [null, null, null, null];
}

export class OnlineGameHttpError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "OnlineGameHttpError";
  }
}

async function responseJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    throw new OnlineGameHttpError(
      `Online game request failed (${response.status})`,
      response.status
    );
  }
  return response.json();
}

export async function createOnlineRoom(
  baseUrl: string,
  session: MobileAuthSession,
  options: GameSetup | string,
  spectatorDelayMs: SpectatorDelayMs = 0,
  fetcher: typeof fetch = fetch
): Promise<string> {
  const setup = GameSetupSchema.parse(
    typeof options === "string"
      ? { preset: options, spectatorDelayMs }
      : options
  );
  const response = await fetcher(webAppPath(baseUrl, "/api/game/rooms"), {
    method: "POST",
    body: new URLSearchParams({
      token: session.token,
      preset: setup.preset,
      spectatorDelayMs: String(setup.spectatorDelayMs),
      ...(typeof options !== "string"
        ? {
            rulesFamily: setup.rulesFamily,
            playerCount: String(setup.playerCount),
            sanmaType: setup.sanmaType,
            mode: JSON.stringify(setup.mode),
          }
        : {}),
    }),
  });
  const created = CreateRoomResponseSchema.parse(await responseJson(response));
  if (setup.rulesFamily === "mcr" && created.rulesFamily !== "mcr") {
    throw new Error(
      "The game server does not support MCR. Update the server before creating this table."
    );
  }
  if (
    setup.playerCount === 3 &&
    (created.playerCount !== 3 || created.sanmaType !== setup.sanmaType)
  ) {
    throw new Error(
      "The game server does not support the selected sanma rules. Update the server before creating this table."
    );
  }
  if (
    setup.mode.type === "duplicate" &&
    (created.mode?.type !== "duplicate" ||
      created.mode.seed !== setup.mode.seed ||
      created.mode.generationVersion !== setup.mode.generationVersion)
  ) {
    throw new Error(
      "The game server did not confirm the Duplicate seed. Update the server before creating this table."
    );
  }
  return created.matchId;
}

export async function resolveOnlineWatchId(
  baseUrl: string,
  session: MobileAuthSession,
  watchId: string,
  fetcher: typeof fetch = fetch
): Promise<string> {
  const response = await fetcher(webAppPath(baseUrl, "/api/game/watch"), {
    method: "POST",
    body: new URLSearchParams({ token: session.token, watchId }),
  });
  return WatchGameResponseSchema.parse(await responseJson(response)).matchId;
}

export async function getOnlineGameEnrichment(
  baseUrl: string,
  matchId: string,
  fetcher: typeof fetch = fetch
): Promise<OnlineGameEnrichment> {
  const response = await fetcher(
    webAppPath(
      baseUrl,
      `/api/game/enrichment?matchId=${encodeURIComponent(matchId)}`
    )
  );
  const parsed = GameEnrichmentResponseSchema.parse(
    await responseJson(response)
  );
  const bySeat = emptyOnlineGameEnrichment();
  for (const seat of parsed.seats) {
    bySeat[seat.seat] = {
      teamName: seat.teamName ?? null,
      teamLogoUrl: seat.teamLogoUrl ?? null,
    };
  }
  const absolute = absoluteSeatEnrichment(baseUrl, bySeat);
  return [absolute[0], absolute[1], absolute[2], absolute[3]];
}

export async function getOnlineGameConnectionDetails(
  baseUrl: string,
  session: MobileAuthSession,
  matchId: string,
  fetcher: typeof fetch = fetch
): Promise<GameWSConnectionDetails> {
  const response = await fetcher(webAppPath(baseUrl, "/api/game/session"), {
    method: "POST",
    body: new URLSearchParams({ token: session.token }),
  });
  const details = GameSessionResponseSchema.parse(await responseJson(response));
  const appUrl = new URL(baseUrl);
  appUrl.protocol = appUrl.protocol === "https:" ? "wss:" : "ws:";
  const fallbackOrigin = `${appUrl.protocol}//${appUrl.host}${appUrl.pathname.replace(/\/$/, "")}`;
  const wsOrigin = (details.wsUrl ?? fallbackOrigin).replace(/\/$/, "");
  return {
    token: details.token,
    wsUrl: `${wsOrigin}${details.wsPath}/${encodeURIComponent(matchId)}`,
  };
}

export async function getActiveOnlineGame(
  baseUrl: string,
  session: MobileAuthSession,
  fetcher: typeof fetch = fetch
): Promise<ActiveMatchSummary | null> {
  const response = await fetcher(
    webAppPath(baseUrl, "/api/game/active-match"),
    {
      method: "POST",
      body: new URLSearchParams({ token: session.token }),
    }
  );
  return ActiveMatchResponseSchema.parse(await responseJson(response))
    .activeMatch;
}
