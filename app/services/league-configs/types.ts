// Re-export shim. The league-config type module now lives in the kandora-core schema
// package (app/db). Kept for backwards-compatible `~/services/league-configs/types` imports.
export * from "~/db/types/league-config";
