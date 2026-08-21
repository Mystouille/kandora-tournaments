import { describe, expect, it } from "vitest";
import { data } from "./myInfoCommands";

describe("myinfo command", () => {
  it("registers only the update subcommand", () => {
    const command = data.toJSON();

    expect(command.options?.map((option) => option.name)).toEqual(["update"]);
  });
});