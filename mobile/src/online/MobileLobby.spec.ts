import * as React from "react";
import {
  Children,
  isValidElement,
  type ComponentProps,
  type Dispatch,
  type ReactElement,
  type ReactNode,
  type SetStateAction,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GameSetupControls } from "~/game/components/GameSetupControls";
import {
  MobileLobby,
  MobileLobbyResponseSchema,
  roomAction,
  roomOccupancy,
  type MobileLobbyPreset,
  type MobileLobbyRoom,
} from "./MobileLobby";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof React>();
  return {
    ...actual,
    useState: vi.fn(actual.useState),
    useEffect: vi.fn(actual.useEffect),
    useCallback: vi.fn(actual.useCallback),
  };
});

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

const serverPresets: MobileLobbyPreset[] = [
  {
    id: "mcr-ema",
    rulesFamily: "mcr",
    displayName: "MCR (EMA Green Book)",
  },
  { id: "ema", rulesFamily: "riichi", displayName: "EMA" },
  {
    id: "m-league",
    rulesFamily: "riichi",
    displayName: "M-League",
    description: "M-League table rules",
  },
];

function props(): ComponentProps<typeof MobileLobby> {
  return {
    webAppBaseUrl: "https://example.test",
    onBack: vi.fn(),
    onCreateGame: vi.fn(),
    onJoinGame: vi.fn(),
    onReconnectGame: vi.fn(),
    onWatchGame: vi.fn(),
    onWatchTenhouGame: vi.fn(),
    activeMatchId: null,
  };
}

function renderLobby(config: ComponentProps<typeof MobileLobby>) {
  const states: unknown[] = [];
  let cursor = 0;
  vi.mocked(React.useState).mockImplementation(function useTestState<T>(
    initial: T | (() => T)
  ): [T, Dispatch<SetStateAction<T>>] {
    const index = cursor++;
    if (index === states.length) {
      states.push(
        typeof initial === "function" ? (initial as () => T)() : initial
      );
    }
    return [
      states[index] as T,
      (next) => {
        states[index] =
          typeof next === "function"
            ? (next as (previous: T) => T)(states[index] as T)
            : next;
      },
    ];
  } as typeof React.useState);
  vi.mocked(React.useEffect).mockImplementation(() => undefined);
  let refresh: () => Promise<void>;
  vi.mocked(React.useCallback).mockImplementation((callback) => {
    refresh = callback as () => Promise<void>;
    return callback;
  });
  return {
    render: () => {
      cursor = 0;
      return MobileLobby(config);
    },
    refresh: () => refresh(),
  };
}

function elements(node: ReactNode): ReactElement[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<{ children?: ReactNode }>(child)) {
      return [];
    }
    return [child, ...elements(child.props.children)];
  });
}

function setupControls(tree: ReactNode) {
  const controls = elements(tree).find(
    (element) => element.type === GameSetupControls
  );
  if (controls === undefined) {
    throw new Error("Game setup controls not found");
  }
  return controls.props as ComponentProps<typeof GameSetupControls>;
}

function button(tree: ReactNode, label: string) {
  const control = elements(tree).find(
    (element) =>
      element.type === "button" &&
      renderToStaticMarkup(element).includes(`>${label}<`)
  );
  if (control === undefined) {
    throw new Error(`Button not found: ${label}`);
  }
  return control.props as { onClick: () => void; disabled?: boolean };
}

async function loadLobby(
  config = props(),
  presets = serverPresets,
  rooms: MobileLobbyRoom[] = []
) {
  const fetchLobby = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => Response.json({ presets, rooms }));
  vi.stubGlobal("fetch", fetchLobby);
  const lobby = renderLobby(config);
  lobby.render();
  await lobby.refresh();
  return { ...lobby, config, fetchLobby };
}

function room(status: MobileLobbyRoom["status"]): MobileLobbyRoom {
  return {
    matchId: "room-1",
    status,
    presetId: "m-league",
    buuMode: false,
    seats: [
      { name: "Alice", isBot: false },
      null,
      { name: "South", isBot: true },
      null,
    ],
  };
}

describe("mobile online lobby setup", () => {
  it("renders one hierarchical setup and creates Riichi/Yonma/M-League by default", async () => {
    const lobby = await loadLobby();
    button(lobby.render(), "Create a game").onClick();
    const tree = lobby.render();
    const controls = setupControls(tree);
    expect(controls.presets).toEqual(serverPresets);
    expect(controls.preset).toBe("m-league");
    expect(controls.value).toMatchObject({
      rulesFamily: "riichi",
      playerCount: 4,
    });
    expect(controls.mobile).toBe(true);
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('value="m-league" selected=""');
    expect(html).toContain("M-League table rules");
    const sections = [
      'aria-label="Mahjong rules"',
      'aria-label="Players"',
      'aria-label="Game type"',
      "<legend>Duplicate</legend>",
    ].map((label) => html.indexOf(label));
    expect(sections.every((index) => index >= 0)).toBe(true);
    expect(sections).toEqual([...sections].sort((a, b) => a - b));
    expect(html.match(/aria-label="Game type"/g)).toHaveLength(1);
    expect(html.match(/<select\b/g)).toHaveLength(2);
    expect(html).not.toContain('name="mobile-rule-preset"');
    expect(html).not.toContain('aria-label="Rules"');
    expect(html).not.toContain('aria-label="Sanma game type"');
    button(tree, "Create game").onClick();
    expect(lobby.config.onCreateGame).toHaveBeenCalledWith({
      preset: "m-league",
      rulesFamily: "riichi",
      playerCount: 4,
      sanmaType: "online",
      mode: { type: "normal" },
      spectatorDelayMs: 0,
    });
  });

  it("preserves the chosen Riichi preset when the server refreshes its catalog", async () => {
    const lobby = await loadLobby();
    button(lobby.render(), "Create a game").onClick();
    setupControls(lobby.render()).onPresetChange("ema");
    const refreshed = serverPresets.map((preset) => ({
      ...preset,
      description: `Updated ${preset.displayName}`,
    }));
    lobby.fetchLobby.mockResolvedValueOnce(
      Response.json({ presets: refreshed, rooms: [] })
    );
    await lobby.refresh();
    const controls = setupControls(lobby.render());
    expect(controls.presets).toEqual(refreshed);
    expect(controls.preset).toBe("ema");
    expect(controls.value.rulesFamily).toBe("riichi");
    button(lobby.render(), "Create game").onClick();
    expect(lobby.config.onCreateGame).toHaveBeenCalledWith(
      expect.objectContaining({ preset: "ema", rulesFamily: "riichi" })
    );
  });

  it.each([
    {
      name: "M-League",
      presets: [serverPresets[0], serverPresets[2]],
      expected: "m-league",
    },
    {
      name: "another Riichi preset",
      presets: [
        serverPresets[0],
        { id: "jpml-hanchan", rulesFamily: "riichi", displayName: "JPML" },
      ],
      expected: "jpml-hanchan",
    },
    {
      name: "the current selection when only MCR is available",
      presets: [serverPresets[0]],
      expected: "ema",
    },
  ] satisfies {
    name: string;
    presets: MobileLobbyPreset[];
    expected: string;
  }[])(
    "uses $name instead of silently switching Riichi to an MCR preset on refresh",
    async ({ presets, expected }) => {
      const lobby = await loadLobby();
      button(lobby.render(), "Create a game").onClick();
      setupControls(lobby.render()).onPresetChange("ema");
      lobby.fetchLobby.mockResolvedValueOnce(
        Response.json({ presets, rooms: [] })
      );
      await lobby.refresh();
      const controls = setupControls(lobby.render());
      expect(controls.preset).toBe(expected);
      expect(controls.value.rulesFamily).toBe("riichi");
      expect(lobby.config.onCreateGame).not.toHaveBeenCalled();
    }
  );

  it.each([
    {
      rulesFamily: "riichi",
      playerCount: 3,
      sanmaType: "online",
      preset: "m-league",
    },
    {
      rulesFamily: "mcr",
      playerCount: 4,
      sanmaType: "online",
      preset: "mcr-ema",
    },
  ] as const)(
    "creates the shared $rulesFamily/$playerCount-player selection",
    async ({ preset, ...selection }) => {
      const lobby = await loadLobby();
      button(lobby.render(), "Create a game").onClick();
      const controls = setupControls(lobby.render());
      controls.onChange({ ...controls.value, ...selection });
      const html = renderToStaticMarkup(lobby.render());
      expect(html).not.toContain('aria-label="Game type"');
      expect(html).not.toContain('name="mobile-rule-preset"');
      if (selection.rulesFamily === "mcr") {
        expect(html).not.toContain('aria-label="Players"');
        expect(html).not.toContain('aria-label="Sanma game type"');
      } else {
        expect(html).toContain('aria-label="Sanma game type"');
      }
      button(lobby.render(), "Create game").onClick();
      expect(lobby.config.onCreateGame).toHaveBeenCalledWith(
        expect.objectContaining({ preset, ...selection })
      );
    }
  );

  it("retains the selection and error handling if the lobby refresh fails", async () => {
    const lobby = await loadLobby();
    button(lobby.render(), "Create a game").onClick();
    setupControls(lobby.render()).onPresetChange("ema");
    lobby.fetchLobby.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await lobby.refresh();
    expect(renderToStaticMarkup(lobby.render())).toContain(
      "Lobby unavailable (503)"
    );
    expect(setupControls(lobby.render()).preset).toBe("ema");
    await lobby.refresh();
    expect(renderToStaticMarkup(lobby.render())).not.toContain(
      "Lobby unavailable"
    );
    expect(setupControls(lobby.render()).preset).toBe("ema");
  });

  it("keeps the dialog open and reports invalid Duplicate setup without creating", async () => {
    const lobby = await loadLobby();
    button(lobby.render(), "Create a game").onClick();
    const controls = setupControls(lobby.render());
    controls.onChange({ ...controls.value, duplicateEnabled: true });
    button(lobby.render(), "Create game").onClick();
    expect(lobby.config.onCreateGame).not.toHaveBeenCalled();
    const html = renderToStaticMarkup(lobby.render());
    expect(html).toContain('role="dialog"');
    expect(html).toContain('class="rule-modal-scroll"');
    expect(html).toContain(
      "Enter a duplicate seed between 1 and 128 characters."
    );
  });

  it("disables an open setup and blocks creation when a match becomes active", async () => {
    const lobby = await loadLobby();
    button(lobby.render(), "Create a game").onClick();
    lobby.config.activeMatchId = "saved-match";
    const tree = lobby.render();
    expect(setupControls(tree).disabled).toBe(true);
    expect(button(tree, "Create game").disabled).toBe(true);
    button(tree, "Create game").onClick();
    expect(lobby.config.onCreateGame).not.toHaveBeenCalled();
  });

  it("reconnects the existing table by ID without applying the new-game default", async () => {
    const config = props();
    config.activeMatchId = "room-1";
    const savedRoom = { ...room("playing"), presetId: "tenhou-hanchan" };
    const lobby = await loadLobby(config, serverPresets, [savedRoom]);
    const tree = lobby.render();
    expect(button(tree, "Create a game").disabled).toBe(true);
    expect(elements(tree).some(({ type }) => type === GameSetupControls)).toBe(
      false
    );
    button(tree, "Reconnect").onClick();
    expect(config.onReconnectGame).toHaveBeenCalledWith("room-1");
    expect(config.onCreateGame).not.toHaveBeenCalled();
  });
});

describe("mobile online lobby room policy", () => {
  it("joins waiting rooms and watches playing rooms", () => {
    expect(roomAction(room("waiting"))).toBe("join");
    expect(roomAction(room("playing"))).toBe("watch");
    expect(roomAction(room("finished"))).toBeNull();
  });

  it("offers reconnect for the authenticated user's playing room", () => {
    expect(roomAction(room("playing"), "room-1")).toBe("reconnect");
    expect(roomAction(room("playing"), "room-2")).toBe("watch");
    expect(roomAction(room("waiting"), "room-1")).toBeNull();
  });

  it("counts occupied human and bot seats", () => {
    expect(roomOccupancy(room("waiting"))).toBe("2/4");
  });

  it("uses explicit three-player capacity and does not offer a fourth place", () => {
    const sanma: MobileLobbyRoom = {
      ...room("waiting"),
      playerCount: 3,
      sanmaType: "kansai",
      seats: [
        { name: "East", isBot: false },
        { name: "South", isBot: true },
        null,
      ],
    };
    expect(roomOccupancy(sanma)).toBe("2/3");
    expect(roomAction(sanma)).toBe("join");
    sanma.seats[2] = { name: "West", isBot: false };
    expect(roomOccupancy(sanma)).toBe("3/3");
    expect(roomAction(sanma)).toBeNull();
  });

  it("keeps partial legacy listings four-player", () => {
    expect(
      roomOccupancy({
        ...room("waiting"),
        seats: [{ name: "East", isBot: false }],
      })
    ).toBe("1/4");
  });
});

describe("mobile lobby monitored-game response", () => {
  const game = {
    watchId: "WATCH123",
    leagueName: "TNT LEAGUE V",
    startTime: null,
    players: [
      { seat: 0, displayName: "East" },
      { seat: 1, displayName: "South" },
    ],
  };

  it("preserves MCR metadata and treats legacy presets as Riichi", () => {
    const data = MobileLobbyResponseSchema.parse({
      presets: [{ id: "ema", displayName: "EMA" }, serverPresets[0]],
      rooms: [],
    });
    expect(data.presets).toEqual([
      { id: "ema", displayName: "EMA", rulesFamily: "riichi" },
      serverPresets[0],
    ]);
  });

  it("accepts monitored Tenhou games with no native rooms or relay match ID", () => {
    const data = MobileLobbyResponseSchema.parse({
      presets: [],
      rooms: [],
      tenhouLiveGames: [game],
    });

    expect(data.tenhouLiveGames).toEqual([game]);
    expect(data.rooms).toEqual([]);
  });

  it("preserves native rooms alongside monitored tournament games", () => {
    const data = MobileLobbyResponseSchema.parse({
      presets: [],
      rooms: [room("playing")],
      tenhouLiveGames: [game],
    });

    expect(data.rooms).toEqual([room("playing")]);
    expect(data.tenhouLiveGames).toEqual([game]);
  });

  it("keeps older web deployments compatible with native rooms", () => {
    const data = MobileLobbyResponseSchema.parse({
      presets: [],
      rooms: [room("waiting")],
    });

    expect(data.tenhouLiveGames).toEqual([]);
    expect(data.rooms).toEqual([room("waiting")]);
  });

  it("rejects unusable watch targets instead of offering a broken Watch action", () => {
    expect(() =>
      MobileLobbyResponseSchema.parse({
        presets: [],
        rooms: [],
        tenhouLiveGames: [{ ...game, watchId: "" }],
      })
    ).toThrow();
  });

  it.each(["online", "kansai"] as const)(
    "does not strip %s sanma or Duplicate room metadata",
    (sanmaType) => {
      const sanma = {
        ...room("waiting"),
        playerCount: 3,
        sanmaType,
        mode: { type: "duplicate", seed: "Board", generationVersion: 1 },
        seats: [null, null, null],
      };
      const data = MobileLobbyResponseSchema.parse({
        presets: [],
        rooms: [sanma],
      });
      expect(data.rooms).toEqual([sanma]);
      expect(roomOccupancy(data.rooms[0])).toBe("0/3");
    }
  );
});
