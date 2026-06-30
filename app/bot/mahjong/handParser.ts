import { Locale } from "discord.js";
import { AppEmojiCollection } from "../resources/emojis/AppEmojiCollection";
import {
  type HandToDisplay,
  MeldSource,
  type MeldToDisplay,
  MeldType,
} from "./handTypes";
import { strings } from "../localization/strings";
import { stringFormat } from "../stringUtils";

export const SUIT_NAMES = ["p", "m", "s", "z"];

function isDigit(str: string): boolean {
  return str >= "0" && str <= "9";
}

function isCalled(str: string): boolean {
  return str === "'";
}

export function splitTiles(hand: string) {
  const tiles: string[] = [];
  let i = 0;
  let k = 0;
  while (i < hand.length) {
    if (SUIT_NAMES.includes(hand[i])) {
      const tileSuit = hand[i];
      for (let j = k; j < i; j++) {
        const tileNumber = hand[j];
        if (!isDigit(tileNumber)) {
          continue;
        }
        let called = "";
        if (isCalled(hand[j + 1])) {
          if (isCalled(hand[j + 2])) {
            called += "''";
            j++;
          } else {
            called += "'";
          }
          j++;
        }
        const tileToAdd = `${tileNumber}${called}${tileSuit}`;
        tiles.push(tileToAdd);
      }
      k = i + 1;
    } else if (!isDigit(hand[i]) && !isCalled(hand[i])) {
      k = i + 1;
    }
    i++;
  }
  return tiles;
}

export function compareTiles(A: string, B: string): number {
  const a = A[A.length - 1];
  const b = B[B.length - 1];
  const x = A[0] === "0" ? 5 : A[0];
  const y = B[0] === "0" ? 5 : B[0];
  return a > b ? 1 : a < b ? -1 : x > y ? 1 : x < y ? -1 : A.length - B.length;
}

export function getHandEmojis({
  hand,
  sorted,
  unique,
}: {
  hand: string;
  sorted?: boolean;
  unique?: boolean;
}): string[] {
  let tileList = splitTiles(hand);
  if (sorted) {
    tileList = tileList.sort(compareTiles);
  }

  let handEmojiList = tileList;
  if (unique) {
    handEmojiList = [...new Set(handEmojiList)];
  }

  const appEmojiList = AppEmojiCollection.instance.getCollection();
  return handEmojiList
    .map((emoji) => appEmojiList.find((appEmo) => appEmo.name === emoji))
    .filter((e) => !!e)
    .map((e) => `<:${e.name}:${e.id}>`);
}

export function getEmojis(emojiNames: string[]): string[] {
  const appEmojiList = AppEmojiCollection.instance.getCollection();
  return emojiNames
    .map((emoji) => appEmojiList.find((appEmo) => appEmo.name === emoji))
    .filter((e) => !!e)
    .map((e) => `<:${e.name}:${e.id}>`);
}

export function getEmoji(emojiName: string): string {
  return getEmojis([emojiName])[0];
}

/**
 * Returns an object used to easily generate an image of the hand
 * @param input - A loose-natural form of a hand
 */
export function fromStrToHandToDisplay(handStr: string): HandToDisplay {
  const toDisplay: HandToDisplay = {
    closedTiles: "",
    lastTileSeparated: false,
    melds: [],
  };
  let handAndMelds = handStr.split(" ");
  if (handAndMelds.length === 0) {
    return toDisplay;
  }
  const closedTilesList = splitTiles(handAndMelds[0]);
  toDisplay.closedTiles = closedTilesList.join("");
  handAndMelds = handAndMelds.reverse();
  handAndMelds.pop();
  const melds = handAndMelds.reverse().join("");
  const meldList = splitTiles(melds);

  let count = 0;
  let sourceLookup = false;
  let isCalled = false;
  const blocks: MeldToDisplay[] = [];
  let currentBlock: string[] = [];
  let currentType: MeldType | undefined = undefined;
  let currentSource: MeldSource | undefined = undefined;
  meldList.forEach((tile) => {
    if (count === 4) {
      const meld = {
        source:
          currentSource === undefined
            ? isCalled
              ? MeldSource.Shimocha
              : MeldSource.Self
            : currentSource,
        type:
          currentType === undefined
            ? isCalled
              ? MeldType.Daiminkan
              : MeldType.Ankan
            : currentType,
        tiles: currentBlock.join(""),
      };
      if (
        meld.type === MeldType.Ankan &&
        !currentBlock.find((x) => x === "8z")
      ) {
        meld.tiles = ["8z", currentBlock[0], currentBlock[0], "8z"].join("");
      } else {
        meld.tiles = currentBlock.join("");
      }
      blocks.push(meld);
      count = 0;
    }

    if (count === 3) {
      if (isCalled && tile !== currentBlock[0]) {
        blocks.push({
          source:
            currentSource === undefined ? MeldSource.Shimocha : currentSource,
          type: currentType === undefined ? MeldType.Pon : currentType,
          tiles: currentBlock.join(""),
        });
        count = 0;
      }
    }

    if (currentType === MeldType.Chii && count === 3) {
      blocks.push({
        source: MeldSource.Kamicha,
        type: currentType,
        tiles: currentBlock.join(""),
      });
      count = 0;
    }

    if (count === 0) {
      currentBlock = [];
      sourceLookup = false;
      isCalled = false;
      currentSource = undefined;
      currentType = undefined;
    }

    if (sourceLookup) {
      currentSource =
        tile[0] === currentBlock[0][0]
          ? MeldSource.Toimen
          : MeldSource.Shimocha;
      sourceLookup = false;
    }

    if (tile.includes("''")) {
      currentType = MeldType.Shouminkan;
      isCalled = true;
    }
    if (tile.includes("'")) {
      isCalled = true;
      sourceLookup = true;
    }
    if (isCalled && count === 0) {
      currentSource = MeldSource.Kamicha;
      sourceLookup = false;
    }
    if (isCalled && count === 2 && currentBlock[0][0] !== currentBlock[1][0]) {
      currentType = MeldType.Chii;
    }
    if (tile === "8z") {
      currentType = MeldType.Ankan;
    }
    if (currentSource === undefined && isCalled) {
      currentSource =
        count === 0
          ? MeldSource.Kamicha
          : count === 1
            ? MeldSource.Toimen
            : undefined;
    }

    currentBlock.push(tile[0] + tile[tile.length - 1]);

    count++;
  });

  if (count === 4) {
    const meld = {
      source:
        currentSource === undefined
          ? isCalled
            ? MeldSource.Shimocha
            : MeldSource.Self
          : currentSource,
      type:
        currentType === undefined
          ? isCalled
            ? MeldType.Daiminkan
            : MeldType.Ankan
          : currentType,
      tiles: currentBlock.join(""),
    };
    if (meld.type === MeldType.Ankan && !currentBlock.find((x) => x === "8z")) {
      const otherTile = currentBlock.find((x) => x !== "8z") || "8z";
      meld.tiles = ["8z", otherTile, otherTile, "8z"].join("");
    } else {
      meld.tiles = currentBlock.join("");
    }
    blocks.push(meld);
    count = 0;
  }

  if (count === 3) {
    blocks.push({
      source: currentSource === undefined ? MeldSource.Shimocha : currentSource,
      type: currentType === undefined ? MeldType.Pon : currentType,
      tiles: currentBlock.join(""),
    });
    count = 0;
  }

  toDisplay.melds = blocks;

  if (closedTilesList.length % 3 === 2) {
    toDisplay.lastTileSeparated = true;
  }

  return toDisplay;
}

export function getHandContext(
  seat: string | null,
  round: string | null,
  turn: string | null,
  doras: string | null,
  locale: Locale
) {
  const replyStrings = strings.commands.mjg.nanikiru.reply;
  let sb = [];

  const doraEmojis =
    doras &&
    getHandEmojis({
      hand: doras,
      sorted: false,
      unique: true,
    }).join("");
  sb.push(seat && stringFormat(locale, replyStrings.seat, seat));
  sb.push(round && stringFormat(locale, replyStrings.round, round));
  sb.push(turn && stringFormat(locale, replyStrings.turn, turn));
  sb.push(doraEmojis && stringFormat(locale, replyStrings.doras, doraEmojis));
  sb = sb.filter((x) => !!x);
  return sb.join(" | ");
}
