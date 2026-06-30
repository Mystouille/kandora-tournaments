import { Platform } from "~/types/league-enums";
import type { League } from "~/db/League";
import type { User } from "~/db/User";

/**
 * Resolved Discord display data for a single user.
 *
 * Produced by {@link resolvePlayerDisplay}. Message-building code should
 * prefer reading `line` for the canonical representation, or compose
 * `mention`/`platformName` manually when the surrounding format string has
 * multiple slots (e.g. faction rankings where the platform name is rendered
 * in italics).
 */
export interface PlayerDisplay {
  /**
   * Discord mention (`<@id>`) when the user has a linked Discord identity,
   * otherwise the plain name wrapped in bold markers (`**name**`).
   */
  mention: string;
  /** Raw `user.name` (unformatted) or the configured unknown label. */
  plainName: string;
  /**
   * Platform-specific account name for the league's platform, or `null` when
   * the user has no identity on that platform.
   */
  platformName: string | null;
  /** Platform account identifier (numeric for Majsoul, string elsewhere). */
  platformAccountId: string | number | null;
  /**
   * Canonical rendering: `<mention>` optionally followed by ` (platformName)`
   * when a distinct platform name exists.
   */
  line: string;
}

export interface PlayerDisplayContext {
  /** League platform name (from `league.platformConfig.platformName`). */
  platform?: Platform | string | null;
  /** Label used when the user is missing entirely. Defaults to "Unknown". */
  unknownLabel?: string;
}

/**
 * Extract the canonical league platform string from a league document.
 * Returns `null` when unavailable so callers can pass the result through to
 * {@link resolvePlayerDisplay} without additional guards.
 */
export function getLeaguePlatform(
  league: Pick<League, "platformConfig"> | null | undefined
): Platform | string | null {
  return league?.platformConfig?.platformName ?? null;
}

/**
 * Resolve how a user should be displayed in a Discord message for the given
 * league platform. The returned `line` follows the convention:
 *
 *   `<@discordId> (platformName)`  — when both are available
 *   `<@discordId>`                  — when no platform name exists
 *   `**user.name** (platformName)`  — when no Discord identity is linked
 *   `**user.name**`                 — final fallback
 *
 * The platform name suffix is also elided when it would duplicate the base
 * name (e.g. a user whose `name` already matches their platform name).
 */
export function resolvePlayerDisplay(
  user: User | null | undefined,
  ctx: PlayerDisplayContext = {}
): PlayerDisplay {
  const unknown = ctx.unknownLabel ?? "Unknown";
  const plainName = user?.name ?? unknown;
  const discordId = user?.discordIdentity?.id ?? null;
  const mention = discordId ? `<@${discordId}>` : `**${plainName}**`;

  let platformName: string | null = null;
  let platformAccountId: string | number | null = null;

  if (user) {
    if (ctx.platform === Platform.RIICHICITY && user.riichiCityIdentity?.id) {
      platformName = user.riichiCityIdentity.name ?? null;
      platformAccountId = user.riichiCityIdentity.id;
    } else if (
      ctx.platform === Platform.MAJSOUL &&
      user.majsoulIdentity?.userId
    ) {
      platformName = user.majsoulIdentity.name ?? null;
      platformAccountId = Number(user.majsoulIdentity.userId);
    } else if (ctx.platform === Platform.TENHOU && user.tenhouIdentity?.name) {
      platformName = user.tenhouIdentity.name;
      platformAccountId = user.tenhouIdentity.name;
    }
  }

  const showSuffix = !!platformName && platformName !== plainName;
  const line = showSuffix ? `${mention} (${platformName})` : mention;

  return { mention, plainName, platformName, platformAccountId, line };
}
