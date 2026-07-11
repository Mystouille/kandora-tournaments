import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { riichiCityConfig } from "config";
import type {
  GameData,
  GameResponse,
  InitSessionResponse,
  LogListData,
  LogListResponse,
  LoginResponse,
  OnlineRoomResponse,
  PlayerStatusResponse,
  RankResponse,
  SelfIdentityData,
  StartGameResponse,
  TournamentInfoResponse,
} from "./riichiCityModels";
import { PlayerStatus } from "./riichiCityModels";

type JsonRecord = Record<string, unknown>;

export interface RiichiCityServiceOptions {
  email?: string;
  password?: string;
  guid?: string;
  timeoutMs?: number;
  cacheDir?: string;
}

export interface RiichiCityApiResponse<T = unknown> {
  code: number;
  message?: string;
  data: T;
}

export interface RiichiCityPaiPuListRequest {
  classifyID: string | number;
  gamePlay?: number;
  classType?: number;
  isAiAnalysis?: boolean;
  isSelf?: boolean;
  startTime?: number;
  endTime?: number;
  limit?: number;
  skip?: number;
}

export interface RiichiCityUserBrief {
  id?: number;
  name?: string;
  nickname?: string;
  userID?: number;
  [key: string]: unknown;
}

export enum RiichiCityRoomStatus {
  Pause = 1,
  Resume = 2,
  Terminate = 3,
}

function shuffleInPlace<T>(list: T[]): void {
  for (let n = list.length; n > 1; n -= 1) {
    const k = Math.floor(Math.random() * n);
    const tmp = list[k];
    list[k] = list[n - 1];
    list[n - 1] = tmp;
  }
}

function toRiichiCookies(payload: JsonRecord): string {
  return JSON.stringify(payload);
}

export class RiichiCityService {
  private readonly email: string;
  private readonly password: string;
  private readonly guid: string;
  private readonly adjustId: string;
  private readonly deviceId: string;
  private readonly domainId: string;
  private readonly apiVersion: string;
  private readonly timeoutMs: number;
  private readonly cacheDir?: string;

  private sessionId = "";
  private userId = -1;

  constructor(options: RiichiCityServiceOptions = {}) {
    const rcCfg = riichiCityConfig();
    this.email = options.email ?? rcCfg?.RIICHICITY_EMAIL ?? "";
    this.password = options.password ?? rcCfg?.RIICHICITY_PASSWD ?? "";
    this.guid = options.guid ?? rcCfg?.RIICHICITY_GUID ?? "";
    this.adjustId = "";
    this.deviceId = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
    this.domainId = "alicdn.mahjong-jp.net";
    this.apiVersion = "1.1.4.11030";
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.cacheDir = options.cacheDir;

    if (!this.email || !this.password || !this.guid) {
      throw new Error(
        "Missing Riichi City credentials. Set RIICHICITY_EMAIL, RIICHICITY_PASSWD and RIICHICITY_GUID."
      );
    }
  }

  private get baseUrl(): string {
    return `https://${this.domainId}`;
  }

  private get initCookies(): string {
    return toRiichiCookies({
      channel: "default",
      deviceid: this.deviceId,
      lang: "en",
      version: this.apiVersion,
      platform: "pc",
    });
  }

  private get authCookies(): string {
    return toRiichiCookies({
      channel: "default",
      deviceid: this.deviceId,
      lang: "en",
      version: this.apiVersion,
      platform: "pc",
      region: "cn",
      sid: this.sessionId,
      uid: this.userId,
    });
  }

  private async postJson<T>(
    endpoint: string,
    body?: JsonRecord,
    headers: Record<string, string> = {}
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch(`${this.baseUrl}${endpoint}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...headers,
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        const payload = await response.text();
        try {
          return JSON.parse(payload) as T;
        } catch {
          throw new Error(
            `RiichiCity returned non-JSON response for ${endpoint} (status ${response.status}).`
          );
        }
      } catch (error) {
        lastError = error;
        if (attempt === 0) {
          const reason = error instanceof Error ? error.message : String(error);
          console.info(
            `RiichiCity request first attempt failed for ${endpoint}: ${reason}`
          );
          continue;
        }
      }
    }

    const reason =
      lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(`RiichiCity request failed for ${endpoint}: ${reason}`);
  }

  private async initSession(): Promise<string> {
    const payload = await this.postJson<InitSessionResponse>(
      "/users/initSession",
      undefined,
      {
        Cookies: this.initCookies,
      }
    );
    this.sessionId = payload.data;
    return this.sessionId;
  }

  async login(): Promise<{ code: number; message: string }> {
    await this.initSession();

    const payload = await this.postJson<LoginResponse>(
      "/users/emailLogin",
      {
        email: this.email,
        passwd: this.password,
        guid: this.guid,
        adjustId: this.adjustId,
      },
      {
        Cookies: toRiichiCookies({
          channel: "default",
          deviceid: this.deviceId,
          lang: "en",
          version: this.apiVersion,
          platform: "pc",
          sid: this.sessionId,
        }),
      }
    );

    if (payload.code !== 0) {
      throw new Error(`RiichiCity login failed: ${payload.message}`);
    }

    this.userId = payload.data.user.id;
    console.log("[Readiness] Riichi City service connected");
    return { code: payload.code, message: payload.message };
  }

  private async ensureAuthenticated(): Promise<void> {
    if (!this.sessionId || this.userId < 0) {
      await this.login();
    }
  }

  private async postAuthed<T>(endpoint: string, body: JsonRecord): Promise<T> {
    return this.postJson<T>(endpoint, body, {
      "User-Agent":
        "UnityPlayer/2019.4.23f1 (UnityWebRequest/1.0, libcurl/7.52.0-DEV)",
      Cookies: this.authCookies,
      "X-Unity-Version": "2019.4.23f1",
      "Accept-Encoding": "deflate,gzip",
      Accept: "application/json",
    });
  }

  async getTournamentPlayers(
    tournamentId: number
  ): Promise<RiichiCityApiResponse> {
    await this.login();
    return this.postAuthed<RiichiCityApiResponse>("/lobbys/getSelfManageInfo", {
      matchID: tournamentId,
    });
  }

  /**
   * Saves a set of pre-defined table pairings ("self table configs") on a
   * Riichi City tournament. Each table is exactly 4 players, with `position`
   * 0 (auto seat) and `order` 1..4. `points` defaults to 25_000.
   */
  async addSelfTableConfig(
    tournamentId: number,
    name: string,
    tables: Array<{ userID: number; nickname: string }[]>,
    fallBack = true
  ): Promise<RiichiCityApiResponse> {
    await this.ensureAuthenticated();

    const tableConfigs = tables.map((table) => ({
      userConfigs: table.map((p, idx) => ({
        userID: p.userID,
        points: 25000,
        identity: 1,
        nickname: p.nickname,
        order: idx + 1,
        position: 0,
      })),
    }));

    const payload = await this.postAuthed<RiichiCityApiResponse>(
      "/lobbys/addSelfTableConfig",
      {
        tableConfigs,
        matchID: tournamentId,
        name,
      }
    );

    if (payload.code === 10 && fallBack) {
      await this.login();
      return this.addSelfTableConfig(tournamentId, name, tables, false);
    }
    return payload;
  }

  /**
   * Lists the saved table configs for a tournament. Riichi City limits a
   * tournament to 5 saved configs, so callers typically use this together
   * with `delSelfTableConfig` to free up slots before saving new pairings.
   */
  async listSelfTableConfigs(
    tournamentId: number,
    fallBack = true
  ): Promise<
    RiichiCityApiResponse<Array<{ configID: string; name?: string }> | null>
  > {
    await this.ensureAuthenticated();

    const payload = await this.postAuthed<
      RiichiCityApiResponse<Array<{ configID: string; name?: string }> | null>
    >("/lobbys/selfTableConfigList", {
      matchID: tournamentId,
    });

    if (payload.code === 10 && fallBack) {
      await this.login();
      return this.listSelfTableConfigs(tournamentId, false);
    }
    return payload;
  }

  async delSelfTableConfig(
    tournamentId: number,
    configID: string,
    fallBack = true
  ): Promise<RiichiCityApiResponse> {
    await this.ensureAuthenticated();

    const payload = await this.postAuthed<RiichiCityApiResponse>(
      "/lobbys/delSelfTableConfig",
      {
        configID,
        matchID: tournamentId,
      }
    );

    if (payload.code === 10 && fallBack) {
      await this.login();
      return this.delSelfTableConfig(tournamentId, configID, false);
    }
    return payload;
  }

  async resolveInternalTournamentId(
    tournamentId: number,
    fallBack = true
  ): Promise<string> {
    const payload = await this.getTournamentInfo(tournamentId, fallBack);
    const classifyID = payload.data?.classifyID;

    if (payload.code !== 0 || classifyID == null) {
      throw new Error(
        `RiichiCity enterSelfBuild did not return classifyID for tournament ${tournamentId}`
      );
    }

    return String(classifyID);
  }

  async getTournamentInfo(
    tournamentId: number,
    fallBack = true
  ): Promise<TournamentInfoResponse> {
    const payload = await this.postAuthed<TournamentInfoResponse>(
      "/lobbys/enterSelfBuild",
      { id: tournamentId }
    );

    if (payload.code === 10 && fallBack) {
      await this.login();
      return this.getTournamentInfo(tournamentId, false);
    }
    return payload;
  }

  async getPlayerScores(
    tournamentId: number,
    internalTournamentId?: string | number,
    fallBack = true
  ): Promise<RankResponse> {
    const classifyID =
      internalTournamentId ??
      (await this.resolveInternalTournamentId(tournamentId, fallBack));
    const payload = await this.postAuthed<RankResponse>("/stats/getSelfRank", {
      matchID: tournamentId,
      classifyID,
    });

    if (payload.code === 10 && fallBack) {
      await this.login();
      return this.getPlayerScores(tournamentId, internalTournamentId, false);
    }
    return payload;
  }

  async getPlayersStatus(
    tournamentId: number,
    fallBack = true
  ): Promise<PlayerStatusResponse> {
    const payload = await this.postAuthed<PlayerStatusResponse>(
      "/lobbys/getSelfManageInfo",
      { matchID: tournamentId }
    );

    if (payload.code === 10 && fallBack) {
      await this.login();
      return this.getPlayersStatus(tournamentId, false);
    }

    return payload;
  }

  /**
   * Returns the tournament's registered player roster (self identity info).
   * Unlike getSelfManageInfo (which reflects live lobby status), this endpoint
   * returns the full list of players enrolled in the tournament.
   */
  async getSelfIdentityInfo(
    tournamentId: number,
    fallBack = true
  ): Promise<RiichiCityApiResponse<SelfIdentityData[]>> {
    const payload = await this.postAuthed<
      RiichiCityApiResponse<SelfIdentityData[]>
    >("/lobbys/selfIdentityInfo", { matchID: tournamentId });

    if (payload.code === 10 && fallBack) {
      await this.login();
      return this.getSelfIdentityInfo(tournamentId, false);
    }

    return payload;
  }

  async getPlayerStatusCounts(
    tournamentId: number
  ): Promise<{ online: number; ready: number; inGame: number }> {
    const response = await this.getPlayersStatus(tournamentId);
    const players = (response.data ?? []).filter(
      (p) => p.userID !== this.userId
    );
    let online = 0;
    let ready = 0;
    let inGame = 0;
    for (const p of players) {
      if (p.status === PlayerStatus.Online) {
        online += 1;
      } else if (p.status === PlayerStatus.Ready) {
        ready += 1;
      } else if (p.status === PlayerStatus.InGame) {
        inGame += 1;
      }
    }
    return { online, ready, inGame };
  }

  async getUserBrief(
    userId: number,
    fallBack = true
  ): Promise<RiichiCityApiResponse<RiichiCityUserBrief>> {
    await this.ensureAuthenticated();

    const payload = await this.postAuthed<
      RiichiCityApiResponse<RiichiCityUserBrief>
    >("/users/userBrief", { userId });

    if (payload.code === 10 && fallBack) {
      await this.login();
      return this.getUserBrief(userId, false);
    }

    return payload;
  }

  async startGame(
    tournamentId: number,
    playerIds: number[],
    fallBack = true
  ): Promise<boolean> {
    const botIds = [113808489, 217163646, 511575033];
    const ids = [...playerIds];
    if (ids.length < 4) {
      ids.push(...botIds.slice(0, 4 - ids.length));
    }

    shuffleInPlace(ids);

    const payload = await this.postAuthed<StartGameResponse>(
      "/lobbys/allocateSelfUser",
      {
        matchID: tournamentId,
        usersID: ids,
        table_idx: 1,
      }
    );

    if (payload.code === 10 && fallBack) {
      await this.login();
      return this.startGame(tournamentId, playerIds, false);
    }
    if (payload.code !== 0 || !payload.data) {
      const reason = payload.message?.trim()
        ? payload.message
        : `code ${payload.code}`;
      throw new Error(`RiichiCity allocateSelfUser failed: ${reason}`);
    }
    return true;
  }

  private cachePathFor(gameId: string): string | null {
    if (!this.cacheDir) {
      return null;
    }
    return `${this.cacheDir}/${gameId}.json`;
  }

  async getLog(gameId: string, fallBack = true): Promise<GameData> {
    const cachePath = this.cachePathFor(gameId);
    if (fallBack && cachePath && existsSync(cachePath)) {
      const cached = await readFile(cachePath, "utf8");
      const parsed = JSON.parse(cached) as GameResponse;
      return parsed.data;
    }

    const payload = await this.postAuthed<GameResponse>("/record/getRoomData", {
      keyValue: gameId,
      isObserve: false,
    });

    if (payload.code === 10 && fallBack) {
      await this.login();
      return this.getLog(gameId, false);
    }

    if (cachePath) {
      await mkdir(this.cacheDir!, { recursive: true });
      await writeFile(cachePath, JSON.stringify(payload), "utf8");
    }

    return payload.data;
  }

  async readPaiPuList(
    request: RiichiCityPaiPuListRequest,
    fallBack = true
  ): Promise<LogListResponse> {
    const payload = await this.postAuthed<LogListResponse>(
      "/record/readPaiPuList",
      {
        classifyID: String(request.classifyID),
        gamePlay: request.gamePlay ?? 1002,
        classType: request.classType ?? 1002,
        isAiAnalysis: request.isAiAnalysis ?? false,
        isSelf: request.isSelf ?? true,
        startTime: request.startTime ?? 0,
        endTime: request.endTime ?? 0,
        limit: request.limit ?? 20,
        skip: request.skip ?? 0,
      }
    );

    if (payload.code === 10 && fallBack) {
      await this.login();
      return this.readPaiPuList(request, false);
    }

    return payload;
  }

  async getAllTournamentLogs(
    tournamentId: number,
    internalTournamentId?: string | number,
    skip = 0,
    fallBack = true
  ): Promise<GameData[]> {
    const classifyID =
      internalTournamentId ??
      (await this.resolveInternalTournamentId(tournamentId, fallBack));

    const PAGE_SIZE = 20;
    const logs: GameData[] = [];
    let currentSkip = skip;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const payload = await this.readPaiPuList(
        {
          classifyID,
          skip: currentSkip,
          limit: PAGE_SIZE,
        },
        fallBack
      );

      const page = payload.data ?? [];
      const relevantLogIds = page
        .filter(
          (entry: LogListData) =>
            entry.isClear === false && entry.isMiddlePause !== true
        )
        .map((entry: LogListData) => entry.paiPuId);

      for (const logId of relevantLogIds) {
        logs.push(await this.getLog(logId));
      }

      if (page.length < PAGE_SIZE) {
        break;
      }
      currentSkip += PAGE_SIZE;
    }

    return logs;
  }

  async getAllTournamentGamesWithMeta(
    tournamentId: number,
    internalTournamentId?: string | number,
    skip = 0,
    fallBack = true
  ): Promise<Array<{ meta: LogListData; game: GameData }>> {
    const classifyID =
      internalTournamentId ??
      (await this.resolveInternalTournamentId(tournamentId, fallBack));

    const PAGE_SIZE = 20;
    const result: Array<{ meta: LogListData; game: GameData }> = [];
    let currentSkip = skip;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const payload = await this.readPaiPuList(
        {
          classifyID,
          skip: currentSkip,
          limit: PAGE_SIZE,
        },
        fallBack
      );

      const page = payload.data ?? [];
      const relevantLogs = page.filter(
        (entry: LogListData) =>
          entry.isClear === false && entry.isMiddlePause !== true
      );

      for (const meta of relevantLogs) {
        const game = await this.getLog(meta.paiPuId);
        result.push({ meta, game });
      }

      if (page.length < PAGE_SIZE) {
        break;
      }
      currentSkip += PAGE_SIZE;
    }

    return result;
  }

  async addSelfTeamConfig(
    tournamentId: number,
    teamList: Array<{
      name: string;
      userList: Array<{ userID: number; identity: number; nickname: string }>;
    }>,
    fallBack = true
  ): Promise<void> {
    await this.ensureAuthenticated();

    const payload = await this.postAuthed<RiichiCityApiResponse>(
      "/lobbys/addSelfTeamConfig",
      {
        matchID: tournamentId,
        teamList,
      }
    );

    if (payload.code === 10 && fallBack) {
      await this.login();
      return this.addSelfTeamConfig(tournamentId, teamList, false);
    }

    if (payload.code !== 0) {
      throw new Error(
        `RiichiCity addSelfTeamConfig failed (code ${payload.code}): ${payload.message}`
      );
    }
  }

  async manageSelfUsers(
    tournamentId: number,
    userIds: number[],
    options: { isAdd?: boolean; isReset?: boolean; userType?: number } = {},
    fallBack = true
  ): Promise<void> {
    await this.ensureAuthenticated();

    const payload = await this.postAuthed<RiichiCityApiResponse>(
      "/lobbys/manageSelfUser",
      {
        matchID: tournamentId,
        isAdd: options.isAdd ?? true,
        isReset: options.isReset ?? false,
        userType: options.userType ?? 1,
        usersID: userIds,
      }
    );

    if (payload.code === 10 && fallBack) {
      await this.login();
      return this.manageSelfUsers(tournamentId, userIds, options, false);
    }

    if (payload.code !== 0) {
      throw new Error(
        `RiichiCity manageSelfUser failed (code ${payload.code}): ${payload.message}`
      );
    }
  }

  async resetSelfTeamConfig(
    tournamentId: number,
    fallBack = true
  ): Promise<void> {
    await this.ensureAuthenticated();

    const payload = await this.postAuthed<RiichiCityApiResponse>(
      "/lobbys/addSelfTeamConfig",
      {
        matchID: tournamentId,
      }
    );

    if (payload.code === 10 && fallBack) {
      await this.login();
      return this.resetSelfTeamConfig(tournamentId, false);
    }

    if (payload.code !== 0) {
      throw new Error(
        `RiichiCity resetSelfTeamConfig failed (code ${payload.code}): ${payload.message}`
      );
    }
  }

  async readSelfTeamConfig(
    tournamentId: number,
    fallBack = true
  ): Promise<
    Array<{
      name: string;
      userList: Array<{ userID: number; identity: number; nickname: string }>;
    }>
  > {
    await this.ensureAuthenticated();

    const payload = await this.postAuthed<
      RiichiCityApiResponse<{
        teamList: Array<{
          name: string;
          userList: Array<{
            userID: number;
            identity: number;
            nickname: string;
          }>;
        }>;
      }>
    >("/lobbys/readSelfTeamConfig", {
      matchID: tournamentId,
    });

    if (payload.code === 10 && fallBack) {
      await this.login();
      return this.readSelfTeamConfig(tournamentId, false);
    }

    if (payload.code !== 0) {
      throw new Error(
        `RiichiCity readSelfTeamConfig failed (code ${payload.code}): ${payload.message}`
      );
    }

    return payload.data.teamList ?? [];
  }

  async readOnlineRoom(
    classifyID: string,
    fallBack = true
  ): Promise<OnlineRoomResponse> {
    const payload = await this.postAuthed<OnlineRoomResponse>(
      "/record/readOnlineRoom",
      { classifyID }
    );

    if (payload.code === 10 && fallBack) {
      await this.login();
      return this.readOnlineRoom(classifyID, false);
    }

    return payload;
  }

  async controlSelfRoom(
    matchID: number,
    roomID: string,
    type: RiichiCityRoomStatus,
    fallBack = true
  ): Promise<RiichiCityApiResponse> {
    const payload = await this.postAuthed<RiichiCityApiResponse>(
      "/lobbys/controlSelfRoom",
      {
        matchID,
        roomID,
        type,
      }
    );

    if (payload.code === 10 && fallBack) {
      await this.login();
      return this.controlSelfRoom(matchID, roomID, type, false);
    }

    return payload;
  }
}
