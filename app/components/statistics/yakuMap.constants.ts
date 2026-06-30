import { Han } from "~/types/Han";
import type { Translations } from "~/i18n/types";

/* ───────────────── Types ───────────────── */

export interface YakuMapColumn {
  id: string;
  name: string;
  teamName?: string;
  avatarUrl?: string;
}

export interface YakuMapData {
  columns: YakuMapColumn[];
  yakuCounts: Record<string, Record<string, number>>;
  totalRounds: Record<string, number>;
  totalGames: Record<string, number>;
}

/* ───────────────── Layout sizes ───────────────── */

export const CELL_SIZE = 32;
export const NAME_COL_WIDTH = 160;
export const TEAM_BAR_WIDTH = 24;
export const HEADER_HEIGHT = 120;

/* ───────────────── Easter egg ───────────────── */

export const EASTER_EGG_PLAYER_ID = "6985483f550ff3312d08f0cc";
export const EASTER_EGG_YAKU_ID = 59; // Hand_of_Man

/* ───────────────── Team colours ───────────────── */

export const TEAM_COLORS = [
  "#1677ff",
  "#52c41a",
  "#fa8c16",
  "#eb2f96",
  "#722ed1",
  "#13c2c2",
  "#faad14",
  "#f5222d",
  "#2f54eb",
  "#a0d911",
];

/* ───────────────── Han → i18n key mapping ───────────────── */

export const YAKU_KEY_MAP: Record<number, keyof Translations["yakuNames"]> = {
  [Han.Mangan_at_Draw]: "manganAtDraw",
  [Han.Fully_Concealed_Hand]: "fullyConcealedHand",
  [Han.Riichi]: "riichi",
  [Han.Robbing_a_Kan]: "robbingAKan",
  [Han.After_a_Kan]: "afterAKan",
  [Han.Under_the_Sea]: "underTheSea",
  [Han.Under_the_River]: "underTheRiver",
  [Han.White_Dragon]: "dragon",
  [Han.Green_Dragon]: "dragon",
  [Han.Red_Dragon]: "dragon",
  [Han.Seat_Wind]: "seatWind",
  [Han.Prevalent_Wind]: "prevalentWind",
  [Han.All_Simples]: "allSimples",
  [Han.Pure_Double_Sequence]: "pureDoubleSequence",
  [Han.Pinfu]: "pinfu",
  [Han.Half_Outside_Hand]: "halfOutsideHand",
  [Han.Pure_Straight]: "pureStraight",
  [Han.Mixed_Triple_Sequence]: "mixedTripleSequence",
  [Han.Double_Riichi]: "doubleRiichi",
  [Han.Triple_Triplets]: "tripleTriplets",
  [Han.Three_Quads]: "threeQuads",
  [Han.All_Triplets]: "allTriplets",
  [Han.Three_Concealed_Triplets]: "threeConcealedTriplets",
  [Han.Little_Three_Dragons]: "littleThreeDragons",
  [Han.All_Terminals_and_Honors]: "allTerminalsAndHonors",
  [Han.Seven_Pairs]: "sevenPairs",
  [Han.Fully_Outside_Hand]: "fullyOutsideHand",
  [Han.Half_Flush]: "halfFlush",
  [Han.Twice_Pure_Double_Sequence]: "twicePureDoubleSequence",
  [Han.Full_Flush]: "fullFlush",
  [Han.Ippatsu]: "ippatsu",
  [Han.Dora]: "dora",
  [Han.Red_Five]: "redFive",
  [Han.Ura_Dora]: "uraDora",
  [Han.Kita]: "kita",
  [Han.Blessing_of_Heaven]: "blessingOfHeaven",
  [Han.Blessing_of_Earth]: "blessingOfEarth",
  [Han.Big_Three_Dragons]: "bigThreeDragons",
  [Han.Four_Concealed_Triplets]: "fourConcealedTriplets",
  [Han.All_Honors]: "allHonors",
  [Han.All_Green]: "allGreen",
  [Han.All_Terminals]: "allTerminals",
  [Han.Thirteen_Orphans]: "thirteenOrphans",
  [Han.Four_Little_Winds]: "fourLittleWinds",
  [Han.Four_Quads]: "fourQuads",
  [Han.Nine_Gates]: "nineGates",
  [Han.Eight_time_East_Staying]: "eightTimeEastStaying",
  [Han.True_Nine_Gates]: "trueNineGates",
  [Han.Single_wait_Four_Concealed_Triplets]: "singleWaitFourConcealedTriplets",
  [Han.Thirteen_wait_Thirteen_Orphans]: "thirteenWaitThirteenOrphans",
  [Han.Four_Big_Winds]: "fourBigWinds",
  [Han.Tsubame_gaeshi]: "tsubameGaeshi",
  [Han.Kanburi]: "kanburi",
  [Han.Shiiaruraotai]: "shiiaruraotai",
  [Han.Uumensai]: "uumensai",
  [Han.Three_Chained_Triplets]: "threeChainedTriplets",
  [Han.Pure_Triple_Chow]: "pureTripleChow",
  [Han.Iipinmoyue]: "iipinmoyue",
  [Han.Chuupinraoyui]: "chuupinraoyui",
  [Han.Hand_of_Man]: "handOfMan",
  [Han.Big_Wheels]: "bigWheels",
  [Han.Bamboo_Forest]: "bambooForest",
  [Han.Numerous_Neighbours]: "numerousNeighbours",
  [Han.Ishinouenimosannen]: "ishinouenimosannen",
  [Han.Big_Seven_Stars]: "bigSevenStars",
};

/* ───────────────── Merge groups (e.g. 3 dragons → 1 row) ───────────────── */

export const MERGE_GROUPS: Record<number, number[]> = {
  [Han.White_Dragon]: [Han.White_Dragon, Han.Green_Dragon, Han.Red_Dragon],
};

export const MERGE_TARGET: Record<number, number> = {};
for (const [canonical, sources] of Object.entries(MERGE_GROUPS)) {
  for (const src of sources) {
    MERGE_TARGET[src] = Number(canonical);
  }
}
