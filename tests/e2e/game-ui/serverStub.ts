export function getAuthenticatedUser(): never {
  throw new Error(
    "The browser UI fixture must not call a server-side auth loader."
  );
}

export function resolveReplayViewerData(): never {
  throw new Error("The browser UI fixture must use its supplied replay data.");
}
