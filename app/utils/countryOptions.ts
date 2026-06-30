import { countries } from "country-flag-icons";
import * as flagStrings from "country-flag-icons/string/3x2";

const flags = flagStrings as Record<string, string>;

/**
 * Return the inline SVG string for a country code, or undefined if unknown.
 */
export function getFlagSvg(code: string): string | undefined {
  return flags[code.toUpperCase()];
}

/**
 * Build a data-URI from an inline SVG so it can be used in an <img> src.
 */
export function flagDataUri(code: string): string | undefined {
  const svg = getFlagSvg(code);
  if (!svg) {
    return undefined;
  }
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Build a list of { value, label } options for country selects,
 * localised via the browser-native Intl.DisplayNames API.
 *
 * The value is the ISO 3166-1 alpha-2 code (e.g. "FR").
 */
export function getCountryOptions(locale: string) {
  const displayNames = new Intl.DisplayNames([locale], { type: "region" });

  return countries
    .map((code) => {
      try {
        const name = displayNames.of(code);
        if (!name) {
          return null;
        }
        return { value: code, label: name };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => a!.label.localeCompare(b!.label, locale)) as {
    value: string;
    label: string;
  }[];
}
