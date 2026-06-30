import type { PicturePair } from "../../types/pictures";

export interface LeagueOption {
  _id: string;
  name: string;
  hasTeams: boolean;
  phaseCutoffTimes: string[];
  hasFinalPhase: boolean;
  hasRegularPhase: boolean;
  configuration: string | null;
  earliestGameDate: string | null;
  latestGameDate: string | null;
}

export interface TeamOption {
  _id: string;
  displayName: string;
  simpleName: string;
  leagueId: string;
  pictures: PicturePair | null;
  roster: {
    members: string[];
    substitutes: string[];
  };
}

export interface UserOption {
  _id: string;
  name: string;
  avatarUrl: string | null;
  majsoulName: string | null;
}

export type PhaseFilter = "both" | `phase${number}`;

export interface BracketSeeding {
  seed: number;
  teamId: string;
}

export interface BracketData {
  leagueId: string;
  seedings: BracketSeeding[];
}
