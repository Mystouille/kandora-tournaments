import { z } from "zod";
import type { NearbyIdentity } from "./NearbyMatchController";

const STORAGE_KEY = "kandora.nearby.identity.v1";

const StoredIdentitySchema = z.object({
  deviceId: z.string().min(1),
  displayName: z.string().min(1).max(40),
});

function createDeviceId(): string {
  if (typeof globalThis.crypto.randomUUID === "function") {
    return `mobile:${globalThis.crypto.randomUUID()}`;
  }
  const values = new Uint32Array(4);
  globalThis.crypto.getRandomValues(values);
  return `mobile:${[...values].map((value) => value.toString(16)).join("")}`;
}

function saveIdentity(identity: NearbyIdentity): NearbyIdentity {
  globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  return identity;
}

export function loadNearbyIdentity(): NearbyIdentity {
  const stored = globalThis.localStorage.getItem(STORAGE_KEY);
  if (stored !== null) {
    try {
      const parsed = StoredIdentitySchema.safeParse(
        JSON.parse(stored) as unknown
      );
      if (parsed.success) {
        return parsed.data;
      }
    } catch {
      // Replace malformed local identity data below.
    }
  }
  const deviceId = createDeviceId();
  return saveIdentity({
    deviceId,
    displayName: `Player ${deviceId.slice(-4).toUpperCase()}`,
  });
}

export function updateNearbyDisplayName(
  identity: NearbyIdentity,
  displayName: string
): NearbyIdentity {
  const nextIdentity = StoredIdentitySchema.parse({
    ...identity,
    displayName: displayName.trim(),
  });
  return saveIdentity(nextIdentity);
}