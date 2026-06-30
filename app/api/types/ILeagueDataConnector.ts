export interface ContestGamesRequest {
  contestId: number;
  seasonId?: number;
  startTime?: number;
  endTime?: number;
  knownGameIds?: Iterable<string>;
  stopWhenKnownGameFound?: boolean;
}

export interface ILeagueDataConnector<TContestGame, TGameRecord> {
  init(): Promise<void>;
  getAllContestGameRecords(
    request: ContestGamesRequest
  ): Promise<TContestGame[]>;
  getContestGameRecord(gameId: string): Promise<TGameRecord>;
}
