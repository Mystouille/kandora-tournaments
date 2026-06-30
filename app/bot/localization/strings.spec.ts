import { describe, expect, it } from "vitest";
import type { StringResources } from "./strings";
import { stringsFr } from "./strings-fr";
import { stringsEn } from "./strings-en";

// Discord chat-input (slash) command limits.
// https://discord.com/developers/docs/interactions/application-commands
const MAX_DESCRIPTION_LENGTH = 100;
const MAX_NAME_LENGTH = 32;
const NAME_PATTERN = /^[-_\p{L}\p{N}]{1,32}$/u;

type StringTree = { [key: string]: StringTree | string };

interface Leaf {
  path: string;
  key: string;
  value: string;
}

// Walk a localized string table, collecting every string leaf together with
// its dotted path so failures point at the exact offending entry.
function collectLeaves(tree: StringTree, path: string[], acc: Leaf[]): void {
  for (const [key, value] of Object.entries(tree)) {
    const nextPath = [...path, key];
    if (typeof value === "string") {
      acc.push({ path: nextPath.join("."), key, value });
    } else {
      collectLeaves(value, nextPath, acc);
    }
  }
}

const locales: Array<{ locale: string; strings: StringResources }> = [
  { locale: "fr", strings: stringsFr },
  { locale: "en", strings: stringsEn },
];

// Only the `name` and `desc` keys map to Discord command/subcommand/option
// definitions; reply/option/system strings use other keys and are unbounded.
describe.each(locales)(
  "Discord slash-command strings ($locale)",
  ({ strings }) => {
    const leaves: Leaf[] = [];
    collectLeaves(strings as unknown as StringTree, [], leaves);

    it("keeps every command/subcommand/option description within Discord's limit", () => {
      const descriptions = leaves.filter((leaf) => leaf.key === "desc");
      expect(descriptions.length).toBeGreaterThan(0);
      for (const { path, value } of descriptions) {
        expect(value.length, `${path} is empty`).toBeGreaterThanOrEqual(1);
        expect(
          value.length,
          `${path} is ${value.length} chars (max ${MAX_DESCRIPTION_LENGTH})`
        ).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);
      }
    });

    it("keeps every command/subcommand/option name valid", () => {
      const names = leaves.filter((leaf) => leaf.key === "name");
      expect(names.length).toBeGreaterThan(0);
      for (const { path, value } of names) {
        expect(value.length, `${path} is empty`).toBeGreaterThanOrEqual(1);
        expect(
          value.length,
          `${path} is ${value.length} chars (max ${MAX_NAME_LENGTH})`
        ).toBeLessThanOrEqual(MAX_NAME_LENGTH);
        expect(
          NAME_PATTERN.test(value),
          `${path} "${value}" has invalid characters`
        ).toBe(true);
        expect(value, `${path} "${value}" must be lowercase`).toBe(
          value.toLowerCase()
        );
      }
    });
  }
);
