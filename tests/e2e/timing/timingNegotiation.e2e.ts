import { expect, test } from "@playwright/test";
import { ServerMessageSchema } from "../../../app/game/protocol/messages";
import type { RoomEvidence } from "./harness/evidence";

for (const unsupported of [
  {
    name: "turn-only V2",
    timingCapabilities: ["clock-window-v2"],
    fixedPromptVersion: undefined,
  },
  {
    name: "fixed prompts without clock/window V2",
    timingCapabilities: undefined,
    fixedPromptVersion: 1,
  },
]) {
  test(`${unsupported.name} is rejected before attaching a timed player`, async ({
    page,
    request,
  }) => {
    const created = await request.post("/timing/rooms");
    expect(created.ok()).toBe(true);
    const room: { matchId: string } = await created.json();
    try {
      await page.goto("/");
      const result = await page.evaluate(
        async ({ matchId, compatibility }) => {
          const socket = new WebSocket(
            `ws://${location.host}/timing/game/${matchId}`
          );
          return new Promise<unknown>((resolve, reject) => {
            socket.addEventListener("open", () =>
              socket.send(
                JSON.stringify({
                  type: "hello",
                  matchId,
                  token: "isolated-test-token",
                  clientSessionId: "old-timing-fixture",
                  ...compatibility,
                })
              )
            );
            socket.addEventListener("error", () =>
              reject(new Error("The isolated negotiation socket failed"))
            );
            socket.addEventListener("message", (event) => {
              resolve(JSON.parse(event.data));
              socket.close();
            });
          });
        },
        { matchId: room.matchId, compatibility: unsupported }
      );
      expect(ServerMessageSchema.parse(result)).toMatchObject({
        type: "error",
        code: "timing_update_required",
      });
      const response = await request.get(`/timing/rooms/${room.matchId}`);
      expect(response.ok()).toBe(true);
      const authority: RoomEvidence = await response.json();
      expect(authority.attachedSessions).toBe(0);
      expect(authority.status).toBe("waiting");
      expect(authority.window).toBeNull();
      expect(authority.receipts).toEqual([]);
    } finally {
      const response = await request.delete(`/timing/rooms/${room.matchId}`);
      expect(response.ok()).toBe(true);
    }
  });
}
