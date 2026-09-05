import { z } from "zod";
import { GameEventSchema } from "~/game/protocol/messages";
import type { ReplayLog } from "~/game/replay/types";

const ReplaySeatSchema = z.object({
  seat: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  displayName: z.string(),
  finalScore: z.number().finite(),
  place: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
});

export const MobileReplayLogSchema: z.ZodType<ReplayLog> = z.object({
  source: z.enum(["ingame", "majsoul", "tenhou", "riichicity"]),
  sourceGameId: z.string().min(1),
  ruleSet: z.string().min(1),
  ruleSetDetails: z.record(z.string(), z.unknown()).optional(),
  startedAt: z.number().finite(),
  endedAt: z.number().finite(),
  seats: z.array(ReplaySeatSchema).length(4),
  events: z.array(GameEventSchema),
  schemaVersion: z.number().int().positive(),
});

export function parseMobileReplayLog(value: unknown): ReplayLog | null {
  const parsed = MobileReplayLogSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
