import { Locale } from "discord.js";
import { localize } from "./localizationUtils";

export function stringFormat(locale: Locale, path: string, ...args: string[]) {
  const locString = localize(locale, path);
  return locString.replace(/{(\d+)}/g, (match, index) => args[index] || "");
}
