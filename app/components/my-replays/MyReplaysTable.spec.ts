import { describe, expect, it } from "vitest";
import { MY_REPLAY_COLUMN_MIN_BREAKPOINT } from "./MyReplaysTable";

const BREAKPOINT_PRIORITY = ["xs", "sm", "md", "lg", "xl", "xxl"];

describe("My Replays responsive column priority", () => {
  it("keeps Links ahead of every optional column after Date", () => {
    expect(MY_REPLAY_COLUMN_MIN_BREAKPOINT.links).toBe("sm");
    const linkPriority = BREAKPOINT_PRIORITY.indexOf(
      MY_REPLAY_COLUMN_MIN_BREAKPOINT.links
    );

    for (const [column, breakpoint] of Object.entries(
      MY_REPLAY_COLUMN_MIN_BREAKPOINT
    )) {
      if (column !== "links") {
        expect(BREAKPOINT_PRIORITY.indexOf(breakpoint)).toBeGreaterThan(
          linkPriority
        );
      }
    }
  });
});
