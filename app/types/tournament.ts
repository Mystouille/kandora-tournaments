export type LocalizedTournamentText = {
  fr: string;
  en: string;
};

export type TournamentTabKey = "general" | "schedule" | "players";

export type TournamentProOrg =
  | "None"
  | "JPML"
  | "NPM"
  | "Saikouisen"
  | "RMU"
  | "WRC";

export type TournamentPlayerStatus = "In progress" | "Definitive";

export interface TournamentScheduleItem {
  day?: number;
  name: string;
  startTime: string;
  endTime?: string;
  isGameSession?: boolean;
}

export interface TournamentPlayerItem {
  timestamp: string;
  playerName: string;
  licenceId?: string;
  nationality?: string;
  proOrg?: TournamentProOrg;
  status?: TournamentPlayerStatus;
}

export type TournamentStatus = "draft" | "published";

export interface TournamentRecord {
  _id: string;
  name: LocalizedTournamentText;
  slug: string;
  status?: TournamentStatus;
  dates: string[];
  location?: {
    address?: string;
    mapsUrl?: string;
  };
  venueAccess?: LocalizedTournamentText;
  description?: LocalizedTournamentText;
  inscriptionFee?: string;
  bankInfo?: {
    holder?: string;
    iban?: string;
    bic?: string;
    purpose?: string;
  };
  mealsInfo?: LocalizedTournamentText;
  schedule?: TournamentScheduleItem[];
  playerList?: TournamentPlayerItem[];
}

export interface TournamentGroupsResponse {
  upcoming: TournamentRecord[];
  past: TournamentRecord[];
  hasUpcoming: boolean;
}
