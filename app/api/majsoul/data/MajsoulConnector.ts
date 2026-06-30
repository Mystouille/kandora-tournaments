// @ts-nocheck -- Vendored MahjongSoul client (liqi protobuf version drift); excluded from typecheck by intent.
import UserAgent from "user-agents";

import type { Subscription } from "rxjs";

import { getPassport } from "./passport";
import { MajsoulApi } from "./MajsoulApi";
import type { Passport } from "./types/Passport";
import { MajsoulConfigModel } from "../../../db/MajsoulConfig";
import { config } from "../../../../config";
import type { Cookie } from "../types/Cookie";
import type { RecordGame } from "./types/RecordGame";
import type { GameRecord } from "./types/GameRecord";
import type { ILeagueDataConnector } from "../../types/ILeagueDataConnector";
import type { ContestGamesRequest } from "../../types/ILeagueDataConnector";
import { MajsoulContestApi } from "./MajsoulContestApi";

export class MahjongSoulConnector implements ILeagueDataConnector<
  RecordGame,
  GameRecord
> {
  private static readonly GLOBAL_KEY = "__MahjongSoulConnector__";

  private api: MajsoulApi | undefined;
  private _contestApi: MajsoulContestApi | undefined;
  private reconnecting = false;
  private errorSub: Subscription | undefined;
  private constructor() {}

  static get instance(): MahjongSoulConnector {
    if (!(globalThis as any)[MahjongSoulConnector.GLOBAL_KEY]) {
      (globalThis as any)[MahjongSoulConnector.GLOBAL_KEY] =
        new MahjongSoulConnector();
    }
    return (globalThis as any)[MahjongSoulConnector.GLOBAL_KEY];
  }

  public get contestApi(): MajsoulContestApi {
    if (!this._contestApi) {
      throw new Error("Contest API not initialized. Call init() first.");
    }
    return this._contestApi;
  }

  public get isInitialized(): boolean {
    return !!this._contestApi;
  }

  private scheduleReconnect() {
    if (this.reconnecting) {
      return;
    }
    this.reconnecting = true;
    this.cleanup();
    const delay = 5_000;
    console.info(`[Majsoul] Will attempt to reconnect in ${delay / 1000}s...`);
    setTimeout(async () => {
      try {
        console.info("[Majsoul] Reconnecting...");
        await this.init();
        console.info("[Readiness] Majsoul reconnected successfully");
      } catch (err) {
        console.error("[Majsoul] Reconnection failed:", err);
      } finally {
        this.reconnecting = false;
      }
    }, delay);
  }

  /** Tear down the current API and error subscription to stop heartbeat spam */
  private cleanup() {
    this.errorSub?.unsubscribe();
    this.errorSub = undefined;
    this.api?.dispose();
    this.api = undefined;
    this._contestApi = undefined;
  }

  public async init() {
    // Clean up any previous connection before re-initialising
    this.cleanup();

    const userAgent = await getOrGenerateUserAgent();
    const [apiConfig] = await MajsoulConfigModel.find().exec();

    if (!apiConfig) {
      throw new Error("MajsoulConfig document is missing");
    }

    const expireDeadline = Date.now() + 60 * 1000;
    const existingCookies = (apiConfig.loginCookies ?? []).filter(
      (cookie) => !cookie.expires || cookie.expires > expireDeadline
    );
    const { passport: dynamicPassport, loginCookies } =
      (await getPassport({
        userId: config.MAJSOUL_UID,
        accessToken: config.MAJSOUL_TOKEN,
        userAgent,
        existingCookies: (existingCookies as Cookie[]) || [],
      })) ?? {};

    await MajsoulConfigModel.updateOne(
      {
        _id: apiConfig._id,
      },
      {
        $set: {
          loginCookies,
        },
      }
    );

    if (dynamicPassport?.accessToken) {
      await MajsoulConfigModel.updateOne(
        {
          _id: apiConfig._id,
        },
        {
          $set: {
            passportToken: dynamicPassport.accessToken,
          },
        }
      );
    }

    const tokenCandidates = [
      dynamicPassport?.accessToken,
      apiConfig.passportToken,
    ]
      .filter((token): token is string => !!token)
      .filter((token, index, self) => self.indexOf(token) === index);

    console.log(
      `[Majsoul] Token candidates: ${tokenCandidates.length} (dynamic: ${!!dynamicPassport?.accessToken}, saved: ${!!apiConfig.passportToken})`
    );

    if (tokenCandidates.length === 0) {
      throw new Error("Failed to acquire Majsoul passport token");
    }

    let loginSucceeded = false;
    let lastLoginError: unknown = null;

    for (const [i, token] of tokenCandidates.entries()) {
      try {
        const label =
          i === 0 ? "dynamic passport token" : "saved DB passport token";
        console.log(
          `[Majsoul] Trying login with ${label} (${token.slice(0, 8)}...)`
        );

        const passport: Passport = {
          accessToken: token,
          uid: config.MAJSOUL_UID,
        };

        const apiResources = await MajsoulApi.retrieveApiResources();
        this.api = new MajsoulApi(apiResources!);
        this.api.notifications.subscribe((n: any) => console.log(n));
        await this.api.init();
        await this.api.logIn(passport);
        loginSucceeded = true;
        break;
      } catch (error) {
        lastLoginError = error;
        // Close the websocket connection to avoid zombie connections
        this.api?.dispose();
        this.api = undefined;
        console.warn(
          `[Majsoul] Login attempt ${i + 1}/${tokenCandidates.length} failed:`,
          error instanceof Error ? error.message : error
        );
      }
    }

    if (!loginSucceeded) {
      throw new Error(
        `Failed to log in to Majsoul with available tokens: ${String(lastLoginError)}`
      );
    }

    if (!this.api) {
      throw new Error("Majsoul API was not initialized after successful login");
    }

    this.errorSub = this.api.errors$.subscribe((error: any) => {
      console.warn(
        "[Majsoul] Connection error detected:",
        error?.code ?? error
      );
      this.scheduleReconnect();
    });

    const passportToken =
      dynamicPassport?.accessToken ?? apiConfig.passportToken;
    if (passportToken) {
      this._contestApi = new MajsoulContestApi();
      try {
        await this._contestApi.init(passportToken);
      } catch (error) {
        console.warn(
          "[Majsoul] Contest gate REST login failed (will retry on first use):",
          error instanceof Error ? error.message : error
        );
      }
    } else {
      console.warn(
        "No passport token available — skipping contest gate REST auth."
      );
    }
  }

  public async ensureInitialized(): Promise<void> {
    if (!this.api) {
      console.info("[Majsoul] API not initialized, attempting re-init...");
      await this.init();
    }
  }

  public async getUserInfoFromFriendId(id: string) {
    await this.ensureInitialized();
    const majsoulId = await this.api?.getAccountIdFromFriendId(id);
    if (majsoulId === undefined) {
      return { nickname: undefined, accountId: undefined };
    }
    const accountInfo = await this.api?.fetchAccountInfo(majsoulId);
    return { nickname: accountInfo?.account?.nickname, accountId: majsoulId };
  }

  public async getUserNicknameFromAccountId(
    id: string
  ): Promise<string | undefined> {
    const accountInfo = await this.api?.fetchAccountInfo(parseInt(id));
    return accountInfo?.account?.nickname;
  }

  public async getAllContestGameRecords({
    contestId,
    seasonId,
    endTime,
    knownGameIds,
    stopWhenKnownGameFound,
  }: ContestGamesRequest): Promise<RecordGame[]> {
    if (!this.api) {
      throw new Error("API not initialized. Call init() first.");
    }
    return this.api.getAllContestGameRecords(contestId, {
      seasonId,
      endTime,
      knownGameIds,
      stopWhenKnownGameFound,
    });
  }

  public async getContestGameRecord(gameId: string): Promise<GameRecord> {
    if (!this.api) {
      throw new Error("API not initialized. Call init() first.");
    }
    return this.api.getGame(gameId);
  }

  public async findContestByFriendlyId(friendlyId: number) {
    if (!this.api) {
      throw new Error("API not initialized. Call init() first.");
    }
    return this.api.findContestByContestId(friendlyId);
  }

  public async fetchOnlinePlayerCount(
    uniqueId: number
  ): Promise<number | undefined> {
    if (!this.api) {
      return undefined;
    }
    try {
      const resp = await this.api.lobbyService.rpcCall(
        "fetchCustomizedContestOnlineInfo",
        { unique_id: uniqueId }
      );
      return (resp as { online_player?: number }).online_player;
    } catch {
      return undefined;
    }
  }
}

export async function getOrGenerateUserAgent(): Promise<string> {
  let [apiConfig] = await MajsoulConfigModel.find().exec();
  if (!apiConfig?.userAgent) {
    if (!apiConfig) {
      apiConfig = await MajsoulConfigModel.create({});
    }
    apiConfig.userAgent = new UserAgent({
      platform: process.platform === "win32" ? "Win32" : "Linux x86_64",
    }).toString();

    await MajsoulConfigModel.updateOne(
      {
        _id: apiConfig._id,
      },
      {
        $set: {
          userAgent: apiConfig.userAgent,
        },
      }
    );
  }
  return apiConfig.userAgent;
}
