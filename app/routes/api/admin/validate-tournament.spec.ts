import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TenhouService } from "~/api/tenhou/TenhouService.server";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  findUser: vi.fn(),
}));

vi.mock("../../../utils/dbConnection.server", () => ({
  connectToDatabase: vi.fn(),
}));
vi.mock("../../../utils/jwt.server", () => ({
  getAuthenticatedUser: mocks.authenticate,
}));
vi.mock("../../../core/models/shared/User", () => ({
  UserModel: { findById: mocks.findUser },
}));
vi.mock(
  "../../../services/connectors/RiichiCityLeagueConnector.server",
  () => ({
    RiichiCityLeagueConnector: { instance: {} },
  })
);
vi.mock("~/api/majsoul/data/MajsoulConnector", () => ({
  MahjongSoulConnector: { instance: { isInitialized: false } },
}));

import { loader } from "./validate-tournament";

const config = {
  TITLE: "Tenhou test",
  RULE: "202610010000,202611012359,0009,0,0,0,0",
  MEMBER: "",
  CHATMEMBER: "",
  RANKING: "",
  ENABLEJOINSAMEIP: 1,
  EDITAUTH: "test-token",
};

function request(id: string) {
  return new Request(
    `http://localhost/api/admin/validate-tournament?platform=TENHOU&tournamentId=${id}`
  );
}

beforeEach(() => {
  mocks.authenticate.mockResolvedValue({ sub: "admin-id" });
  mocks.findUser.mockReturnValue({
    select: async () => ({ isAdmin: true }),
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Tenhou tournament validation", () => {
  it("resolves an editable lobby and its title", async () => {
    const fetchConfig = vi
      .spyOn(TenhouService.instance, "fetchTournamentConfig")
      .mockResolvedValue(config);
    const response = await loader({ request: request("C1000000000000000") });
    expect(fetchConfig).toHaveBeenCalledWith("C1000000000000000");
    await expect(response.json()).resolves.toEqual({
      valid: true,
      internalTournamentId: "C1000000000000000",
      tournamentName: "Tenhou test",
    });
  });

  it("rejects public lobby numbers without sending a request", async () => {
    const fetchConfig = vi.spyOn(
      TenhouService.instance,
      "fetchTournamentConfig"
    );
    const response = await loader({ request: request("12345") });
    expect((await response.json()).valid).toBe(false);
    expect(fetchConfig).not.toHaveBeenCalled();
  });

  it("does not accept inaccessible administration as a missing optional title", async () => {
    vi.spyOn(TenhouService.instance, "fetchTournamentConfig").mockRejectedValue(
      new Error("Invalid configuration")
    );
    const response = await loader({ request: request("C1000000000000000") });
    expect((await response.json()).valid).toBe(false);
  });

  it("rejects password-protected administration explicitly", async () => {
    vi.spyOn(TenhouService.instance, "fetchTournamentConfig").mockResolvedValue(
      {
        ...config,
        PW: 1,
      }
    );
    const response = await loader({ request: request("C1000000000000000") });
    expect((await response.json()).valid).toBe(false);
  });
});
