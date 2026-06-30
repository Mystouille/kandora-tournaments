import { Platform, type League } from "~/db/League";
import { platformConnectorsDisabled } from "config";
import type { ILeagueTournamentConnector } from "./ILeagueTournamentConnector.server";
import { MajsoulLeagueConnector } from "./MajsoulLeagueConnector.server";
import { RiichiCityLeagueConnector } from "./RiichiCityLeagueConnector.server";
import { TenhouLeagueConnector } from "./TenhouLeagueConnector.server";

/**
 * Returns the singleton ILeagueTournamentConnector for a given league's
 * platform.  Throws if the platform is unsupported.
 *
 * When `PLATFORM_CONNECTORS_DISABLED=true`, throws for any external
 * platform so callers get a deterministic error instead of a late init
 * failure deeper in the stack.
 */
export function createConnectorForLeague(
  league: League
): ILeagueTournamentConnector {
  if (platformConnectorsDisabled) {
    throw new Error(
      `External platform connectors are disabled (PLATFORM_CONNECTORS_DISABLED=true); cannot create connector for league "${league.name}" on platform "${league.platformConfig.platformName}".`
    );
  }
  switch (league.platformConfig.platformName) {
    case Platform.RIICHICITY:
      return RiichiCityLeagueConnector.instance;
    case Platform.MAJSOUL:
      return MajsoulLeagueConnector.instance;
    case Platform.TENHOU:
      return TenhouLeagueConnector.instance;
    default:
      throw new Error(
        `No connector available for platform "${league.platformConfig.platformName}" (league ${league.name})`
      );
  }
}
