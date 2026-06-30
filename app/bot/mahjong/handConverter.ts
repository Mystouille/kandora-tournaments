import { splitTiles } from "./handParser";
import {
  makeNewTile997 as makeNewTile9997,
  type Tile997 as Tile9997,
} from "./handTypes";

function fromStringToSuitIndex(suit: string): number {
  switch (suit) {
    case "m":
      return 0;
    case "p":
      return 1;
    case "s":
      return 2;
    case "z":
      return 3;
    default:
      return -1;
  }
}

/**
 * Returns a Tile9997 representation of the hand
 * @param hand - A strict natural representation of the hand (and no aka)
 */
export function fromStrToTile9997(hand: string): Tile9997 {
  const toReturn: Tile9997 = makeNewTile9997();

  const tileList = splitTiles(hand);
  tileList.forEach((tile) => {
    let tileIndex = parseInt(tile[0]);
    if (tileIndex == 0) {
      tileIndex = 5;
    }
    const suitIndex = fromStringToSuitIndex(tile[tile.length - 1]);
    toReturn[suitIndex][tileIndex - 1]++;
  });
  return toReturn;
}

/**
 * Returns a strict representation of the hand
 * @param hand - A tile9997 representation of the hand
 */
export function fromTile9997ToStr(hand: Tile9997): string {
  const sb = [];

  for (let i = 0; i < 9; i++) {
    for (let j = 0; j < hand[0][i]; j++) {
      sb.push(`${i + 1}m`);
    }
  }
  for (let i = 0; i < 9; i++) {
    for (let j = 0; j < hand[1][i]; j++) {
      sb.push(`${i + 1}p`);
    }
  }
  for (let i = 0; i < 9; i++) {
    for (let j = 0; j < hand[2][i]; j++) {
      sb.push(`${i + 1}s`);
    }
  }
  for (let i = 0; i < 7; i++) {
    for (let j = 0; j < hand[3][i]; j++) {
      sb.push(`${i + 1}z`);
    }
  }

  return sb.join("");
}

/**
 * Returns a Tile9997 representation of the hand
 * @param hand - A strict natural representation of the hand (and no aka)
 */
export function addTileStrTo9997(
  tile: string,
  hand: Tile9997,
  delta: number = 1
) {
  const tileIndex = parseInt(tile[0]);
  const suitIndex = fromStringToSuitIndex(tile[tile.length - 1]);
  hand[suitIndex][tileIndex - 1] += delta;
}

/**
 * Returns a Tile34 representation of the hand
 * @param hand - A strict natural representation of the hand (and no aka)
 */
export function fromStrToTile34(hand: string): number[] {
  const toReturn = new Array(34).fill(0);

  const tileList = splitTiles(hand);
  tileList.forEach((tile) => {
    const tileIndex = parseInt(tile[0]);
    const suitIndex = fromStringToSuitIndex(tile[tile.length - 1]);
    toReturn[suitIndex * 9 + tileIndex - 1]++;
  });

  return toReturn;
}

/**
 * Returns a Tile136 representation of the hand
 * @param hand - A Tile34 representation of the same hand
 */
export function from34To136(hand: number[]): number[] {
  const toReturn: number[] = [];
  for (let x = 0; x <= 34; x++) {
    if (hand[x] <= 0) {
      continue;
    }
    let nbTiles = hand[x];
    let nbRedTiles = 0;
    if (nbTiles >= 10) {
      nbTiles = hand[x] % 10;
      nbRedTiles = Math.floor(hand[x] / 10);
    }
    const tileValue = x * 4;
    for (let i = 0; i < nbRedTiles; i++) {
      toReturn.push(tileValue + i);
    }
    for (let i = 4 - nbTiles; i < 4; i++) {
      toReturn.push(tileValue + i);
    }
  }
  return toReturn;
}

/**
 * Returns a string representation of the hand
 * @param hand - A Tile34 representation of the same hand
 */
export function from34ToStr(hand: number[]): string {
  let toReturn: string = "";
  for (let x = 0; x <= 34; x++) {
    if (hand[x] <= 0) {
      continue;
    }
    const suit = x < 9 ? "m" : x < 18 ? "p" : x < 27 ? "s" : "z";
    const index = (x % 9) + 1;

    const nbTiles = hand[x] % 10;
    const nbRedTiles = Math.floor(hand[x] / 10);

    for (let i = 0; i < nbRedTiles; i++) {
      toReturn += "0" + suit;
    }
    for (let i = 0; i < nbTiles; i++) {
      toReturn += index.toString() + suit;
    }
  }
  return toReturn;
}
