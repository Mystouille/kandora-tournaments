import { describe, expect, it } from "vitest";
import {
  encodeNearbyFrame,
  NEARBY_PROTOCOL_VERSION,
  parseNearbyFrame,
} from "./protocol";

describe("Nearby match protocol", () => {
  it("round-trips handshake and existing game-protocol frames", () => {
    const hello = {
      version: NEARBY_PROTOCOL_VERSION,
      kind: "hello",
      deviceId: "mobile:device-1",
      displayName: "Mika",
    } as const;
    expect(parseNearbyFrame(encodeNearbyFrame(hello))).toEqual(hello);

    const client = {
      version: NEARBY_PROTOCOL_VERSION,
      kind: "client",
      message: {
        type: "act",
        matchId: "nearby-room-1",
        actionId: "discard:draw:5m",
      },
    } as const;
    expect(parseNearbyFrame(encodeNearbyFrame(client))).toEqual(client);

    const server = {
      version: NEARBY_PROTOCOL_VERSION,
      kind: "server",
      message: {
        type: "error",
        code: "test_error",
        message: "Test message",
      },
    } as const;
    expect(parseNearbyFrame(encodeNearbyFrame(server))).toEqual(server);
  });

  it("rejects malformed, unsupported, and oversized frames", () => {
    expect(() => parseNearbyFrame("not-json")).toThrow("not valid JSON");
    expect(() =>
      parseNearbyFrame(
        JSON.stringify({
          version: 2,
          kind: "hello",
          deviceId: "mobile:device-1",
          displayName: "Mika",
        })
      )
    ).toThrow();
    expect(() =>
      encodeNearbyFrame({
        version: NEARBY_PROTOCOL_VERSION,
        kind: "server",
        message: {
          type: "error",
          code: "oversized",
          message: "x".repeat(33 * 1024),
        },
      })
    ).toThrow("32 KiB");
  });
});