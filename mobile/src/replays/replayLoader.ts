import type { ReplayLog } from "~/game/replay/types";
import type { MobileAuthSession } from "../auth/mobileAuth";
import type { MobileReplayStore } from "../persistence/mobileMatchRepository";
import { fetchMyReplayLog, MyReplaysHttpError } from "./myReplaysApi";
import type { ReplayLibraryRow } from "./replayLibrary";

export type ReplayLoadErrorCode =
  | "storage_unavailable"
  | "authentication_required"
  | "not_found"
  | "server_update_required"
  | "unavailable";

export class ReplayLoadError extends Error {
  constructor(readonly code: ReplayLoadErrorCode) {
    super(code);
    this.name = "ReplayLoadError";
  }
}

export async function loadReplayForRow(
  row: ReplayLibraryRow,
  dependencies: {
    replayStore: MobileReplayStore | null;
    webAppBaseUrl: string | null;
    authSession: MobileAuthSession | null;
  }
): Promise<ReplayLog> {
  if (row.mode === "offline") {
    if (dependencies.replayStore === null) {
      throw new ReplayLoadError("storage_unavailable");
    }
    const log = await dependencies.replayStore.getReplayLog(
      row.source,
      row.sourceGameId
    );
    if (log === null) {
      throw new ReplayLoadError("not_found");
    }
    return log;
  }

  if (
    dependencies.webAppBaseUrl === null ||
    dependencies.authSession === null
  ) {
    throw new ReplayLoadError("authentication_required");
  }
  try {
    return await fetchMyReplayLog(
      dependencies.webAppBaseUrl,
      dependencies.authSession,
      row.source,
      row.sourceGameId
    );
  } catch (error) {
    if (error instanceof MyReplaysHttpError) {
      if (error.status === 401) {
        throw new ReplayLoadError("authentication_required");
      }
      if (error.status === 404 && error.code === "replay_not_found") {
        throw new ReplayLoadError("not_found");
      }
      if (error.status === 404 && error.code === null) {
        throw new ReplayLoadError("server_update_required");
      }
    }
    throw new ReplayLoadError("unavailable");
  }
}
