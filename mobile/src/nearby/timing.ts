import type { ClientMessage, ServerMessage } from "~/game/protocol/messages";
import type { AuthorityClock } from "~/game/server/src/timing/authorityClock";
import { LatencySampler } from "~/game/server/src/transport/latencyProfile";
import { clockSampleForProbe } from "~/game/server/src/transport/clockSync";
import { ServerClock } from "~/game/client/time/serverClock";
import { bindLiveClock, releaseLiveClock } from "~/game/client/time/liveClock";
import { refreshScheduledWindow } from "~/game/client/time/liveTimingBinding";
import { reportClockQuality } from "~/game/client/time/timingDiagnostics";

export class NearbyTiming {
  readonly clientClock = new ServerClock();
  private readonly profiles = new Map<string, LatencySampler>();
  private clockProbe = 0;
  private interval: ReturnType<typeof setInterval> | null = null;
  private probing = false;
  private probeSender: (() => void) | null = null;

  constructor(private readonly clock: AuthorityClock) {}

  profile(endpointId: string) {
    return this.profiles.get(endpointId)?.profile() ?? null;
  }

  handleClient(
    endpointId: string,
    matchId: string,
    message: ClientMessage,
    send: (frame: ServerMessage) => void,
    receivedAt: number
  ): boolean {
    if (message.type === "clock_probe") {
      send(clockSampleForProbe(message, matchId, this.clock, receivedAt));
      let sampler = this.profiles.get(endpointId);
      if (!sampler) {
        sampler = new LatencySampler(() => this.clock.now());
        this.profiles.set(endpointId, sampler);
      }
      const probeId = crypto.randomUUID();
      sampler.sent(probeId);
      send({ type: "latency_probe", probeId });
      return true;
    }
    if (message.type === "latency_reply") {
      if (!this.profiles.get(endpointId)?.received(message.probeId)) {
        send({
          type: "error",
          code: "latency_sample_rejected",
          message: "Unknown or stale latency sample.",
        });
      }
      return true;
    }
    return false;
  }

  handleServer(
    message: ServerMessage,
    matchId: string,
    send: (frame: ClientMessage) => void
  ): void {
    if (message.type === "latency_probe") {
      send({ type: "latency_reply", matchId, probeId: message.probeId });
    } else if (message.type === "clock_sample") {
      const result = this.clientClock.observe(message);
      if (!result.accepted) {
        throw new Error(`Nearby clock sample rejected: ${result.reason}`);
      }
      reportClockQuality(this.clientClock.quality());
      refreshScheduledWindow();
    } else if ("clock" in message && message.clock && !this.probing) {
      this.probing = true;
      bindLiveClock(this, this.clientClock);
      const probe = (): void => {
        const probeId = `nearby-clock-${++this.clockProbe}`;
        this.clientClock.createProbe(probeId);
        send({ type: "clock_probe", matchId, probeId });
      };
      this.probeSender = probe;
      probe();
      this.interval = setInterval(probe, 5_000);
    }
  }

  bindHost(): void {
    bindLiveClock(this, {
      now: () => this.clock.now(),
      quality: () => ({
        clockEpoch: this.clock.epoch,
        roundTripMs: 0,
        uncertaintyMs: 0,
        sampledAt: performance.now(),
      }),
    });
  }

  refresh(): void {
    if (this.probeSender !== null) {
      this.clientClock.invalidate();
      this.probeSender();
    }
  }

  reset(): void {
    if (this.interval !== null) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.probing = false;
    this.probeSender = null;
    this.profiles.clear();
    this.clientClock.invalidate();
    releaseLiveClock(this);
  }
}
