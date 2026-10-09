import * as React from "react";
import {
  Children,
  createElement,
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
import { listPresets } from "~/game/rules/presets";
import { INITIAL_NEARBY_MATCH_STATE } from "./NearbyMatchController";
import { NearbyLobbyPanel } from "./NearbyLobbyPanel";
import { seatValues } from "~/game/rules/seats";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof React>();
  return { ...actual, useState: vi.fn(actual.useState) };
});

afterEach(() => {
  vi.resetAllMocks();
});

function props(): ComponentProps<typeof NearbyLobbyPanel> {
  return {
    state: INITIAL_NEARBY_MATCH_STATE,
    localState: { status: "idle", matchId: null, error: null },
    identity: { deviceId: "mobile:host", displayName: "Host" },
    busy: false,
    onDisplayNameChange: vi.fn(),
    onPlaySolo: vi.fn(),
    onHost: vi.fn(),
    onDiscover: vi.fn(),
    onResumeHost: vi.fn(),
    onConnect: vi.fn(),
    onReadyChange: vi.fn(),
    onAddBot: vi.fn(),
    onKick: vi.fn(),
    onStartMatch: vi.fn(),
    onLeave: vi.fn(),
  };
}

function renderPanel(config: ComponentProps<typeof NearbyLobbyPanel>) {
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
  return () => {
    cursor = 0;
    return NearbyLobbyPanel(config);
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

describe("Nearby lobby panel", () => {
  it("offers one hierarchical setup for local and Nearby, defaulting to Riichi/Yonma/M-League", () => {
    const html = renderToStaticMarkup(createElement(NearbyLobbyPanel, props()));
    expect(html).toContain('value="m-league" selected=""');
    expect(html).toContain("Yonma (4 players)");
    expect(html).toContain("Sanma (3 players)");
    const sections = [
      'aria-label="Mahjong rules"',
      'aria-label="Players"',
      'aria-label="Game type"',
      "<legend>Duplicate</legend>",
    ].map((label) => html.indexOf(label));
    expect(sections.every((index) => index >= 0)).toBe(true);
    expect(sections).toEqual([...sections].sort((a, b) => a - b));
    expect(html.match(/aria-label="Game type"/g)).toHaveLength(1);
    expect(html.match(/<select\b/g)).toHaveLength(1);
    expect(html).not.toContain("Rules for a new table");
    expect(html).toContain(">Solo</span>");
    expect(html).toContain(">Host</span>");
    expect(html).not.toContain('name="sanmaType"');
  });

  it("passes the complete local preset catalog to the shared controls", () => {
    const render = renderPanel(props());
    const controls = setupControls(render());
    expect(controls.presets).toEqual(listPresets());
    expect(controls.presets.map((preset) => preset.id)).toEqual(
      expect.arrayContaining([
        "tenhou-hanchan",
        "tenhou-tonpuusen",
        "m-league",
        "mcr-ema",
      ])
    );
    expect(controls.preset).toBe("m-league");
    expect(controls.value).toMatchObject({
      rulesFamily: "riichi",
      playerCount: 4,
    });
    expect(controls.mobile).toBe(true);
  });

  it.each(["Solo", "Host"] as const)(
    "starts a new %s game with M-League instead of the controller's legacy fallback",
    (action) => {
      const config = props();
      config.state = { ...config.state, available: true };
      const render = renderPanel(config);
      button(render(), action).onClick();
      const start = action === "Solo" ? config.onPlaySolo : config.onHost;
      expect(start).toHaveBeenCalledWith({
        preset: "m-league",
        rulesFamily: "riichi",
        playerCount: 4,
        sanmaType: "online",
        mode: { type: "normal" },
        spectatorDelayMs: 0,
      });
    }
  );

  it("uses preset changes from the shared game-type selector for new tables", () => {
    const config = props();
    config.state = { ...config.state, available: true };
    const render = renderPanel(config);
    setupControls(render()).onPresetChange("tenhou-tonpuusen");
    expect(setupControls(render()).preset).toBe("tenhou-tonpuusen");
    button(render(), "Host").onClick();
    expect(config.onHost).toHaveBeenCalledWith(
      expect.objectContaining({
        preset: "tenhou-tonpuusen",
        rulesFamily: "riichi",
        playerCount: 4,
      })
    );
  });

  it.each([
    {
      rulesFamily: "riichi",
      playerCount: 3,
      sanmaType: "kansai",
      preset: "m-league",
    },
    {
      rulesFamily: "mcr",
      playerCount: 4,
      sanmaType: "online",
      preset: "mcr-ema",
    },
  ] as const)(
    "hosts the shared $rulesFamily/$playerCount-player selection without unrelated game types",
    ({ preset, ...selection }) => {
      const config = props();
      config.state = { ...config.state, available: true };
      const render = renderPanel(config);
      const controls = setupControls(render());
      controls.onChange({ ...controls.value, ...selection });
      const html = renderToStaticMarkup(render());
      expect(html).not.toContain('aria-label="Game type"');
      if (selection.rulesFamily === "mcr") {
        expect(html).not.toContain('aria-label="Players"');
        expect(html).not.toContain('aria-label="Sanma game type"');
        expect(html).toContain("EMA Green Book");
      } else {
        expect(html).toContain('aria-label="Players"');
        expect(html).toContain('aria-label="Sanma game type"');
      }
      button(render(), "Host").onClick();
      expect(config.onHost).toHaveBeenCalledWith(
        expect.objectContaining({ preset, ...selection })
      );
    }
  );

  it("keeps invalid Duplicate setup errors visible without starting a table", () => {
    const config = props();
    const render = renderPanel(config);
    const controls = setupControls(render());
    controls.onChange({ ...controls.value, duplicateEnabled: true });
    button(render(), "Solo").onClick();
    expect(config.onPlaySolo).not.toHaveBeenCalled();
    expect(renderToStaticMarkup(render())).toContain(
      "Enter a duplicate seed between 1 and 128 characters."
    );
  });

  it("disables shared setup and new-game actions while busy", () => {
    const config = props();
    config.busy = true;
    config.state = { ...config.state, available: true };
    const render = renderPanel(config);
    const tree = render();
    expect(setupControls(tree).disabled).toBe(true);
    expect(button(tree, "Solo").disabled).toBe(true);
    expect(button(tree, "Host").disabled).toBe(true);
  });

  it.each(["online", "kansai"] as const)(
    "shows only three places and the %s variant",
    (sanmaType) => {
      const config = props();
      config.state = {
        ...INITIAL_NEARBY_MATCH_STATE,
        role: "host",
        status: "lobby",
        roomState: {
          type: "room_state",
          matchId: "three",
          status: "waiting",
          playerCount: 3,
          sanmaType,
          mode: { type: "duplicate", seed: "Board", generationVersion: 1 },
          mySeat: 0,
          hostSeat: 0,
          canStart: false,
          seats: seatValues(3, (seat) => ({
            seat,
            occupant: { kind: "empty" as const },
            ready: false,
          })),
        },
      };
      const html = renderToStaticMarkup(
        createElement(NearbyLobbyPanel, config)
      );
      expect(html).toContain("0 of 3 players");
      expect(html).toContain(
        `Sanma · ${sanmaType === "online" ? "Online" : "Kansai"}`
      );
      expect(html).toContain("Duplicate · Board");
      expect(html.match(/<li>/g)).toHaveLength(3);
      expect(html).not.toContain("of 4 players");
    }
  );

  it("makes clear that resuming uses the saved setup", () => {
    const config = props();
    config.localState = { status: "paused", matchId: "saved", error: null };
    const html = renderToStaticMarkup(createElement(NearbyLobbyPanel, config));
    expect(html).toContain("Resume solo");
    expect(html).toContain("saved table");
  });

  it("resumes a saved solo game without supplying or validating a new setup", () => {
    const config = props();
    config.localState = { status: "paused", matchId: "saved", error: null };
    const render = renderPanel(config);
    const controls = setupControls(render());
    controls.onPresetChange("jpml-hanchan");
    controls.onChange({
      ...controls.value,
      rulesFamily: "mcr",
      duplicateEnabled: true,
      duplicateSeed: "",
    });
    button(render(), "Resume solo").onClick();
    expect(config.onPlaySolo).toHaveBeenCalledTimes(1);
    expect(config.onPlaySolo).toHaveBeenCalledWith();
    expect(config.onHost).not.toHaveBeenCalled();
    expect(renderToStaticMarkup(render())).not.toContain(
      "Enter a duplicate seed"
    );
  });

  it("resumes the saved Nearby host without exposing or overriding its setup", () => {
    const config = props();
    config.state = {
      ...config.state,
      role: "host",
      status: "paused",
    };
    const render = renderPanel(config);
    const tree = render();
    expect(elements(tree).some(({ type }) => type === GameSetupControls)).toBe(
      false
    );
    button(tree, "Resume host").onClick();
    expect(config.onResumeHost).toHaveBeenCalledTimes(1);
    expect(config.onResumeHost).toHaveBeenCalledWith();
    expect(config.onHost).not.toHaveBeenCalled();
    expect(config.onPlaySolo).not.toHaveBeenCalled();
  });

  it("shows connection progress without a verification-code step", () => {
    const html = renderToStaticMarkup(
      createElement(NearbyLobbyPanel, {
        state: {
          ...INITIAL_NEARBY_MATCH_STATE,
          role: "guest",
          status: "connecting",
          discovered: [
            { endpointId: "host-endpoint", endpointName: "Host's table" },
          ],
        },
        localState: { status: "idle", matchId: null, error: null },
        identity: { deviceId: "mobile:guest", displayName: "Guest" },
        busy: false,
        onDisplayNameChange: vi.fn(),
        onPlaySolo: vi.fn(),
        onHost: vi.fn(),
        onDiscover: vi.fn(),
        onResumeHost: vi.fn(),
        onConnect: vi.fn(),
        onReadyChange: vi.fn(),
        onAddBot: vi.fn(),
        onKick: vi.fn(),
        onStartMatch: vi.fn(),
        onLeave: vi.fn(),
      })
    );

    expect(html).toContain("Connecting");
    expect(html).not.toContain("Verify device");
    expect(html).not.toContain("Pairing code");
    expect(html).not.toContain("Codes match");
  });
});
