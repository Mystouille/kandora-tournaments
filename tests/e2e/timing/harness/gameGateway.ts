import type { ViteDevServer } from "vite";
import { WebSocketServer, WebSocket } from "ws";
import { fileURLToPath } from "node:url";
import type { MatchProcess } from "../../../../app/game/server/src/match";
import type { AuthorityClock } from "../../../../app/game/server/src/timing/authorityClock";
import { clockSampleForProbe } from "../../../../app/game/server/src/transport/clockSync";
import { LatencySampler } from "../../../../app/game/server/src/transport/latencyProfile";

type GameExports = Pick<
  typeof import("../../../../app/game/server/src/match"),
  "MatchProcess" | "setReadyCheckMs"
>;
type RepositoryExports = Pick<
  typeof import("../../../../app/game/server/src/repository"),
  "ephemeralMatchRepository"
>;
type ProtocolExports = Pick<
  typeof import("../../../../app/game/protocol/messages"),
  "ClientMessageSchema"
>;

function hasGameExports(
  value: Record<string, unknown>
): value is Record<string, unknown> & GameExports {
  return (
    typeof value.MatchProcess === "function" &&
    typeof value.setReadyCheckMs === "function"
  );
}

function hasRepositoryExports(
  value: Record<string, unknown>
): value is Record<string, unknown> & RepositoryExports {
  const repository = value.ephemeralMatchRepository;
  return (
    typeof repository === "object" &&
    repository !== null &&
    "createMatch" in repository &&
    typeof repository.createMatch === "function" &&
    "saveCheckpoint" in repository &&
    typeof repository.saveCheckpoint === "function"
  );
}

function hasProtocolExports(
  value: Record<string, unknown>
): value is Record<string, unknown> & ProtocolExports {
  const schema = value.ClientMessageSchema;
  return (
    typeof schema === "object" &&
    schema !== null &&
    "parse" in schema &&
    typeof schema.parse === "function"
  );
}

export async function installGameGateway(
  server: ViteDevServer,
  clock: AuthorityClock
) {
  const game: Record<string, unknown> = await server.ssrLoadModule(
    fileURLToPath(
      new URL("../../../../app/game/server/src/match.ts", import.meta.url)
    )
  );
  const repository: Record<string, unknown> = await server.ssrLoadModule(
    fileURLToPath(
      new URL("../../../../app/game/server/src/repository.ts", import.meta.url)
    )
  );
  const protocol: Record<string, unknown> = await server.ssrLoadModule(
    fileURLToPath(
      new URL("../../../../app/game/protocol/messages.ts", import.meta.url)
    )
  );
  if (
    !hasGameExports(game) ||
    !hasRepositoryExports(repository) ||
    !hasProtocolExports(protocol)
  ) {
    throw new Error("The isolated game service exports are incompatible");
  }
  game.setReadyCheckMs(1_500);
  const rooms = new Map<string, MatchProcess>();
  let id = 0;
  server.middlewares.use("/timing/rooms", (request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.method !== "POST") {
      response.statusCode = 405;
      response.end(JSON.stringify({ error: "method_not_allowed" }));
      return;
    }
    const matchId = `browser-game-${++id}`;
    const match = new game.MatchProcess(
      matchId,
      42,
      [0, 1, 2, 3].map((seat) => ({
        userId: `human-${seat}`,
        displayName: `Human ${seat}`,
        isBot: false,
      })),
      {
        repository: repository.ephemeralMatchRepository,
        authorityClock: clock,
        timingMode: "windows-v2",
      }
    );
    rooms.set(matchId, match);
    response.end(JSON.stringify({ matchId }));
  });
  const sockets = new WebSocketServer({ noServer: true });
  server.httpServer?.on("upgrade", (request, socket, head) => {
    const target = request.url?.match(/^\/timing\/game\/(browser-game-\d+)$/);
    if (!target) {
      return;
    }
    sockets.handleUpgrade(request, socket, head, (websocket) => {
      const match = rooms.get(target[1]);
      const send = (
        frame: import("../../../../app/game/protocol/messages").ServerMessage
      ) => {
        if (websocket.readyState === WebSocket.OPEN) {
          websocket.send(JSON.stringify(frame));
        }
      };
      if (!match) {
        send({
          type: "error",
          code: "match_not_found",
          message: "Test room does not exist",
        });
        websocket.close();
        return;
      }
      let authorized = false;
      const latency = new LatencySampler(() => clock.now());
      websocket.on("message", (raw) => {
        const receivedAt = match.authorityNow();
        const handle = async (): Promise<void> => {
          const message = protocol.ClientMessageSchema.parse(
            JSON.parse(raw.toString())
          );
          if (message.type === "hello") {
            if (message.token !== "isolated-test-token") {
              send({
                type: "error",
                code: "auth_failed",
                message: "Invalid test session",
              });
              websocket.close();
              return;
            }
            authorized = true;
            match.configurePlayerTiming(0, "remote", () => latency.profile());
            match.attachHuman(0, send);
            if (match.status === "waiting") {
              const starting = match.start();
              await new Promise<void>((resolve) => setTimeout(resolve, 0));
              send(match.buildSnapshotForSeat(0));
              await starting;
            }
            send(match.buildSnapshotForSeat(0));
          } else if (!authorized) {
            send({
              type: "error",
              code: "auth_failed",
              message: "Handshake required",
            });
          } else if (message.type === "clock_probe") {
            send(
              clockSampleForProbe(message, match.matchId, clock, receivedAt)
            );
            const probeId = crypto.randomUUID();
            latency.sent(probeId);
            send({ type: "latency_probe", probeId });
          } else if (message.type === "latency_reply") {
            if (!latency.received(message.probeId)) {
              throw new Error("Unmatched latency response");
            }
          } else if (message.type === "act") {
            await match.handleAct(0, message.actionId, {
              receivedAt,
              windowId: message.windowId,
              clockEpoch: message.clockEpoch,
              stateSeq: message.stateSeq,
            });
          } else if (message.type === "resync") {
            send(match.buildSnapshotForSeat(0));
          }
        };
        void handle().catch((error: unknown) => {
          console.error("Isolated game command rejected:", error);
          send({
            type: "error",
            code: "decision_rejected",
            message: error instanceof Error ? error.message : String(error),
          });
        });
      });
    });
  });
  server.httpServer?.once("close", () => sockets.close());
}
