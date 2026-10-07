import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTournamentGameRules } from "~/services/tournamentRules";
import {
  TenhouService,
  type TenhouTournamentConfig,
} from "./TenhouService.server";
import { ruleSetToTenhouConfig } from "./ruleSetToTenhouConfig";

const lobbyId = "C1000000000000000";
const secondLobbyId = "C2000000000000000";
const config: TenhouTournamentConfig = {
  TITLE: "Test + tournament",
  RULE: "202610010000,202611012359,0149,2,10,1500,2200",
  CSRULE:
    "40000000,00000000,,,25000,30000,30000,,,,1000,100,,,,,1000,1500,3000,,,10,-10,-20,10,-10,-20,10,-10,-20,10,-10,-20,10,-10,-20,6,16,5,7,17,6,8,18,7",
  RANKING: "12",
  MEMBER: "Benoit,TNTPom",
  CHATMEMBER: "Commentator One,Commentator Two",
  ENABLEJOINSAMEIP: 0,
  EDITAUTH: "fresh-test-token",
  JOINFEE: "500",
  DUPLICATABLESEED: "test-seed",
  PREMIUMONLY: 1,
  CHATPREMIUMONLY: 1,
  DISABLEGUESTMATCH: 1,
  DISABLEGUESTID: 1,
  DISABLEENDANNOUNCE: 1,
};

function loadResponse(value: TenhouTournamentConfig): Response {
  return new Response(
    `cs(${JSON.stringify(
      Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [
          key,
          typeof entry === "string" ? encodeURIComponent(entry) : entry,
        ])
      )
    )});`
  );
}

const fetchMock = vi.fn<typeof fetch>();
const rules = getTournamentGameRules("jpml-hanchan");

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Tenhou configuration transport", () => {
  it("decodes and retains all editable configuration fields", async () => {
    fetchMock.mockResolvedValue(loadResponse(config));
    expect(await TenhouService.instance.fetchTournamentConfig(lobbyId)).toEqual(
      config
    );
  });

  it.each([
    "cs({});",
    "cs(null);",
    `cs(${JSON.stringify({ ...config, EDITAUTH: "" })});`,
    `cs(${JSON.stringify({ ...config, TITLE: "%broken" })});`,
  ])("rejects invalid or unauthenticated load responses", async (body) => {
    fetchMock.mockResolvedValue(new Response(body));
    await expect(
      TenhouService.instance.fetchTournamentConfig(lobbyId)
    ).rejects.toThrow();
  });

  it("updates members without clearing custom rules or other lobby settings", async () => {
    fetchMock.mockResolvedValue(new Response("OK"));
    await TenhouService.instance.updateTournamentMembers(lobbyId, config, [
      "Benoit",
      "TNTPom",
      "New Player",
    ]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://tenhou.net/cs/edit/cmd_update.cgi");
    expect(init?.method).toBe("POST");
    const body = new URLSearchParams(String(init?.body));
    expect(Object.fromEntries(body)).toEqual({
      L: lobbyId,
      EDITAUTH: config.EDITAUTH,
      T: config.TITLE,
      R0: "20261001",
      R0T: "0000",
      R1: "20261101",
      R1T: "2359",
      R2: "0149",
      DAN0: "2",
      DAN1: "10",
      RATE0: "1500",
      RATE1: "2200",
      CSRULE: config.CSRULE,
      JOINFEE: "500",
      RANKING: "12",
      M: "Benoit\nTNTPom\nNew Player",
      CM: "Commentator One\nCommentator Two",
      PW: "",
      DUPLICATABLESEED: "test-seed",
      PREMIUMONLY: "1",
      CHATPREMIUMONLY: "1",
      ENABLEJOINSAMEIP: "0",
      DISABLEGUESTMATCH: "1",
      DISABLEGUESTID: "1",
      DISABLEENDANNOUNCE: "1",
    });
  });

  it.each([
    new Response("INVALID EDITAUTH", { status: 200 }),
    new Response("ERROR", { status: 503 }),
  ])("does not report unsuccessful updates as successful", async (response) => {
    fetchMock.mockResolvedValue(response);
    await expect(
      TenhouService.instance.updateTournamentMembers(lobbyId, config, [])
    ).rejects.toThrow();
  });

  it("loads fresh authentication, applies rules, then verifies readback", async () => {
    const converted = ruleSetToTenhouConfig(rules, config);
    const ruleParts = config.RULE.split(",");
    ruleParts[2] = converted.R2;
    fetchMock
      .mockResolvedValueOnce(loadResponse(config))
      .mockResolvedValueOnce(new Response("OK"))
      .mockResolvedValueOnce(
        loadResponse({
          ...config,
          RULE: ruleParts.join(","),
          CSRULE: converted.CSRULE,
          EDITAUTH: "rotated-test-token",
        })
      );
    await TenhouService.instance.configureTournamentLobbies(
      [lobbyId, lobbyId],
      rules
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const update = new URLSearchParams(
      String(fetchMock.mock.calls[1][1]?.body)
    );
    expect(update.get("EDITAUTH")).toBe("fresh-test-token");
    expect(update.get("R2")).toBe(converted.R2);
    expect(update.get("CSRULE")).toBe(converted.CSRULE);
    expect(update.get("M")).toBe("Benoit\nTNTPom");
    expect(update.get("CM")).toBe("Commentator One\nCommentator Two");
  });

  it("fails if Tenhou acknowledged but silently normalized away the rules", async () => {
    fetchMock
      .mockResolvedValueOnce(loadResponse(config))
      .mockResolvedValueOnce(new Response("OK"))
      .mockResolvedValueOnce(loadResponse(config));
    await expect(
      TenhouService.instance.configureTournamentLobbies([lobbyId], rules)
    ).rejects.toThrow("did not retain");
  });

  it("checks that the allowed users survived the rules update", async () => {
    const converted = ruleSetToTenhouConfig(rules, config);
    const parts = config.RULE.split(",");
    parts[2] = converted.R2;
    fetchMock
      .mockResolvedValueOnce(loadResponse(config))
      .mockResolvedValueOnce(new Response("OK"))
      .mockResolvedValueOnce(
        loadResponse({
          ...config,
          RULE: parts.join(","),
          CSRULE: converted.CSRULE,
          MEMBER: "",
        })
      );
    await expect(
      TenhouService.instance.configureTournamentLobbies([lobbyId], rules)
    ).rejects.toThrow("MEMBER");
  });

  it("checks every lobby before sending any update", async () => {
    fetchMock
      .mockResolvedValueOnce(loadResponse(config))
      .mockResolvedValueOnce(new Response("cs({});"));
    await expect(
      TenhouService.instance.configureTournamentLobbies(
        [lobbyId, secondLobbyId],
        rules
      )
    ).rejects.toThrow();
    expect(
      fetchMock.mock.calls.every(([, init]) => init?.method !== "POST")
    ).toBe(true);
  });

  it("reports partial remote progress instead of hiding a later lobby failure", async () => {
    const converted = ruleSetToTenhouConfig(rules, config);
    fetchMock
      .mockResolvedValueOnce(loadResponse(config))
      .mockResolvedValueOnce(loadResponse(config))
      .mockResolvedValueOnce(new Response("OK"))
      .mockResolvedValueOnce(
        loadResponse({
          ...config,
          RULE: config.RULE.replace("0149", converted.R2),
          CSRULE: converted.CSRULE,
        })
      )
      .mockResolvedValueOnce(new Response("ERROR"));
    await expect(
      TenhouService.instance.configureTournamentLobbies(
        [lobbyId, secondLobbyId],
        rules
      )
    ).rejects.toThrow("after 1 of 2 lobby updates");
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("does not mistake the password-protection marker for an actual password", async () => {
    fetchMock.mockResolvedValue(loadResponse({ ...config, PW: 1 }));
    await expect(
      TenhouService.instance.configureTournamentLobbies([lobbyId], rules)
    ).rejects.toThrow("Password-protected");
    expect(
      fetchMock.mock.calls.every(([, init]) => init?.method !== "POST")
    ).toBe(true);
    await expect(
      TenhouService.instance.updateTournamentMembers(
        lobbyId,
        { ...config, PW: 1 },
        []
      )
    ).rejects.toThrow("Password-protected");
  });

  it("rejects missing or public lobby IDs before network access", async () => {
    for (const ids of [[], ["12345"]]) {
      await expect(
        TenhouService.instance.configureTournamentLobbies(ids, rules)
      ).rejects.toThrow("lobby");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("starts scheduled games with the configured rule code, not hardcoded 0001", async () => {
    fetchMock
      .mockResolvedValueOnce(loadResponse(config))
      .mockResolvedValueOnce(new Response("OK"));
    await TenhouService.instance.startLobbyGame(lobbyId, ["A", "B", "C", "D"]);
    const body = new URLSearchParams(String(fetchMock.mock.calls[1][1]?.body));
    expect(body.get("R2")).toBe("0149");
  });

  it("retains explicit rule-code overrides for callers that provide one", async () => {
    fetchMock.mockResolvedValue(new Response("OK"));
    await TenhouService.instance.startLobbyGame(
      lobbyId,
      ["A", "B", "C", "D"],
      "000b"
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      new URLSearchParams(String(fetchMock.mock.calls[0][1]?.body)).get("R2")
    ).toBe("000b");
  });
});
