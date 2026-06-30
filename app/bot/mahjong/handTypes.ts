export enum MeldType {
  Chii = "c",
  Pon = "p",
  Shouminkan = "s",
  Daiminkan = "d",
  Ankan = "a",
}

export enum MeldSource {
  Self = 0,
  Shimocha = 1,
  Toimen = 2,
  Kamicha = 3,
}

export type MeldToDisplay = {
  // order matters!
  tiles: string;
  type: MeldType;
  source: MeldSource;
};

export type HandToDisplay = {
  closedTiles: string;
  melds: MeldToDisplay[];
  lastTileSeparated: boolean;
};

/*
 * TILE34
 * Represents the number of tiles of a specific kind
 * eg: [1,0,2,...] represents a hand wwith 1*1m, 0*2m, 2*3m, ... => meaning the hand is 1m3m3m + [...]
 * Red 5 are encoded by using the tens (12 => 055m)
 */

/*
 * Similar to Tile34 but split the array by suit
 * eg: [[...][1,0,2,...]] represents a hand wwith ..., 1*1p, 0*2p, 2*3p, ... => meaning the hand is [...] + 1p3p3p + [...]
 * Used by the syanten module
 * NO RED FIVE
 */
type NbTile = 0 | 1 | 2 | 3 | 4;
export type Suit997 = [
  NbTile,
  NbTile,
  NbTile,
  NbTile,
  NbTile,
  NbTile,
  NbTile,
  NbTile,
  NbTile,
];
export type Honor997 = [NbTile, NbTile, NbTile, NbTile, NbTile, NbTile, NbTile];
export type Tile997 = [Suit997, Suit997, Suit997, Honor997];

export const makeNewTile997 = () =>
  [
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0],
  ] as Tile997;
