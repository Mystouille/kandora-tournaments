import type { Translations } from "../../i18n/types";

/** Card IDs shown in the main "Rankings" tab */
export const DEFAULT_CARD_ORDER = [
  "winRate",
  "avgWinValue",
  "tsumoRate",
  "dealInRate",
  "avgDealInValue",
  "callRate",
] as const;

/** Card IDs shown in the "More Rankings" tab */
export const MORE_DEFAULT_CARD_ORDER = [
  "dora",
  "uraDora",
  "han",
  "fu",
  "ryuukyoku",
  "calls",
  "tenpaiTurn",
] as const;

/** Build localised card labels for the main "Rankings" tab */
export function getCardLabels(t: Translations): Record<string, string> {
  return {
    winRate: t.statistics.winRateRankingTitle,
    avgWinValue: t.statistics.avgWinValueRankingTitle,
    tsumoRate: t.statistics.tsumoRateRankingTitle,
    dealInRate: t.statistics.dealInRateRankingTitle,
    avgDealInValue: t.statistics.avgDealInValueRankingTitle,
    callRate: t.statistics.callRateRankingTitle,
  };
}

/** Build localised card labels for the "More Rankings" tab */
export function getMoreCardLabels(t: Translations): Record<string, string> {
  return {
    dora: t.statistics.doraRankingTitle,
    uraDora: t.statistics.uraDoraRankingTitle,
    han: t.statistics.hanRankingTitle,
    fu: t.statistics.fuRankingTitle,
    ryuukyoku: t.statistics.ryuukyokuRankingTitle,
    calls: t.statistics.callsRankingTitle,
    tenpaiTurn: t.statistics.tenpaiTurnRankingTitle,
  };
}

// ---- localStorage keys ----
export const LS_ORDER_KEY = "kandora_card_order";
export const LS_HIDDEN_KEY = "kandora_card_hidden";
export const LS_LEAGUE_KEY = "kandora_selected_league";
export const LS_LEAGUE_FILTERS_KEY = "kandora_league_filters";
export const LS_MORE_ORDER_KEY = "kandora_more_card_order";
export const LS_MORE_HIDDEN_KEY = "kandora_more_card_hidden";
