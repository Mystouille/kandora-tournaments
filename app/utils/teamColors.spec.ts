import mongoose from "mongoose";
import { describe, expect, it } from "vitest";
import { TeamModel } from "../core/models/tournament/Team";
import {
  buildTeamColorLookup,
  DEFAULT_TEAM_COLORS,
  getDefaultTeamColor,
  getImportedTeamColor,
  isTeamColor,
  resolveRosterTeamColor,
  snapshotTeamColors,
  teamColorForeground,
  teamColorGradient,
  teamColorLabelStyle,
} from "./teamColors";

describe("team colors", () => {
  it("reuses category10 and cycles after ten new teams", () => {
    expect(DEFAULT_TEAM_COLORS).toEqual([
      "#1f77b4",
      "#ff7f0e",
      "#2ca02c",
      "#d62728",
      "#9467bd",
      "#8c564b",
      "#e377c2",
      "#7f7f7f",
      "#bcbd22",
      "#17becf",
    ]);
    expect(getDefaultTeamColor(10)).toBe(getDefaultTeamColor(0));
  });

  it.each(["#abcdef", "#ABCDEF", "#000000", "#ffffff"])(
    "accepts opaque six-digit hex %s",
    (color) => {
      expect(isTeamColor(color)).toBe(true);
    }
  );

  it.each(["", "red", "#abc", "#abcdef80", "abcdef", 123, {}, null])(
    "rejects non-hex color %j",
    (color) => {
      expect(isTeamColor(color)).toBe(false);
    }
  );

  it("distinguishes omitted, cleared, existing, and new colors", () => {
    expect(resolveRosterTeamColor(undefined, {}, 1)).toBeNull();
    expect(resolveRosterTeamColor(undefined, { color: null }, 1)).toBeNull();
    expect(resolveRosterTeamColor(undefined, { color: "#abcdef" }, 1)).toBe(
      "#abcdef"
    );
    expect(resolveRosterTeamColor(null, { color: "#abcdef" }, 1)).toBeNull();
    expect(resolveRosterTeamColor("#ABCDEF", undefined, 1)).toBe("#abcdef");
    expect(resolveRosterTeamColor(undefined, undefined, 1)).toBe("#ff7f0e");
    expect(resolveRosterTeamColor(null, undefined, 1)).toBeNull();
  });

  it("uses the full stable roster for graphs without coloring legacy teams", () => {
    const teams = [
      {
        _id: "03",
        leagueId: "a",
        color: "#123456",
        roster: { members: ["p3"], substitutes: ["sub"] },
      },
      {
        _id: "01",
        leagueId: "a",
        roster: { members: ["p1"], substitutes: [] },
      },
      {
        _id: "02",
        leagueId: "a",
        color: null,
        roster: { members: ["p2"], substitutes: [] },
      },
      { _id: "04", leagueId: "b", roster: { members: [], substitutes: [] } },
    ];
    const colors = buildTeamColorLookup(teams);
    expect(colors.byTeamId.get("01")).toBeNull();
    expect(colors.byPlayerId.get("p1")).toBeNull();
    expect(colors.byTeamId.get("02")).toBeNull();
    expect(colors.byPlayerId.get("sub")).toBe("#123456");
    expect(colors.byPlayerId.has("unassigned")).toBe(false);
    expect(colors.graphs.get("01")).toBe("#1f77b4");
    expect(colors.graphs.get("02")).toBe("#ff7f0e");
    expect(colors.graphs.get("03")).toBe("#123456");
    expect(colors.graphs.get("04")).toBe("#1f77b4");
    expect(buildTeamColorLookup([...teams].reverse()).graphs).toEqual(
      colors.graphs
    );
    expect(teams[0]._id).toBe("03");
  });

  it("preserves configured and uncolored imported teams by name, not index", () => {
    const saved = snapshotTeamColors([
      { simpleName: "Configured", color: "#123456" },
      { simpleName: "Cleared", color: null },
      { simpleName: "Legacy" },
    ]);
    expect(getImportedTeamColor(saved, "Configured", 7)).toBe("#123456");
    expect(getImportedTeamColor(saved, "Cleared", 0)).toBeNull();
    expect(getImportedTeamColor(saved, "Legacy", 1)).toBeNull();
    expect(getImportedTeamColor(saved, "New", 2)).toBe("#2ca02c");
  });

  it("fades the same RGB color from alpha 1 to 0 without coloring empty values", () => {
    expect(teamColorGradient("#123456")).toBe(
      "linear-gradient(to right, #123456ff 0%, #12345600 100%)"
    );
    expect(teamColorGradient(null)).toBeUndefined();
    expect(teamColorGradient(undefined)).toBeUndefined();
  });

  it("chooses contrasting foregrounds for solid headers", () => {
    expect(teamColorForeground("#000000")).toBe("#ffffff");
    expect(teamColorForeground("#ffffff")).toBe("#000000");
    expect(teamColorForeground("#ff0000")).toBe("#000000");
    expect(teamColorForeground(null)).toBeUndefined();
  });

  it("keeps labels readable across the fade without restyling uncolored teams", () => {
    expect(teamColorLabelStyle("#ffffff")).toEqual({
      color: "#000000",
      textShadow: "0 0 2px #ffffff, 0 0 2px #ffffff",
    });
    expect(teamColorLabelStyle("#000000")).toEqual({
      color: "#ffffff",
      textShadow: "0 0 2px #000000, 0 0 2px #000000",
    });
    expect(teamColorLabelStyle(null)).toEqual({});
  });
});

describe("Team color schema", () => {
  function team(color?: string | null) {
    return new TeamModel({
      simpleName: "Test",
      displayName: "Test",
      leagueId: new mongoose.Types.ObjectId(),
      roster: {
        captain: new mongoose.Types.ObjectId(),
        members: [],
        substitutes: [],
      },
      ...(color !== undefined ? { color } : {}),
    });
  }

  it("retains configured and cleared colors in real Mongoose serialization", async () => {
    expect(team("#ABCDEF").toObject().color).toBe("#abcdef");
    expect(team(null).toObject().color).toBeNull();
    expect(team().toObject().color ?? null).toBeNull();
    await expect(team().validate()).resolves.toBeUndefined();
    await expect(team(null).validate()).resolves.toBeUndefined();
  });

  it("rejects malformed configured colors", async () => {
    await expect(team("red").validate()).rejects.toHaveProperty("errors.color");
  });
});
