import { describe, expect, it } from "vitest";
import { data } from "./quizCommands";
import {
  MAX_QUIZ_ROUNDS,
  MAX_QUIZ_TIMEOUT_SECONDS,
} from "./quizOptions";

describe("quiz command schema", () => {
  it("bounds rounds and timeout for every quiz type", () => {
    const command = data.toJSON();

    for (const subcommand of command.options ?? []) {
      const rounds = subcommand.options?.find(
        (option) => option.name === "nbrounds"
      );
      const timeout = subcommand.options?.find(
        (option) => option.name === "timeout"
      );
      expect(rounds).toMatchObject({
        min_value: 1,
        max_value: MAX_QUIZ_ROUNDS,
      });
      expect(timeout).toMatchObject({
        min_value: 1,
        max_value: MAX_QUIZ_TIMEOUT_SECONDS,
      });
    }
  });
});