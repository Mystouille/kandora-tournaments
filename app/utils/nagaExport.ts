/**
 * Helpers for the "Export for Naga review" section.
 *
 * Given a tenhou.net/5-shaped log (the output of `toTenhou5Json` on
 * the `/api/replay-tenhou-log?format=net5` endpoint), produces:
 *
 *   - A human-readable label per round (kyoku string + outcome
 *     summary) for the multi-select dropdown.
 *   - A single-round tenhou.net/5 viewer URL for clipboard export.
 *
 * Pure / browser-safe — no server imports.
 */

export interface Tenhou5LogShape {
  title: [string, string];
  name: [string, string, string, string];
  rule: { aka: number };
  log: unknown[];
}

export interface NagaRoundLabels {
  /** Localized "ron"/"tsumo" templates etc. */
  ron: string; // "{winner} ron {score}"
  tsumo: string; // "{winner} tsumo {score}"
  draw: string;
  nagashiMangan: string;
  kyuushuKyuuhai: string;
  suufonRenda: string;
  suuchaRiichi: string;
  suukaikan: string;
  sanchahou: string;
  unknown: string;
}

/**
 * Tenhou kyoku index → short label (E1..N4, including sanma West).
 * `idx` is `round[0][0]` from a tenhou log; honba is `round[0][1]`.
 */
function kyokuLabel(idx: number, honba: number): string {
  const winds = ["E", "S", "W", "N"];
  const wind = winds[Math.floor(idx / 4)] ?? "?";
  const seat = (idx % 4) + 1;
  const base = `${wind}${seat}`;
  return honba > 0 ? `${base}+${honba}` : base;
}

/** Pull the winner→loser agari tuple out of the "和了" result. */
function readAgari(result: unknown[]): {
  winner: number;
  from: number;
  score: string;
} | null {
  // result = ["和了", deltaArr, agariArr, deltaArr2, agariArr2, ...]
  const agari = result[2];
  if (!Array.isArray(agari) || agari.length < 4) {
    return null;
  }
  const winner = typeof agari[0] === "number" ? agari[0] : -1;
  const from = typeof agari[1] === "number" ? agari[1] : -1;
  const score = typeof agari[3] === "string" ? agari[3] : "";
  if (winner < 0 || from < 0) {
    return null;
  }
  return { winner, from, score };
}

export function formatNagaRoundLabel(
  round: unknown,
  names: ReadonlyArray<string>,
  labels: NagaRoundLabels
): string {
  if (!Array.isArray(round) || round.length < 17) {
    return labels.unknown;
  }
  const meta = round[0];
  const result = round[16];
  if (!Array.isArray(meta) || !Array.isArray(result)) {
    return labels.unknown;
  }
  const kyoku = typeof meta[0] === "number" ? meta[0] : 0;
  const honba = typeof meta[1] === "number" ? meta[1] : 0;
  const prefix = kyokuLabel(kyoku, honba);

  const tag = typeof result[0] === "string" ? result[0] : "";
  let outcome: string;

  switch (tag) {
    case "和了": {
      const a = readAgari(result);
      if (!a) {
        outcome = labels.unknown;
        break;
      }
      const winner = names[a.winner] || `P${a.winner + 1}`;
      const tmpl = a.winner === a.from ? labels.tsumo : labels.ron;
      outcome = tmpl
        .replace("{winner}", winner)
        .replace("{score}", a.score || "");
      break;
    }
    case "流局":
      outcome = labels.draw;
      break;
    case "流し満貫":
      outcome = labels.nagashiMangan;
      break;
    case "九種九牌":
      outcome = labels.kyuushuKyuuhai;
      break;
    case "四風連打":
      outcome = labels.suufonRenda;
      break;
    case "四家立直":
      outcome = labels.suuchaRiichi;
      break;
    case "四開槓":
      outcome = labels.suukaikan;
      break;
    case "三家和":
      outcome = labels.sanchahou;
      break;
    default:
      outcome = labels.unknown;
  }

  return `${prefix} — ${outcome}`;
}

/**
 * Build a tenhou.net/5 viewer URL containing just the round at
 * `roundIndex` from the full log envelope.
 */
export function buildNagaRoundUrl(
  log: Tenhou5LogShape,
  roundIndex: number
): string {
  const round = log.log[roundIndex];
  if (round === undefined) {
    throw new Error(`Round index ${roundIndex} out of range`);
  }
  const single: Tenhou5LogShape = {
    title: log.title,
    name: log.name,
    rule: log.rule,
    log: [round],
  };
  return `https://tenhou.net/5/#json=${encodeURIComponent(JSON.stringify(single))}`;
}
