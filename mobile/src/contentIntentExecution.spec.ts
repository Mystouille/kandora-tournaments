import { describe, expect, it } from "vitest";
import { ContentIntentExecutionGate } from "./contentIntentExecution";

describe("content intent execution gate", () => {
  it("starts one execution for the current generation", () => {
    const gate = new ContentIntentExecutionGate();
    gate.supersede();

    const ticket = gate.tryStart("game:first");

    expect(ticket).not.toBeNull();
    expect(gate.tryStart("game:first")).toBeNull();
    expect(gate.isExecutingKey("game:first")).toBe(true);
    expect(gate.isCurrent(ticket!, "game:first")).toBe(true);
  });

  it("lets a newer intent supersede in-flight work", () => {
    const gate = new ContentIntentExecutionGate();
    gate.supersede();
    const first = gate.tryStart("game:first")!;

    gate.supersede();
    const second = gate.tryStart("game:second")!;

    expect(gate.isCurrent(first, "game:first")).toBe(false);
    expect(gate.isCurrent(second, "game:second")).toBe(true);
    gate.finish(first);
    expect(gate.isExecutingKey("game:second")).toBe(true);
    gate.finish(second);
    expect(gate.isExecutingKey("game:second")).toBe(false);
  });

  it("rejects a ticket when the queued key no longer matches", () => {
    const gate = new ContentIntentExecutionGate();
    gate.supersede();
    const ticket = gate.tryStart("replay:first")!;

    expect(gate.isCurrent(ticket, "replay:second")).toBe(false);
    expect(gate.isCurrent(ticket, null)).toBe(false);
  });
});
