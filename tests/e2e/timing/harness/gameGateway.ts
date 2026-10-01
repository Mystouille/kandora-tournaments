import type { ViteDevServer } from "vite";
import { WebSocketServer, WebSocket } from "ws";
import { fileURLToPath } from "node:url";
import type { MatchProcess } from "../../../../app/game/server/src/match";
import type { AuthorityClock } from "../../../../app/game/server/src/timing/authorityClock";
import { clockSampleForProbe } from "../../../../app/game/server/src/transport/clockSync";
import { LatencySampler } from "../../../../app/game/server/src/transport/latencyProfile";
import { createAuthorityClock } from "../../../../app/game/server/src/timing/authorityClock";
import type {
  MatchRuntime,
  MatchTimer,
} from "../../../../app/game/server/src/runtime";
import type { MatchRepository } from "../../../../app/game/server/src/repository";
import type { ServerMessage } from "../../../../app/game/protocol/messages";
import type { AuthorityReceiptEvidence, RoomEvidence } from "./evidence";
import {
  FIXED_PROMPT_VERSION,
  TIMING_CAPABILITY,
} from "../../../../app/game/protocol/timing";

type GameExports = Pick<
  typeof import("../../../../app/game/server/src/match"),
  "MatchProcess" | "setReadyCheckMs"
>;
type RepositoryExports = Pick<
  typeof import("../../../../app/game/server/src/repository"),
  "createMemoryMatchRepository"
>;
type RuntimeExports = Pick<
  typeof import("../../../../app/game/server/src/runtime"),
  "createSystemMatchRuntime"
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
  return typeof value.createMemoryMatchRepository === "function";
}

function hasRuntimeExports(
  value: Record<string, unknown>
): value is Record<string, unknown> & RuntimeExports {
  return typeof value.createSystemMatchRuntime === "function";
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
  const runtimes: Record<string, unknown> = await server.ssrLoadModule(
    fileURLToPath(
      new URL("../../../../app/game/server/src/runtime.ts", import.meta.url)
    )
  );
  if (
    !hasGameExports(game) ||
    !hasRepositoryExports(repository) ||
    !hasProtocolExports(protocol) ||
    !hasRuntimeExports(runtimes)
  ) {
    throw new Error("The isolated game service exports are incompatible");
  }
  game.setReadyCheckMs(1_500);
  const ownRuntime = (base: MatchRuntime) => {
    const timers = new Set<MatchTimer>();
    const schedule: MatchRuntime["schedule"] = (callback, delay, options) => {
      const timer = base.schedule(
        () => {
          timers.delete(timer);
          callback();
        },
        delay,
        options
      );
      timers.add(timer);
      return {
        cancel: () => {
          timers.delete(timer);
          timer.cancel();
        },
      };
    };
    return {
      runtime: {
        ...base,
        schedule,
        sleep: (delay: number) =>
          new Promise<void>((resolve) => schedule(resolve, delay)),
      },
      cancel: () => {
        for (const timer of timers) {
          timer.cancel();
        }
        timers.clear();
      },
    };
  };
  interface Room {
    match: MatchProcess;
    clock: AuthorityClock;
    repository: MatchRepository;
    runtime: ReturnType<typeof ownRuntime>;
    connections: Map<
      WebSocket,
      { send: (frame: ServerMessage) => void; sessionId: string }
    >;
    receipts: AuthorityReceiptEvidence[];
    pendingReceipt: number | null;
    retired: boolean;
  }
  const rooms = new Map<string, Room>();
  const disposeRoom = (matchId: string): void => {
    const room = rooms.get(matchId);
    if (!room) {
      return;
    }
    room.retired = true;
    room.runtime.cancel();
    for (const websocket of room.connections.keys()) {
      websocket.close();
    }
    room.connections.clear();
    rooms.delete(matchId);
  };
  const evidence = (room: Room): RoomEvidence => {
    const snapshot =
      room.match.status === "playing"
        ? room.match.buildSnapshotForSeat(0)
        : null;
    return {
      matchId: room.match.matchId,
      authorityNow: room.match.authorityNow(),
      window: snapshot?.actionWindow ?? null,
      bankMs: snapshot?.bufferMs ?? null,
      totalDiscards:
        snapshot?.state.discards.reduce(
          (total, pond) => total + pond.length,
          0
        ) ?? 0,
      receipts: room.receipts,
      attachedSessions: room.connections.size,
      status: room.match.status,
    };
  };
  let id = 0;
  server.middlewares.use("/timing/rooms", (request, response) => {
    response.setHeader("content-type", "application/json");
    const handle = async (): Promise<void> => {
      const target = request.url?.match(/^\/(browser-game-\d+)(\/restore)?$/);
      if (
        !target &&
        request.method === "POST" &&
        (request.url === "/" || request.url === "")
      ) {
        const matchId = `browser-game-${++id}`;
        const roomRepository = repository.createMemoryMatchRepository();
        const runtime = ownRuntime(
          runtimes.createSystemMatchRuntime(42, clock)
        );
        const match = new game.MatchProcess(
          matchId,
          42,
          [0, 1, 2, 3].map((seat) => ({
            userId: `human-${seat}`,
            displayName: `Human ${seat}`,
            isBot: false,
          })),
          {
            repository: roomRepository,
            runtime: runtime.runtime,
          }
        );
        rooms.set(matchId, {
          match,
          clock,
          repository: roomRepository,
          runtime,
          connections: new Map(),
          receipts: [],
          pendingReceipt: null,
          retired: false,
        });
        response.end(JSON.stringify({ matchId }));
        return;
      }
      const room = target ? rooms.get(target[1]) : undefined;
      if (!room || !target) {
        response.statusCode = 404;
        response.end(JSON.stringify({ error: "test_room_not_found" }));
        return;
      }
      if (request.method === "DELETE" && !target[2]) {
        disposeRoom(target[1]);
        response.end(JSON.stringify({ disposed: true }));
        return;
      }
      if (request.method === "POST" && target[2]) {
        await room.match.pauseAndSaveCheckpoint();
        room.runtime.cancel();
        room.clock = createAuthorityClock();
        room.runtime = ownRuntime(
          runtimes.createSystemMatchRuntime(42, room.clock)
        );
        const restored = await game.MatchProcess.restoreSavedCheckpoint(
          target[1],
          {
            repository: room.repository,
            runtime: room.runtime.runtime,
          }
        );
        if (!restored) {
          throw new Error("The isolated saved checkpoint was not persisted");
        }
        room.match = restored;
        for (const connection of room.connections.values()) {
          room.match.attachHuman(0, connection.send, undefined, {
            clientSessionId: connection.sessionId,
          });
          connection.send(room.match.buildSnapshotForSeat(0));
        }
        response.end(JSON.stringify(evidence(room)));
        return;
      }
      if (request.method !== "GET" || target[2]) {
        response.statusCode = 405;
        response.end(JSON.stringify({ error: "method_not_allowed" }));
        return;
      }
      response.end(JSON.stringify(evidence(room)));
    };
    void handle().catch((error: unknown) => {
      console.error("Isolated room operation rejected:", error);
      response.statusCode = 500;
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        })
      );
    });
  });
  const sockets = new WebSocketServer({ noServer: true });
  server.httpServer?.on("upgrade", (request, socket, head) => {
    const target = request.url?.match(/^\/timing\/game\/(browser-game-\d+)$/);
    if (!target) {
      return;
    }
    sockets.handleUpgrade(request, socket, head, (websocket) => {
      const room = rooms.get(target[1]);
      const send = (frame: ServerMessage) => {
        if (
          room &&
          room.pendingReceipt !== null &&
          frame.type === "event" &&
          frame.events.some(
            (event) => event.type === "discard" && event.seat === 0
          )
        ) {
          const index = room.pendingReceipt;
          room.receipts[index] = {
            ...room.receipts[index],
            accepted: true,
            resolvedAt: room.match.authorityNow(),
            bankAfterMs: frame.bufferMs ?? null,
          };
        }
        if (websocket.readyState === WebSocket.OPEN) {
          websocket.send(JSON.stringify(frame));
        }
      };
      if (!room) {
        send({
          type: "error",
          code: "match_not_found",
          message: "Test room does not exist",
        });
        websocket.close();
        return;
      }
      let authorized = false;
      const latency = new LatencySampler(() => room.clock.now());
      websocket.on("message", (raw) => {
        const receivedAt = room.match.authorityNow();
        const handle = async (): Promise<void> => {
          const match = room.match;
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
            if (!message.clientSessionId) {
              throw new Error(
                "The isolated handshake requires a client session"
              );
            }
            if (
              !message.timingCapabilities?.includes(TIMING_CAPABILITY) ||
              message.fixedPromptVersion !== FIXED_PROMPT_VERSION
            ) {
              send({
                type: "error",
                code: "timing_update_required",
                message:
                  "The isolated V2 authority requires fixed prompt support",
              });
              websocket.close();
              return;
            }
            authorized = true;
            match.configurePlayerTiming(0, "remote", () => latency.profile());
            const attached = match.attachHuman(0, send, undefined, {
              clientSessionId: message.clientSessionId,
              takeover: message.takeover,
            });
            if (attached.previousSend) {
              for (const [previous, connection] of room.connections) {
                if (connection.send === attached.previousSend) {
                  room.connections.delete(previous);
                  previous.close(4009, "Test session replaced");
                }
              }
            }
            room.connections.set(websocket, {
              send,
              sessionId: message.clientSessionId,
            });
            if (match.status === "waiting") {
              const starting = match.start();
              await new Promise<void>((resolve) => setTimeout(resolve, 0));
              send(match.buildSnapshotForSeat(0));
              await starting;
            } else {
              send(match.buildSnapshotForSeat(0));
            }
          } else if (!authorized) {
            send({
              type: "error",
              code: "auth_failed",
              message: "Handshake required",
            });
          } else if (!match.isHumanAttached(0, send)) {
            throw new Error("The isolated input belongs to a replaced session");
          } else if (message.type === "clock_probe") {
            send(
              clockSampleForProbe(
                message,
                match.matchId,
                room.clock,
                receivedAt
              )
            );
            const probeId = crypto.randomUUID();
            latency.sent(probeId);
            send({ type: "latency_probe", probeId });
          } else if (message.type === "latency_reply") {
            if (!latency.received(message.probeId)) {
              throw new Error("Unmatched latency response");
            }
          } else if (message.type === "act") {
            const index = room.receipts.length;
            room.receipts.push({
              actionId: message.actionId,
              windowId: message.windowId ?? null,
              clockEpoch: message.clockEpoch ?? null,
              receivedAt,
              resolvedAt: receivedAt,
              accepted: false,
              bankAfterMs: null,
            });
            room.pendingReceipt = index;
            try {
              await match.handleAct(0, message.actionId, {
                receivedAt,
                windowId: message.windowId,
                clockEpoch: message.clockEpoch,
                stateSeq: message.stateSeq,
              });
            } catch (error) {
              room.receipts[index] = {
                ...room.receipts[index],
                resolvedAt: match.authorityNow(),
                error: error instanceof Error ? error.message : String(error),
              };
              throw error;
            } finally {
              if (room.pendingReceipt === index) {
                room.pendingReceipt = null;
              }
            }
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
      websocket.on("close", () => {
        room.connections.delete(websocket);
      });
    });
  });
  server.httpServer?.once("close", () => {
    for (const matchId of [...rooms.keys()]) {
      disposeRoom(matchId);
    }
    for (const websocket of sockets.clients) {
      websocket.terminate();
    }
    sockets.close();
  });
}
