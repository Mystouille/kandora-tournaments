import { addTileStrTo9997, fromStrToTile9997 } from "./handConverter";
import * as shantenCalc from "syanten";
import { getHandEmojis, splitTiles } from "./handParser";
import { Locale } from "discord.js";
import { localize } from "../localizationUtils";
import { strings } from "../localization/strings";

export enum UkeireChoice {
  No = "No",
  Yes = "Yes",
  Full = "Full",
}

type Wait = {
  nbTile: number;
  tile: string;
  goodTenpai: boolean;
};

type Ukeire = {
  tile: string;
  waits: Wait[];
  waitsStr: string;
  nbGoodTenpaiWaits: number;
  nbTotalWaits: number;
};

export type WaitInfo = {
  shanten: number;
  ukeire: Ukeire[];
};

/**
 * Fast version: returns only tile → nbTotalWaits for each discard.
 * Calls shantenCalc.hairi() only ONCE (no nested tenpai analysis).
 */
export function getSimpleUkeire(
  handStr: string
): { tile: string; nbTotalWaits: number }[] {
  const tile9997 = fromStrToTile9997(handStr);
  const hairi = shantenCalc.hairi(tile9997);
  const results: { tile: string; nbTotalWaits: number; key: string }[] = [];

  for (const [toCut, draws] of Object.entries(hairi)) {
    if (toCut === "now" || toCut === "wait") {
      continue;
    }
    let nbTotalWaits = 0;
    for (const nbTile of Object.values(draws as Record<string, number>)) {
      nbTotalWaits += nbTile;
    }
    const key = JSON.stringify(draws) + "'" + nbTotalWaits;
    const similar = results.find((r) => r.key === key);
    if (similar) {
      similar.tile += toCut;
    } else {
      results.push({ tile: toCut, nbTotalWaits, key });
    }
  }

  results.sort((a, b) => b.nbTotalWaits - a.nbTotalWaits);
  return results.map(({ tile, nbTotalWaits }) => ({ tile, nbTotalWaits }));
}

/**
 * Returns the extended wait info about a hand (the waits improving the hand after each possible discard)
 * @param hand - A strict natural representation of the hand (and no aka)
 */
export function getWaitInfo(handStr: string): WaitInfo {
  const tile9997 = fromStrToTile9997(handStr);
  const hairi = shantenCalc.hairi(tile9997);
  const goodWaitLimit = 5;
  const hairiExt: Ukeire[] = [];
  const shanten = hairi["wait"] ? 0 : hairi["now"];

  Object.entries(hairi).forEach((entryCut) => {
    const toCut = entryCut[0];
    if (toCut === "now" || toCut === "wait") {
      return;
    }

    let nbGoodTenpaiWaits = 0;
    let nbTotalWaits = 0;
    addTileStrTo9997(toCut, tile9997, -1);
    const waits: Wait[] = [];
    Object.entries(entryCut[1] as object).forEach((entryDraw) => {
      const toDraw = entryDraw[0];
      const nbTile = entryDraw[1];
      addTileStrTo9997(toDraw, tile9997, 1);
      const tenpai = shantenCalc.hairi(tile9997);
      let maxWaits = 0;
      if (tenpai["now"] == 0) {
        Object.entries(tenpai as object).forEach((tenpaiDiscard) => {
          if (tenpaiDiscard[0] === "now") {
            return;
          }
          let nbWaits = 0;
          Object.values(tenpaiDiscard[1] as object).forEach((nbAgari) => {
            nbWaits += nbAgari;
          });
          maxWaits = Math.max(maxWaits, nbWaits);
        });
      }
      nbTotalWaits += nbTile;
      nbGoodTenpaiWaits += maxWaits >= goodWaitLimit ? nbTile : 0;
      waits.push({
        tile: toDraw,
        goodTenpai: maxWaits >= goodWaitLimit,
        nbTile,
      });
      addTileStrTo9997(toDraw, tile9997, -1);
    });
    const waitsStr =
      JSON.stringify(entryCut[1]) + nbGoodTenpaiWaits + "'" + nbTotalWaits;
    const similarWait = hairiExt.find((c) => c.waitsStr === waitsStr);
    if (similarWait !== undefined) {
      similarWait.tile += toCut;
      addTileStrTo9997(toCut, tile9997, 1);
      return;
    }
    hairiExt.push({
      tile: toCut,
      waits,
      nbGoodTenpaiWaits,
      nbTotalWaits,
      waitsStr,
    });
    hairiExt.sort(
      (a, b) =>
        b.nbTotalWaits * 100 +
        b.nbGoodTenpaiWaits -
        a.nbTotalWaits * 100 -
        a.nbGoodTenpaiWaits
    );
    addTileStrTo9997(toCut, tile9997, 1);
  });
  return { shanten, ukeire: hairiExt };
}

export function getShantenInfo(
  handStr: string,
  ukeireDisplayType: UkeireChoice,
  locale: Locale,
  restictedTiles?: string
) {
  const closedHands = handStr.split(" ")[0];
  let handInfo: WaitInfo | undefined;
  let shanten = 0;

  if (ukeireDisplayType !== UkeireChoice.No) {
    handInfo = getWaitInfo(closedHands);
  } else {
    shanten = shantenCalc.syantenAll(fromStrToTile9997(handStr));
  }

  switch (ukeireDisplayType) {
    case UkeireChoice.Yes:
      return buildBasicUkeireInfo(handInfo!, restictedTiles);
    case UkeireChoice.Full:
      return buildFullUkeireInfo(handInfo!, locale, restictedTiles);
    default:
      return shanten > 0
        ? `${shanten}-shanten`
        : shanten === 1
          ? "Tenpai"
          : shanten === 0
            ? "Agari!"
            : "Shouhai/Tahai";
  }
}

function buildFullUkeireInfo(
  hairi: WaitInfo,
  locale: Locale,
  restictedTiles?: string
): string {
  const sb = [];
  const restrictedTileList = restictedTiles ? splitTiles(restictedTiles) : [];

  sb.push(`${hairi.shanten}-shanten`);
  let hasAtLeastOneGoodTenpai = false;
  hairi.ukeire.sort((a, b) => b.nbTotalWaits - a.nbTotalWaits);
  hairi.ukeire.forEach((discard) => {
    const discardTiles = splitTiles(discard.tile);
    if (
      restrictedTileList.length > 0 &&
      !discardTiles.some((t) => restrictedTileList.includes(t))
    ) {
      return;
    }
    const tileEmoji = getHandEmojis({
      hand: discard.tile,
    });
    hasAtLeastOneGoodTenpai =
      hasAtLeastOneGoodTenpai || discard.nbGoodTenpaiWaits > 0;
    const goodWaitTenpaiInfo =
      discard.nbGoodTenpaiWaits > 0 ? `(${discard.nbGoodTenpaiWaits}\\*)` : "";
    const goodTenpaiDraws = discard.waits
      .filter((w) => w.goodTenpai)
      .map((w) => w.tile)
      .join("");
    const badTenpaiDraws = discard.waits
      .filter((w) => !w.goodTenpai)
      .map((w) => w.tile)
      .join("");
    const goodTenpaiEmojis = getHandEmojis({
      hand: goodTenpaiDraws,
      sorted: true,
      unique: true,
    }).join("");
    const goodMark = goodTenpaiEmojis.length > 0 ? "\\*" : "";
    const badTenpaiEmojis = getHandEmojis({
      hand: badTenpaiDraws,
      sorted: true,
      unique: true,
    }).join("");
    const waitStr = `${tileEmoji}:\t ${discard.nbTotalWaits}${goodWaitTenpaiInfo}[${goodTenpaiEmojis}${goodMark}${badTenpaiEmojis}]`;
    sb.push(waitStr);
  });
  if (hasAtLeastOneGoodTenpai) {
    sb.push(localize(locale, strings.commands.common.shantenGoodWaitInfo));
  }
  return sb.join("\n");
}

function buildBasicUkeireInfo(
  hairi: WaitInfo,
  restictedTiles?: string
): string {
  const sb = [];
  const restrictedTileList = restictedTiles ? splitTiles(restictedTiles) : [];
  sb.push(`${hairi.shanten}-shanten\n`);
  hairi.ukeire.sort((a, b) => b.nbTotalWaits - a.nbTotalWaits);
  hairi.ukeire.forEach((discard) => {
    const discardTiles = splitTiles(discard.tile);
    if (
      restrictedTileList.length > 0 &&
      !discardTiles.some((t) => restrictedTileList.includes(t))
    ) {
      return;
    }
    const tileEmojis = getHandEmojis({
      hand: discard.tile,
    });
    const tileInfo =
      tileEmojis.length > 1 ? `[${tileEmojis.join("")}]` : tileEmojis[0];
    const waitStr = `${tileInfo}x${discard.nbTotalWaits} `;
    sb.push(waitStr);
  });
  return sb.join("");
}
