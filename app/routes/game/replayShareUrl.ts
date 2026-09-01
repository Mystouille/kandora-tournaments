export interface ReplayViewerShareState {
  event?: number;
  seat?: number;
  round?: number;
  review?: string | null;
}

/** Build a public replay deeplink from a strict query-parameter whitelist. */
export function buildReplayViewerShareUrl(
  currentUrl: string,
  state: ReplayViewerShareState
): string {
  const url = new URL(currentUrl);
  url.search = "";
  url.hash = "";

  if (state.seat !== undefined) {
    url.searchParams.set("seat", String(state.seat));
  }
  if (state.round !== undefined) {
    url.searchParams.set("round", String(state.round));
  }
  if (state.event !== undefined) {
    url.searchParams.set("event", String(state.event));
  }
  if (state.review) {
    url.searchParams.set("review", state.review);
  }

  return url.toString();
}