import { fromTile9997ToStr } from "./handConverter";

import * as shantenCalc from "syanten";
import { makeNewTile997, type Suit997 } from "./handTypes";
import { checkFileExists } from "./imageUtils";

export enum SuitOption {
  Manzu = 0,
  Pinzu = 1,
  Souzu = 2,
  Random = 3,
}

export enum DifficultyOption {
  Easy = "Easy",
  Normal = "Normal",
  Hard = "Hard",
}

const allSuits: SuitOption[] = [
  SuitOption.Manzu,
  SuitOption.Pinzu,
  SuitOption.Souzu,
];

export type ChinitsuProblem = {
  hand: string;
  answer: number[];
};

export function getNewChinitsuProblem(
  suitparam: SuitOption,
  difficulty: DifficultyOption
): ChinitsuProblem {
  let suit: SuitOption = suitparam;
  if (suitparam === SuitOption.Random) {
    suit = allSuits[Math.floor(Math.random() * 3)];
  }
  let nbMinWaits = 1;
  switch (difficulty) {
    case DifficultyOption.Normal:
      nbMinWaits = 2;
      break;
    case DifficultyOption.Hard:
      nbMinWaits = 3;
      break;
  }

  const { hand, waits } = getRandomChinitsuTenpai(suit, nbMinWaits);
  return { answer: waits, hand };
}

function getRandomChinitsuTenpai(suit: SuitOption, nbMinWaits: number) {
  let handStr = "";
  let shanten = 7;
  let handAlreadyExist = true;
  let waits: number[] = [];
  const tilesToAdd = [];

  while (shanten != 0 || handAlreadyExist || waits.length < nbMinWaits) {
    const hand: Suit997 = Array<number>(9).fill(0) as Suit997;
    let i = 0;
    for (let i = 0; i < 9; i++) {
      tilesToAdd.push(i);
      tilesToAdd.push(i);
      tilesToAdd.push(i);
      tilesToAdd.push(i);
    }
    while (i < 13) {
      const index = Math.floor(Math.random() * tilesToAdd.length);
      const tileValue = tilesToAdd[index];
      const nbSameTile = hand[tileValue];
      if (nbSameTile < 4) {
        hand[tileValue]++;
        tilesToAdd.splice(index, 1);
        i++;
      }
    }
    const fullHand = makeNewTile997();
    fullHand[suit.valueOf()] = hand;
    shanten = shantenCalc.syantenAll(fullHand);
    if (shanten === 0) {
      waits = [];
      for (let j = 0; j < 9; j++) {
        if (hand[j] < 4) {
          hand[j]++;
          const newShanten = shantenCalc.syantenAll(fullHand);
          if (newShanten === -1) {
            waits.push(j + 1);
          }
          hand[j]--;
        }
      }
      if (waits.length >= nbMinWaits) {
        handStr = fromTile9997ToStr(fullHand);
        handAlreadyExist = checkFileExists(handStr, true);
      }
    }
  }
  return { hand: handStr, waits };
}
