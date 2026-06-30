/**
 * Returns the base path for client-side fetch calls.
 * Strips the trailing slash from Vite's BASE_URL so it can be prepended to "/api/..." paths.
 * e.g. "/dev" when REMOTE, "" otherwise.
 */
export const basePath = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
