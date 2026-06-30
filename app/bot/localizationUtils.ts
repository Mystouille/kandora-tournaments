import { Locale, SharedNameAndDescription } from "discord.js";
import {
  invariantLocale,
  invariantResources,
  type NameDesc,
  resourceMap,
} from "./localization/strings";

type NestedStringContainer = { [id: string]: NestedStringContainer | string };

// Return a localized string from the specified resources object
export function localize(locale: Locale, path: string): string {
  const tokens = path.split(".");

  const resources = resourceMap[locale] || invariantResources;
  let object: NestedStringContainer | string = resources;
  tokens.forEach((tok) => {
    if (typeof object !== "string") {
      object = object[tok];
    }
  });
  if (typeof object === "string") {
    return object;
  } else {
    return JSON.stringify(object);
  }
}

// Return the localization props needed for discord.js multilanguage support
export function getLocProps(path: string) {
  const props: Partial<Record<Locale, string | null>> | null = {};
  Object.values(Locale).forEach((locale) => {
    const localizedRes = resourceMap[locale];
    if (localizedRes !== undefined) {
      const localizedString = localize(locale, path);
      props[locale] = localizedString;
    }
  });
  return props;
}

export function buildOptionNameAndDescription<
  OptionType extends SharedNameAndDescription,
>(option: OptionType, path: NameDesc) {
  return option
    .setName(localize(invariantLocale, path.name))
    .setNameLocalizations(getLocProps(path.name))
    .setDescription(localize(invariantLocale, path.desc))
    .setDescriptionLocalizations(getLocProps(path.desc));
}
