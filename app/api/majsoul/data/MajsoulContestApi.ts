import { getPassport } from "./passport";
import { MajsoulConfigModel } from "../../../db/MajsoulConfig";
import { config } from "../../../../config";
import type { Cookie } from "../types/Cookie";
import type { MSoulUser, RunningGame, GamePlan } from "./types/MSoulUser";
import { getOrGenerateUserAgent } from "./MajsoulConnector";

const BASE_URI = "https://engs.mahjongsoul.com/api/contest_gate/api/contest/";
const LOGIN_URI = "https://engs.mahjongsoul.com/api/contest_gate/api/login";

export class MajsoulContestApi {
  private contestAuthToken: string | undefined;

  public async init(passportToken: string): Promise<void> {
    await this.fetchContestAuthToken(passportToken);
  }

  private async fetchContestAuthToken(passportToken: string): Promise<void> {
    const url = new URL(LOGIN_URI);
    url.searchParams.append("method", "oauth2_yostar_v4");

    const response = await fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: 8,
        code: passportToken,
        uid: config.MAJSOUL_UID,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Contest gate REST login failed: ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as Record<string, unknown>;
    const nested = data.data as Record<string, unknown> | undefined;
    const token =
      (nested?.token as string | undefined) ??
      (data.access_token as string | undefined);

    if (token) {
      this.contestAuthToken = token;
      console.log("[Readiness] logged in to Majsoul admin REST API");
    } else {
      console.warn(
        "Contest gate REST login succeeded but no token found in response:",
        JSON.stringify(data)
      );
    }
  }

  private async refreshContestAuthToken(): Promise<void> {
    console.log("Refreshing contest gate auth token...");
    const userAgent = await getOrGenerateUserAgent();
    const [apiConfig] = await MajsoulConfigModel.find().exec();

    const expireDeadline = Date.now() + 60 * 1000;
    const existingCookies = (
      (apiConfig?.loginCookies as Cookie[]) ?? []
    ).filter((cookie) => !cookie.expires || cookie.expires > expireDeadline);

    const { passport, loginCookies } = await getPassport({
      userId: config.MAJSOUL_UID,
      accessToken: config.MAJSOUL_TOKEN,
      userAgent,
      existingCookies,
    });

    if (apiConfig && loginCookies) {
      await MajsoulConfigModel.updateOne(
        { _id: apiConfig._id },
        { $set: { loginCookies } }
      );
    }

    const passportToken = passport?.accessToken ?? apiConfig?.passportToken;
    if (!passportToken) {
      throw new Error("Contest gate token refresh failed: no passport token.");
    }

    if (passport?.accessToken && apiConfig) {
      await MajsoulConfigModel.updateOne(
        { _id: apiConfig._id },
        { $set: { passportToken: passport.accessToken } }
      );
    }

    await this.fetchContestAuthToken(passportToken);
  }

  private getAuthHeaders(): Record<string, string> {
    if (!this.contestAuthToken) {
      throw new Error(
        "Contest auth token not available. Call init() first or check login."
      );
    }
    return { Authorization: `Majsoul ${this.contestAuthToken}` };
  }

  private async contestAuthFetch(
    url: string,
    init?: RequestInit
  ): Promise<Response> {
    if (!this.contestAuthToken) {
      await this.refreshContestAuthToken();
    }

    const response = await fetch(url, {
      ...init,
      headers: { ...init?.headers, ...this.getAuthHeaders() },
    });

    if (response.status === 401) {
      console.warn("Contest gate returned 401 — refreshing auth token...");
      await this.refreshContestAuthToken();
      return fetch(url, {
        ...init,
        headers: { ...init?.headers, ...this.getAuthHeaders() },
      });
    }

    return response;
  }

  public async fetchContestDetails(contestId: string) {
    const url = new URL(`${BASE_URI}fetch_contest_detail`);
    url.searchParams.append("unique_id", contestId);

    const response = await this.contestAuthFetch(url.toString());

    if (!response.ok) {
      throw new Error(
        `Failed to fetch contest details: ${response.status} ${response.statusText}`
      );
    }

    return await response.json();
  }

  public async fetchContestSeasonList(contestId: string): Promise<
    Array<{
      season_id: number;
      start_time: number;
      end_time: number;
      remark: string;
      state: number;
    }>
  > {
    const url = new URL(`${BASE_URI}fetch_contest_season_list`);
    url.searchParams.append("unique_id", contestId);

    const response = await this.contestAuthFetch(url.toString());

    if (!response.ok) {
      throw new Error(
        `Failed to fetch contest season list: ${response.status} ${response.statusText}`
      );
    }

    const json = (await response.json()) as {
      data: Array<{
        season_id: number;
        start_time: number;
        end_time: number;
        remark: string;
        state: number;
      }>;
    };
    return json.data;
  }

  public async fetchPlayerReadyList(
    contestId: string,
    seasonId: string = "1"
  ): Promise<MSoulUser[]> {
    const url = new URL(`${BASE_URI}ready_player_list`);
    url.searchParams.append("unique_id", contestId);
    url.searchParams.append("season_id", seasonId);
    const response = await this.contestAuthFetch(url.toString());

    if (!response.ok) {
      throw new Error(
        `Failed to fetch player ready list: ${response.status} ${response.statusText}`
      );
    }
    return (await response.json()).data as MSoulUser[];
  }

  public async fetchRunningGameList(
    contestId: string,
    seasonId: string = "1"
  ): Promise<RunningGame[]> {
    const url = new URL(`${BASE_URI}contest_running_game_list`);
    url.searchParams.append("unique_id", contestId);
    url.searchParams.append("season_id", seasonId);
    const response = await this.contestAuthFetch(url.toString());

    if (!response.ok) {
      throw new Error(
        `Failed to fetch running game list: ${response.status} ${response.statusText}`
      );
    }
    return (await response.json()).data as RunningGame[];
  }

  /**
   * Pauses or resumes a running contest game.
   * `resume` payload value: 1 = pause, 2 = resume.
   */
  public async setContestGamePauseState(
    contestId: string,
    gameUuid: string,
    resume: 1 | 2
  ): Promise<void> {
    const url = new URL(`${BASE_URI}pause_contest_running_game`);
    const response = await this.contestAuthFetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        unique_id: Number(contestId),
        game_uuid: gameUuid,
        resume,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to ${resume === 1 ? "pause" : "resume"} contest game ${gameUuid}: ${response.status} ${response.statusText}`
      );
    }
  }

  public async pauseContestGame(
    contestId: string,
    gameUuid: string
  ): Promise<void> {
    return this.setContestGamePauseState(contestId, gameUuid, 1);
  }

  public async resumeContestGame(
    contestId: string,
    gameUuid: string
  ): Promise<void> {
    return this.setContestGamePauseState(contestId, gameUuid, 2);
  }

  /**
   * Terminates a running contest game (destructive). Not exposed via the
   * connector interface; provided for completeness alongside pause/resume.
   */
  public async terminateContestGame(
    contestId: string,
    gameUuid: string
  ): Promise<void> {
    const url = new URL(`${BASE_URI}terminate_contest_running_game`);
    const response = await this.contestAuthFetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        unique_id: String(contestId),
        uuid: gameUuid,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to terminate contest game ${gameUuid}: ${response.status} ${response.statusText}`
      );
    }
  }

  /**
   * Sets the `remark` (tag) on a running contest game. Used to mark a game
   * as paused so the status can be observed via {@link fetchRunningGameList}
   * (Majsoul does not expose pause state on the running game payload itself).
   */
  public async updateContestGameRemark(
    contestId: string,
    gameUuid: string,
    remark: string
  ): Promise<void> {
    const url = new URL(`${BASE_URI}update_contest_game_remark`);
    const response = await this.contestAuthFetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        unique_id: Number(contestId),
        uuid: gameUuid,
        remark,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to update contest game remark for ${gameUuid}: ${response.status} ${response.statusText}`
      );
    }
  }

  public async fetchContestGamePlanList(
    contestId: string,
    seasonId: string = "1"
  ): Promise<GamePlan[]> {
    const url = new URL(`${BASE_URI}fetch_contest_game_plan_list`);
    url.searchParams.append("unique_id", contestId);
    url.searchParams.append("season_id", seasonId);
    const response = await this.contestAuthFetch(url.toString());

    if (!response.ok) {
      throw new Error(
        `Failed to fetch contest game plan list: ${response.status} ${response.statusText}`
      );
    }
    return ((await response.json()).data ?? []) as GamePlan[];
  }

  public async createTeamBatch(
    contestId: string,
    teams: Array<{ name: string; detail?: string }>,
    seasonId: string = "1"
  ): Promise<Array<{ team_id: number; team_name: string }>> {
    const url = new URL(`${BASE_URI}create_contest_team_batch`);

    const response = await this.contestAuthFetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        unique_id: Number(contestId),
        season_id: Number(seasonId),
        team_list: teams.map((t) => ({
          name: t.name,
          detail: t.detail ?? "",
        })),
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to create contest teams: ${response.status} ${response.statusText}`
      );
    }

    const json = (await response.json()) as {
      data: { res: Array<{ team_id: number; team_name: string }> };
    };
    return json.data.res;
  }

  public async addTeamMembers(
    contestId: string,
    teamId: number,
    members: Array<{ account_id: number; nickname: string; remark?: string }>
  ): Promise<string[]> {
    const url = new URL(`${BASE_URI}add_team_member`);

    const response = await this.contestAuthFetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        unique_id: Number(contestId),
        team_id: teamId,
        member_list: members.map((m) => ({
          account_id: m.account_id,
          nickname: m.nickname,
          remark: m.remark ?? "",
        })),
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to add team members: ${response.status} ${response.statusText}`
      );
    }

    const json = (await response.json()) as {
      data: { errors: string[] };
    };
    return json.data.errors;
  }

  public async fetchTeamList(
    contestId: string,
    seasonId: string = "1"
  ): Promise<Array<{ team_id: number; name: string; total_score: number }>> {
    const url = new URL(`${BASE_URI}fetch_contest_team_list`);
    url.searchParams.append("unique_id", contestId);
    url.searchParams.append("season_id", seasonId);
    url.searchParams.append("limit", "100");
    url.searchParams.append("offset", "0");

    const response = await this.contestAuthFetch(url.toString());

    if (!response.ok) {
      throw new Error(
        `Failed to fetch contest team list: ${response.status} ${response.statusText}`
      );
    }

    const json = (await response.json()) as {
      data: {
        list: Array<{ team_id: number; name: string; total_score: number }>;
        total: number;
      };
    };
    return json.data.list;
  }

  public async fetchTeamMembers(
    contestId: string,
    teamId: number,
    seasonId: string = "1"
  ): Promise<Array<{ account_id: number; nickname: string }>> {
    const url = new URL(`${BASE_URI}fetch_contest_team_member_list`);

    const response = await this.contestAuthFetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        unique_id: Number(contestId),
        season_id: Number(seasonId),
        team_id: teamId,
        limit: 100,
        offset: 0,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch team members: ${response.status} ${response.statusText}`
      );
    }

    const json = (await response.json()) as {
      data: {
        list: Array<{ account_id: number; nickname: string }>;
        total: number;
      };
    };
    return json.data.list;
  }

  public async cleanTeamMembers(
    contestId: string,
    teamId: number
  ): Promise<{ success: number; fail: number }> {
    const url = new URL(`${BASE_URI}clean_contest_team_member`);

    const response = await this.contestAuthFetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        unique_id: Number(contestId),
        team_id: teamId,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to clean team members: ${response.status} ${response.statusText}`
      );
    }

    const json = (await response.json()) as {
      data: { success: number; fail: number };
    };
    return json.data;
  }

  public async deleteTeam(contestId: string, teamId: number): Promise<void> {
    const url = new URL(`${BASE_URI}delete_contest_team`);

    const response = await this.contestAuthFetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        unique_id: Number(contestId),
        team_id: teamId,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to delete team: ${response.status} ${response.statusText}`
      );
    }
  }

  /**
   * Schedule a game table in a Mahjong Soul contest.
   *
   * POST /api/contest_gate/api/contest/create_game_plan
   */
  public async createGamePlan(options: {
    contestId: string;
    seasonId: number;
    accountIds: number[];
    initPoints?: number[];
    gameStartTime: number;
    shuffleSeats?: boolean;
    aiLevel?: number;
    remark?: string;
  }): Promise<void> {
    const url = new URL(`${BASE_URI}create_game_plan`);

    const initPoints =
      options.initPoints ?? options.accountIds.map(() => 25000);

    const response = await this.contestAuthFetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        unique_id: Number(options.contestId),
        season_id: options.seasonId,
        account_list: options.accountIds,
        init_points: initPoints,
        game_start_time: options.gameStartTime,
        shuffle_seats: options.shuffleSeats ?? true,
        ai_level: options.aiLevel ?? 0,
        remark: options.remark ?? "",
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to create game plan: ${response.status} ${response.statusText}`
      );
    }
  }

  public async addPlayersToTournament(
    contestId: string,
    seasonId: number,
    players: Array<{ account_id: number; nickname: string }>
  ): Promise<{ failed: number[]; success: number[] }> {
    const url = new URL(`${BASE_URI}add_contest_season_player`);

    const response = await this.contestAuthFetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        unique_id: Number(contestId),
        season_id: seasonId,
        account_list: players,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to add contest season players: ${response.status} ${response.statusText}`
      );
    }

    const json = (await response.json()) as {
      data: { failed: number[]; success: number[] };
    };
    return json.data;
  }
}
