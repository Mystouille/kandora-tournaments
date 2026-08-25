import { useCallback, useEffect, useRef, useState } from "react";
import { isRouteErrorResponse, useRouteError } from "react-router";
import { requireGameEnabled } from "~/game/feature-gate";
import { listPresetIds } from "~/game/rules/presets";
import { requireGameUser } from "~/utils/gameAuth.server";

const DEFAULT_PRESET = "m-league";

export async function loader({ request }: { request: Request }) {
  requireGameEnabled();
  await requireGameUser(request);
  const preset = new URL(request.url).searchParams.get("preset") ?? DEFAULT_PRESET;
  if (!listPresetIds().includes(preset)) {
    throw new Response("Unknown rule preset", { status: 400 });
  }
  return { preset };
}

export default function MobileGameCreate({
  loaderData,
}: {
  loaderData: { preset: string };
}) {
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const createRoom = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const basePath = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
      const response = await fetch(`${basePath}/api/game/rooms`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ preset: loaderData.preset }),
      });
      if (!response.ok) {
        throw new Error(`Game creation failed (${response.status})`);
      }
      const body = (await response.json()) as { matchId?: string };
      if (!body.matchId) {
        throw new Error("The game server returned no room id");
      }
      window.location.replace(
        `${basePath}/game/${encodeURIComponent(body.matchId)}`
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Game creation failed");
    }
  }, [loaderData.preset]);

  useEffect(() => {
    if (started.current) {
      return;
    }
    started.current = true;
    void createRoom();
  }, [createRoom]);

  return (
    <main className="min-h-screen grid place-items-center bg-emerald-950 text-white p-6">
      <section className="grid gap-4 text-center">
        <h1 className="text-xl font-semibold">
          {error === null ? "Creating game" : "Could not create game"}
        </h1>
        {error === null ? (
          <p className="text-emerald-100/70">Preparing your table…</p>
        ) : (
          <>
            <p className="text-red-200">{error}</p>
            <button
              type="button"
              className="rounded bg-emerald-700 px-4 py-2 font-semibold"
              onClick={() => void createRoom()}
            >
              Try again
            </button>
          </>
        )}
      </section>
    </main>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? error.data || `Request failed (${error.status})`
    : "Unable to prepare this game";
  return (
    <main className="min-h-screen grid place-items-center bg-emerald-950 text-white p-6">
      <p>{String(message)}</p>
    </main>
  );
}