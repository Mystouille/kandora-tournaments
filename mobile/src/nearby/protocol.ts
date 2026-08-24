import { z } from "zod";
import {
  ClientMessageSchema,
  ServerMessageSchema,
} from "~/game/protocol/messages";

export const NEARBY_PROTOCOL_VERSION = 1;
export const NEARBY_MAX_PAYLOAD_BYTES = 32 * 1024;

const NearbyHelloFrameSchema = z.object({
  version: z.literal(NEARBY_PROTOCOL_VERSION),
  kind: z.literal("hello"),
  deviceId: z.string().trim().min(1).max(128),
  displayName: z.string().trim().min(1).max(40),
});

const NearbyClientFrameSchema = z.object({
  version: z.literal(NEARBY_PROTOCOL_VERSION),
  kind: z.literal("client"),
  message: ClientMessageSchema,
});

const NearbyServerFrameSchema = z.object({
  version: z.literal(NEARBY_PROTOCOL_VERSION),
  kind: z.literal("server"),
  message: ServerMessageSchema,
});

export const NearbyFrameSchema = z.discriminatedUnion("kind", [
  NearbyHelloFrameSchema,
  NearbyClientFrameSchema,
  NearbyServerFrameSchema,
]);

export type NearbyFrame = z.infer<typeof NearbyFrameSchema>;
export type NearbyHelloFrame = z.infer<typeof NearbyHelloFrameSchema>;

export function encodeNearbyFrame(frame: NearbyFrame): string {
  const encoded = JSON.stringify(NearbyFrameSchema.parse(frame));
  if (new TextEncoder().encode(encoded).byteLength > NEARBY_MAX_PAYLOAD_BYTES) {
    throw new Error("Nearby frame exceeds the 32 KiB byte-payload limit");
  }
  return encoded;
}

export function parseNearbyFrame(data: string): NearbyFrame {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data) as unknown;
  } catch {
    throw new Error("Nearby frame is not valid JSON");
  }
  return NearbyFrameSchema.parse(parsed);
}