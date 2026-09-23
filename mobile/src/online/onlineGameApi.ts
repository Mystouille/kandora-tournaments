import { z } from "zod";
import type { GameWSConnectionDetails } from "~/game/client/ws";
import type { MobileAuthSession } from "../auth/mobileAuth";
import {
  absoluteSeatEnrichment,
  type MobileSeatEnrichment,
} from "../seatEnrichment";
import { webAppPath } from "../shell";

const CreateRoomResponseSchema = z.object({ matchId: z.string().min(1) });
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
  preset: string,
  fetcher: typeof fetch = fetch
): Promise<string> {
  const response = await fetcher(webAppPath(baseUrl, "/api/game/rooms"), {
    method: "POST",
    body: new URLSearchParams({ token: session.token, preset }),
  });
  return CreateRoomResponseSchema.parse(await responseJson(response)).matchId;
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
