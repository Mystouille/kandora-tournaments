import type { Page } from "@playwright/test";
import { performance } from "node:perf_hooks";
import {
  transportDelayMs,
  type FairnessProfile,
  type TransportDirection,
} from "../../../app/game/testing/timing/fairnessProfiles";

export interface ControlledTransport {
  readonly delays: Array<{ direction: TransportDirection; delayMs: number }>;
  dispose(): void;
}

export async function installControlledTransport(
  page: Page,
  profile: FairnessProfile
): Promise<ControlledTransport> {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const delays: ControlledTransport["delays"] = [];
  let disposed = false;
  await page.routeWebSocket("**/timing/game/**", (client) => {
    const server = client.connectToServer();
    const origin = performance.now();
    const sequence = { upstream: 0, downstream: 0 };
    const previousDelivery = { upstream: origin, downstream: origin };
    const forward = (
      direction: TransportDirection,
      message: string | Buffer
    ): void => {
      if (disposed) {
        return;
      }
      const now = performance.now();
      let due =
        now + transportDelayMs(profile, direction, sequence[direction]++);
      if (direction === "downstream" && profile.burstMs) {
        due =
          origin +
          Math.ceil((due - origin) / profile.burstMs) * profile.burstMs;
      }
      // WebSocket delivery remains ordered; jitter may produce a real burst.
      due = Math.max(due, previousDelivery[direction]);
      previousDelivery[direction] = due;
      delays.push({ direction, delayMs: due - now });
      const timer = setTimeout(
        () => {
          timers.delete(timer);
          if (!disposed) {
            if (direction === "upstream") {
              server.send(message);
            } else {
              client.send(message);
            }
          }
        },
        Math.max(0, due - now)
      );
      timers.add(timer);
    };
    client.onMessage((message) => forward("upstream", message));
    server.onMessage((message) => forward("downstream", message));
    client.onClose(() => server.close());
    server.onClose((code, reason) => client.close({ code, reason }));
  });
  return {
    delays,
    dispose: () => {
      disposed = true;
      for (const timer of timers) {
        clearTimeout(timer);
      }
      timers.clear();
    },
  };
}
