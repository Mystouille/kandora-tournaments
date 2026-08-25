import { z } from "zod";
import type { GameWSConnectionDetails } from "~/game/client/ws";
import type { MobileAuthSession } from "../auth/mobileAuth";
import { webAppPath } from "../shell";

const CreateRoomResponseSchema = z.object({ matchId: z.string().min(1) });
const GameSessionResponseSchema = z.object({
  authenticated: z.literal(true),
  expiresAt: z.number().finite(),
  wsUrl: z.string().nullable(),
  wsPath: z.string().startsWith("/"),
});

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
  const response = await fetcher(
    webAppPath(baseUrl, "/api/mobile/game/rooms"),
    {
      method: "POST",
      body: new URLSearchParams({ token: session.token, preset }),
    }
  );
  return CreateRoomResponseSchema.parse(await responseJson(response)).matchId;
}

export async function getOnlineGameConnectionDetails(
  baseUrl: string,
  session: MobileAuthSession,
  matchId: string,
  fetcher: typeof fetch = fetch
): Promise<GameWSConnectionDetails> {
  const response = await fetcher(
    webAppPath(baseUrl, "/api/mobile/auth/session"),
    {
      method: "POST",
      body: new URLSearchParams({ token: session.token }),
    }
  );
  const details = GameSessionResponseSchema.parse(await responseJson(response));
  const appUrl = new URL(baseUrl);
  appUrl.protocol = appUrl.protocol === "https:" ? "wss:" : "ws:";
  const fallbackOrigin = `${appUrl.protocol}//${appUrl.host}${appUrl.pathname.replace(/\/$/, "")}`;
  const wsOrigin = (details.wsUrl ?? fallbackOrigin).replace(/\/$/, "");
  return {
    token: session.token,
    wsUrl: `${wsOrigin}${details.wsPath}/${encodeURIComponent(matchId)}`,
  };
}