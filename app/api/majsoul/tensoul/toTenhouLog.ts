/**
 * TypeScript port of Equim-chan's tensoul `convert.js`.
 * Source: https://github.com/Equim-chan/tensoul (MIT licensed).
 *
 * Converts a Mahjong Soul protobuf `GameRecord` (the same shape
 * `MahjongSoulConnector.getContestGameRecord` returns and that
 * `parseMajsoulReplay` consumes) into a tenhou.net/6 mjlog JSON.
 *
 * Only the conversion is ported here — fetching, CLI, HTTP server,
 * key-listening, and verbose dumping from upstream are intentionally
 * omitted. The companion `data.json` (also vendored from upstream)
 * provides yaku names, level names, and match-mode room names.
 *
 * Caveats inherited from upstream:
 *   - Only well-defined for standard ranked / friendly / contest
 *     games. Non-standard rules (xuezhan, dora-sanren, field-spell,
 *     etc.) are unsupported.
 *   - The output references `record.head.config.mode.detail_rule`
 *     fields; very old contests may not set them and will fall
 *     back to default red-five counts.
 */

import type { GameRecord, GameStepRecord } from "../data/types/GameRecord";
import cfg from "./data.json";

// ---------------------------------------------------------------------------
// Name preference. Upstream exposed this as a top-level toggle; we
// keep it as a module-level constant for now (Japanese is the only
// dialect tenhou.net/5 and akochan understand verbatim).
// ---------------------------------------------------------------------------
const JPNAME = 0;
type NameDialect = 0 | 1 | 2;
const NAMEPREF: NameDialect = JPNAME;

/** When true, emit fu/han even for limit hands. */
const SHOWFU = false;

const RUNES = {
  // hand limits
  mangan: ["満貫", "Mangan ", "Mangan "],
  haneman: ["跳満", "Haneman ", "Haneman "],
  baiman: ["倍満", "Baiman ", "Baiman "],
  sanbaiman: ["三倍満", "Sanbaiman ", "Sanbaiman "],
  yakuman: ["役満", "Yakuman ", "Yakuman "],
  kazoeyakuman: ["数え役満", "Kazoe Yakuman ", "Counted Yakuman "],
  kiriagemangan: ["切り上げ満貫", "Kiriage Mangan ", "Rounded Mangan "],
  // round enders
  agari: ["和了", "Agari", "Agari"],
  ryuukyoku: ["流局", "Ryuukyoku", "Exhaustive Draw"],
  nagashimangan: ["流し満貫", "Nagashi Mangan", "Mangan at Draw"],
  suukaikan: ["四開槓", "Suukaikan", "Four Kan Abortion"],
  sanchahou: ["三家和", "Sanchahou", "Three Ron Abortion"],
  kyuushukyuuhai: ["九種九牌", "Kyuushu Kyuuhai", "Nine Terminal Abortion"],
  suufonrenda: ["四風連打", "Suufon Renda", "Four Wind Abortion"],
  suuchariichi: ["四家立直", "Suucha Riichi", "Four Riichi Abortion"],
  // scoring
  fu: ["符", "符", "Fu"],
  han: ["飜", "飜", "Han"],
  points: ["点", "点", "Points"],
  all: ["∀", "∀", "∀"],
  pao: ["包", "pao", "Responsibility"],
  // rooms
  tonpuu: ["東喰", " East", " East"],
  hanchan: ["南喰", " South", " South"],
  friendly: ["友人戦", "Friendly", "Friendly"],
  tournament: ["大会戦", "Tounament", "Tournament"],
  sanma: ["三", "3-Player ", "3-Player "],
  red: ["赤", " Red", " Red Fives"],
  nored: ["", " Aka Nashi", " No Red Fives"],
} as const;

// senkinin barai yaku — please don't change, yostar.
const DAISANGEN = 37;
const DAISUUSHI = 50;

const TSUMOGIRI = 60;

let ALLOW_KIRIAGE = false;
let TSUMOLOSSOFF = false;

// ---------------------------------------------------------------------------
// Tile encoding helpers (mirror upstream).
// ---------------------------------------------------------------------------

const TILE_SUIT: Record<string, number> = { m: 1, p: 2, s: 3, z: 4 };

/** "2m" → 12; "0p" → 52 (aka 5 pin). */
function tm2t(str: string): number {
  const num = parseInt(str[0], 10);
  if (num) {
    return 10 * TILE_SUIT[str[1]] + num;
  }
  return 50 + TILE_SUIT[str[1]];
}

/** Return the non-aka version of a tile (52 → 25, 25 → 25). */
function deaka(til: number): number {
  if (Math.trunc(til / 10) === 5) {
    return 10 * (til % 10) + Math.trunc(til / 10);
  }
  return til;
}

/** Return the aka version of a tile (25 → 52, 52 → 52). */
function makeaka(til: number): number {
  if (til % 10 === 5) {
    return 10 * (til % 10) + Math.trunc(til / 10);
  }
  return til;
}

/** Right-pad `arr` to `len` with `fill`, in place; returns the same array. */
function padRight<T>(arr: T[], len: number, fill: T): T[] {
  while (arr.length < len) {
    arr.push(fill);
  }
  return arr;
}

/** Round up to the nearest hundred iff `TSUMOLOSSOFF`. */
function tlround(x: number): number {
  return TSUMOLOSSOFF ? 100 * Math.ceil(x / 100) : 0;
}

/** seat1 relative to seat0: 0=kamicha, 1=toimen, 2=shimocha (4-player). */
function relativeSeating(seat0: number, seat1: number): number {
  return (seat0 - seat1 + 4 - 1) % 4;
}

// ---------------------------------------------------------------------------
// Round state — upstream uses a single mutating `kyoku` namespace,
// which we model as a class with the same field names so the
// translation stays line-for-line auditable.
// ---------------------------------------------------------------------------

interface RawNewRound {
  scores: number[];
  chang: number;
  ju: number;
  ben: number;
  liqibang: number;
  dora?: string;
  doras?: string[];
  tiles0: string[];
  tiles1: string[];
  tiles2: string[];
  tiles3: string[];
}

const WINDS = ["1z", "2z", "3z", "4z"].map((e) => tm2t(e));
// `0z` would be aka haku — upstream encodes the four dragons as 5z/6z/7z/0z.
const DRAGS = ["5z", "6z", "7z", "0z"].map((e) => tm2t(e));

class Kyoku {
  nplayers = 0;
  round: [number, number, number] = [0, 0, 0];
  initscores: number[] = [];
  doras: number[] = [];
  draws: Array<Array<number | string>> = [[], [], [], []];
  discards: Array<Array<number | string>> = [[], [], [], []];
  haipais: number[][] = [[], [], [], []];
  poppedtile = 0;
  dealerseat = 0;
  ldseat = -1;
  nriichi = 0;
  priichi = false;
  nkan = 0;
  nowinds = [0, 0, 0, 0];
  nodrags = [0, 0, 0, 0];
  paowind = -1;
  paodrag = -1;

  init(leaf: RawNewRound): void {
    this.nplayers = leaf.scores.length;
    this.round = [4 * leaf.chang + leaf.ju, leaf.ben, leaf.liqibang];
    this.initscores = leaf.scores.slice();
    padRight(this.initscores, 4, 0);
    this.doras = leaf.dora
      ? [tm2t(leaf.dora)]
      : (leaf.doras ?? []).map((e) => tm2t(e));
    this.draws = [[], [], [], []];
    this.discards = [[], [], [], []];
    // Snapshot starting hands per seat (0..3). Missing slots in
    // sanma return empty arrays, matching upstream's behaviour.
    this.haipais = [0, 1, 2, 3].map((i) => {
      const key = ("tiles" + i) as "tiles0" | "tiles1" | "tiles2" | "tiles3";
      return (leaf[key] ?? []).map((f) => tm2t(f));
    });
    // Treat the dealer's 14th tile as a drawn tile.
    const popped = this.haipais[leaf.ju].pop();
    this.poppedtile = popped ?? 0;
    if (popped !== undefined) {
      this.draws[leaf.ju].push(popped);
    }
    this.dealerseat = leaf.ju;
    this.ldseat = -1;
    this.nriichi = 0;
    this.priichi = false;
    this.nkan = 0;
    this.nowinds = [0, 0, 0, 0];
    this.nodrags = [0, 0, 0, 0];
    this.paowind = -1;
    this.paodrag = -1;
  }

  dump(uras: number[]): unknown[] {
    const entry: unknown[] = [];
    entry.push(this.round);
    entry.push(this.initscores);
    entry.push(this.doras);
    entry.push(uras);
    this.haipais.forEach((f, i) => {
      entry.push(f);
      entry.push(this.draws[i]);
      entry.push(this.discards[i]);
    });
    return entry;
  }

  /** Increment wind/dragon counters; flag pao when the triplet completes. */
  countpao(tile: number, owner: number, feeder: number): void {
    if (WINDS.includes(tile)) {
      this.nowinds[owner] += 1;
      if (this.nowinds[owner] === 4) {
        this.paowind = feeder;
      }
    } else if (DRAGS.includes(tile)) {
      this.nodrags[owner] += 1;
      if (this.nodrags[owner] === 3) {
        this.paodrag = feeder;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Hule (agari) parsing — produces the tenhou-style two-element
// row: [point-delta array, agari-detail array].
// ---------------------------------------------------------------------------

interface RawHule {
  seat: number;
  zimo: boolean;
  yiman: boolean;
  qinjia: boolean;
  count: number;
  fu: number;
  point_zimo_xian: number;
  point_zimo_qin: number;
  point_rong: number;
  fans: Array<{ id: number; val: number }>;
  li_doras?: string[];
}

function parsehule(
  h: RawHule,
  kyoku: Kyoku,
  isHeadBump: boolean
): [number[], Array<number | string>] {
  const res: Array<number | string> = [
    h.seat,
    h.zimo ? h.seat : kyoku.ldseat,
    h.seat,
  ];
  let delta: number[] = [];
  let points: number | string = 0;
  const rp = isHeadBump ? 1000 * (kyoku.nriichi + kyoku.round[2]) : 0;
  const hb = isHeadBump ? 100 * kyoku.round[1] : 0;

  let pao = false;
  let liableseat = -1;
  let liablefor = 0;

  if (h.yiman) {
    for (const e of h.fans) {
      if (e.id === DAISUUSHI && kyoku.paowind !== -1) {
        pao = true;
        liableseat = kyoku.paowind;
        liablefor += e.val;
      } else if (e.id === DAISANGEN && kyoku.paodrag !== -1) {
        pao = true;
        liableseat = kyoku.paodrag;
        liablefor += e.val;
      }
    }
  }

  if (h.zimo) {
    delta = new Array(kyoku.nplayers).fill(
      -hb - h.point_zimo_xian - tlround((1 / 2) * h.point_zimo_xian)
    );
    if (h.seat === kyoku.dealerseat) {
      delta[h.seat] =
        rp +
        (kyoku.nplayers - 1) * (hb + h.point_zimo_xian) +
        2 * tlround((1 / 2) * h.point_zimo_xian);
      points = h.point_zimo_xian + tlround((1 / 2) * h.point_zimo_xian);
    } else {
      delta[h.seat] =
        rp +
        hb +
        h.point_zimo_qin +
        (kyoku.nplayers - 2) * (hb + h.point_zimo_xian) +
        2 * tlround((1 / 2) * h.point_zimo_xian);
      delta[kyoku.dealerseat] =
        -hb - h.point_zimo_qin - tlround((1 / 2) * h.point_zimo_xian);
      points = h.point_zimo_xian + "-" + h.point_zimo_qin;
    }
  } else {
    delta = new Array(kyoku.nplayers).fill(0);
    delta[h.seat] = rp + (kyoku.nplayers - 1) * hb + h.point_rong;
    delta[kyoku.ldseat] = -(kyoku.nplayers - 1) * hb - h.point_rong;
    points = h.point_rong;
  }

  // sekinin barai (pao) payments
  const OYA = 0;
  const KO = 1;
  const RON = 2;
  const YSCORE = [
    // oya, ko, ron pays
    [0, 16000, 48000], // oya wins
    [16000, 8000, 32000], // ko  wins
  ];

  if (pao) {
    res[2] = liableseat;
    if (h.zimo) {
      if (h.qinjia) {
        // dealer tsumo
        delta[liableseat] -=
          2 * hb +
          liablefor * 2 * YSCORE[OYA][KO] +
          tlround((1 / 2) * liablefor * YSCORE[OYA][KO]);
        delta.forEach((_e, i) => {
          if (liableseat !== i && h.seat !== i && kyoku.nplayers >= i) {
            delta[i] +=
              hb +
              liablefor * YSCORE[OYA][KO] +
              tlround((1 / 2) * liablefor * YSCORE[OYA][KO]);
          }
        });
        if (kyoku.nplayers === 3) {
          delta[h.seat] += TSUMOLOSSOFF ? 0 : liablefor * YSCORE[OYA][KO];
        }
      } else {
        // non-dealer tsumo
        delta[liableseat] -=
          (kyoku.nplayers - 2) * hb +
          liablefor * (YSCORE[KO][OYA] + YSCORE[KO][KO]) +
          tlround((1 / 2) * liablefor * YSCORE[KO][KO]);
        delta.forEach((_e, i) => {
          if (liableseat !== i && h.seat !== i && kyoku.nplayers >= i) {
            if (kyoku.dealerseat === i) {
              delta[i] +=
                hb +
                liablefor * YSCORE[KO][OYA] +
                tlround((1 / 2) * liablefor * YSCORE[KO][KO]);
            } else {
              delta[i] +=
                hb +
                liablefor * YSCORE[KO][KO] +
                tlround((1 / 2) * liablefor * YSCORE[KO][KO]);
            }
          }
        });
      }
    } else {
      // ron — liable seat pays the deal-in seat 1/2 yakuman + full honba
      delta[liableseat] -=
        (kyoku.nplayers - 1) * hb +
        (1 / 2) * liablefor * YSCORE[h.qinjia ? OYA : KO][RON];
      delta[kyoku.ldseat] +=
        (kyoku.nplayers - 1) * hb +
        (1 / 2) * liablefor * YSCORE[h.qinjia ? OYA : KO][RON];
    }
  }

  points = `${points}${RUNES.points[JPNAME]}${h.zimo && h.qinjia ? RUNES.all[NAMEPREF] : ""}`;

  const fuhan = h.fu + RUNES.fu[NAMEPREF] + h.count + RUNES.han[NAMEPREF];
  if (h.yiman) {
    res.push((SHOWFU ? fuhan : "") + RUNES.yakuman[NAMEPREF] + points);
  } else if (h.count >= 13) {
    res.push((SHOWFU ? fuhan : "") + RUNES.kazoeyakuman[NAMEPREF] + points);
  } else if (h.count >= 11) {
    res.push((SHOWFU ? fuhan : "") + RUNES.sanbaiman[NAMEPREF] + points);
  } else if (h.count >= 8) {
    res.push((SHOWFU ? fuhan : "") + RUNES.baiman[NAMEPREF] + points);
  } else if (h.count >= 6) {
    res.push((SHOWFU ? fuhan : "") + RUNES.haneman[NAMEPREF] + points);
  } else if (
    h.count >= 5 ||
    (h.count >= 4 && h.fu >= 40) ||
    (h.count >= 3 && h.fu >= 70)
  ) {
    res.push((SHOWFU ? fuhan : "") + RUNES.mangan[NAMEPREF] + points);
  } else if (
    ALLOW_KIRIAGE &&
    ((h.count === 4 && h.fu === 30) || (h.count === 3 && h.fu === 60))
  ) {
    res.push((SHOWFU ? fuhan : "") + RUNES.kiriagemangan[NAMEPREF] + points);
  } else {
    res.push(fuhan + points);
  }

  const fanMap = (cfg as any).fan.fan.map_ as Record<
    string,
    { name_jp: string; name_en: string }
  >;
  // Tenhou yaku names for seat/round wind embed the wind tile
  // (e.g. "自風 東", "場風 南"). Mahjong Soul reports them as the
  // generic "役牌:自風牌" / "役牌:場風牌", which downstream
  // tooling (NAGA, akochan, ...) doesn't recognize. Translate.
  const WINDS_JP = ["東", "南", "西", "北"] as const;
  const SEAT_WIND_FAN_ID = 10;
  const ROUND_WIND_FAN_ID = 11;
  const seatWind = WINDS_JP[(h.seat - kyoku.dealerseat + 4) % 4];
  const roundWind = WINDS_JP[Math.floor(kyoku.round[0] / 4) % 4];
  for (const e of h.fans) {
    const entry = fanMap[String(e.id)];
    let yakuName = entry
      ? NAMEPREF === JPNAME
        ? entry.name_jp
        : entry.name_en
      : `fan:${e.id}`;
    if (NAMEPREF === JPNAME) {
      if (e.id === SEAT_WIND_FAN_ID) {
        yakuName = `自風 ${seatWind}`;
      } else if (e.id === ROUND_WIND_FAN_ID) {
        yakuName = `場風 ${roundWind}`;
      }
    }
    res.push(
      yakuName +
        "(" +
        (h.yiman ? RUNES.yakuman[JPNAME] : e.val + RUNES.han[JPNAME]) +
        ")"
    );
  }

  return [padRight(delta, 4, 0), res];
}

// ---------------------------------------------------------------------------
// Main record loop.
// ---------------------------------------------------------------------------

function generatelog(mjslog: ReadonlyArray<GameStepRecord>): unknown[] {
  const log: unknown[] = [];
  const kyoku = new Kyoku();

  mjslog.forEach((e: any, leafidx: number) => {
    const name = e?.constructor?.name as string | undefined;
    switch (name) {
      case "RecordNewRound": {
        kyoku.init(e as RawNewRound);
        return;
      }

      case "RecordDiscardTile": {
        let symbol: number | string = e.moqie ? TSUMOGIRI : tm2t(e.tile);

        // First-discard tsumogiri check: we pretended the dealer's
        // 14th tile is drawn, so compare against the popped tile.
        if (
          e.seat === kyoku.dealerseat &&
          kyoku.discards[e.seat].length === 0 &&
          symbol === kyoku.poppedtile
        ) {
          symbol = TSUMOGIRI;
        }

        if (e.is_liqi) {
          kyoku.priichi = true;
          symbol = "r" + symbol;
        }
        kyoku.discards[e.seat].push(symbol);
        kyoku.ldseat = e.seat;

        if (e.doras && e.doras.length > kyoku.doras.length) {
          kyoku.doras = (e.doras as string[]).map((f) => tm2t(f));
        }
        return;
      }

      case "RecordDealTile": {
        if (kyoku.priichi) {
          kyoku.priichi = false;
          kyoku.nriichi += 1;
        }

        if (e.doras && e.doras.length > kyoku.doras.length) {
          kyoku.doras = (e.doras as string[]).map((f) => tm2t(f));
        }

        kyoku.draws[e.seat].push(tm2t(e.tile));
        return;
      }

      case "RecordChiPengGang": {
        if (kyoku.priichi) {
          kyoku.priichi = false;
          kyoku.nriichi += 1;
        }

        switch (e.type) {
          case 0: {
            // chii
            kyoku.draws[e.seat].push(
              "c" + tm2t(e.tiles[2]) + tm2t(e.tiles[0]) + tm2t(e.tiles[1])
            );
            return;
          }
          case 1: {
            // pon
            const worktiles: Array<number | string> = (e.tiles as string[]).map(
              (f) => tm2t(f)
            );
            const idx = relativeSeating(e.seat, kyoku.ldseat);
            kyoku.countpao(worktiles[0] as number, e.seat, kyoku.ldseat);
            const last = worktiles.pop() as number;
            worktiles.splice(idx, 0, "p" + last);
            kyoku.draws[e.seat].push(worktiles.join(""));
            return;
          }
          case 2: {
            // daiminkan
            const calltiles: Array<number | string> = (e.tiles as string[]).map(
              (f) => tm2t(f)
            );
            const idx = relativeSeating(e.seat, kyoku.ldseat);
            kyoku.countpao(calltiles[0] as number, e.seat, kyoku.ldseat);
            const last = calltiles.pop() as number;
            calltiles.splice(idx === 2 ? 3 : idx, 0, "m" + last);
            kyoku.draws[e.seat].push(calltiles.join(""));
            // tenhou drops a 0 in discards for daiminkan
            kyoku.discards[e.seat].push(0);
            kyoku.nkan += 1;
            return;
          }
          default: {
            console.log(
              `tensoul: didn't know what to do with ${name}(${leafidx})`
            );
            return;
          }
        }
      }

      case "RecordAnGangAddGang": {
        let til = tm2t(e.tiles);
        kyoku.ldseat = e.seat;
        switch (e.type) {
          case 3: {
            // ankan
            kyoku.countpao(til, e.seat, -1);
            const ankantiles: number[] = kyoku.haipais[e.seat]
              .filter((t) => deaka(t) === deaka(til))
              .concat(
                kyoku.draws[e.seat].filter(
                  (t): t is number =>
                    typeof t === "number" && deaka(t) === deaka(til)
                )
              );
            til = ankantiles.pop() ?? til;
            kyoku.discards[e.seat].push(ankantiles.join("") + "a" + til);
            kyoku.nkan += 1;
            return;
          }
          case 2: {
            // shouminkan
            const nakis = kyoku.draws[e.seat].filter((w) => {
              if (typeof w === "string") {
                return (
                  w.includes("p" + deaka(til)) || w.includes("p" + makeaka(til))
                );
              }
              return false;
            }) as string[];
            kyoku.discards[e.seat].push(nakis[0].replace(/p/, "k" + til));
            kyoku.nkan += 1;
            return;
          }
          default: {
            console.log(
              `tensoul: didn't know what to do with ${name} type: ${e.type}`
            );
            return;
          }
        }
      }

      case "RecordBaBei": {
        // kita (sanma north). Tenhou doesn't tag based on draw
        // origin, so neither do we — just remember the seat for
        // potential ron-on-kita resolution.
        kyoku.ldseat = e.seat;
        return;
      }

      case "RecordLiuJu": {
        // abortion
        if (kyoku.priichi) {
          kyoku.priichi = false;
          kyoku.nriichi += 1;
        }

        const entry = kyoku.dump([]);

        if (e.type === 1) {
          entry.push([RUNES.kyuushukyuuhai[NAMEPREF]]);
        } else if (e.type === 2) {
          entry.push([RUNES.suufonrenda[NAMEPREF]]);
        } else if (kyoku.nriichi === 4) {
          entry.push([RUNES.suuchariichi[NAMEPREF]]);
        } else if (kyoku.nkan >= 4) {
          entry.push([RUNES.suukaikan[NAMEPREF]]);
        } else {
          entry.push([RUNES.sanchahou[NAMEPREF]]);
        }

        log.push(entry);
        return;
      }

      case "RecordNoTile": {
        // ryuukyoku
        const entry = kyoku.dump([]);
        const delta = [0, 0, 0, 0];

        if (
          e.scores &&
          e.scores[0] &&
          e.scores[0].delta_scores &&
          e.scores[0].delta_scores.length
        ) {
          (e.scores as Array<{ delta_scores: number[] }>).forEach((f) =>
            f.delta_scores.forEach((g, i) => {
              delta[i] += g;
            })
          );
        }

        if (e.liujumanguan) {
          entry.push([RUNES.nagashimangan[NAMEPREF], delta]);
        } else {
          entry.push([RUNES.ryuukyoku[NAMEPREF], delta]);
        }
        log.push(entry);
        return;
      }

      case "RecordHule": {
        const agari: Array<[number[], Array<number | string>]> = [];
        let ura: number[] = [];
        let isHeadBump = true;
        (e.hules as RawHule[]).forEach((f) => {
          const liDoras = f.li_doras ?? [];
          if (ura.length < liDoras.length) {
            ura = liDoras.map((g) => tm2t(g));
          }
          agari.push(parsehule(f, kyoku, isHeadBump));
          isHeadBump = false;
        });
        const entry = kyoku.dump(ura);
        entry.push([RUNES.agari[JPNAME], ...agari.flat()]);
        log.push(entry);
        return;
      }

      default: {
        console.log(
          `tensoul: didn't know what to do with ${name ?? "<unknown>"}(${leafidx})`
        );
        return;
      }
    }
  });

  return log;
}

// ---------------------------------------------------------------------------
// Top-level convert — assembles the tenhou JSON envelope.
// ---------------------------------------------------------------------------

/**
 * Minimal tenhou.net/5 viewer JSON shape — the only envelope this
 * codebase actually consumes (via `#json=…` viewer URLs and the
 * "Export for Naga" flow). Each entry in `log` is a 17-tuple
 * produced by `generatelog` above.
 */
export interface Tenhou5Json {
  title: [string, string];
  name: [string, string, string, string];
  rule: { aka: number };
  log: unknown[];
}

/**
 * Convert a Mahjong Soul protobuf `GameRecord` directly to the
 * minimal tenhou.net/5 viewer JSON. Pure function; resets
 * module-level state (`ALLOW_KIRIAGE`, `TSUMOLOSSOFF`) for each
 * call.
 *
 * The intermediate "full mjlog" (with `ver`, `ref`, `dan`, `rate`,
 * `sx`, `sc`, `disp`, …) is no longer materialized — the only
 * fields the tenhou.net/5 viewer / Naga export need are `title`,
 * `name`, `rule.aka` and the per-round `log` array.
 */
export function toTenhou5Json(record: GameRecord): Tenhou5Json {
  // Reset module-level state in case toTenhou5Json is called more
  // than once in the same process.
  ALLOW_KIRIAGE = false;
  TSUMOLOSSOFF = false;

  if (!record.head) {
    throw new Error("Majsoul GameRecord missing `head` envelope.");
  }
  const head = record.head;
  if (!head.result || !head.config || !head.accounts || !head.result.players) {
    throw new Error("Majsoul GameRecord head missing result/config/accounts.");
  }

  const nplayers = head.result.players.length;
  const mjslog = (record.records ?? []) as GameStepRecord[];

  let ruledisp = "";
  let lobby: string | number = "";

  const meta = head.config.meta ?? {};
  const modeConfig = head.config.mode ?? ({} as any);
  const detailRule = modeConfig.detail_rule ?? ({} as any);

  if (nplayers === 3 && NAMEPREF === JPNAME) {
    ruledisp += RUNES.sanma[JPNAME];
  }

  if (meta.mode_id) {
    const modeMap = (cfg as any).desktop.matchmode.map_ as Record<
      string,
      { room_name_jp: string; room_name_en: string }
    >;
    const m = modeMap[String(meta.mode_id)];
    if (m) {
      ruledisp += NAMEPREF === JPNAME ? m.room_name_jp : m.room_name_en;
    }
  } else if (meta.room_id) {
    lobby = ": " + meta.room_id;
    ruledisp += RUNES.friendly[NAMEPREF];
    TSUMOLOSSOFF = nplayers === 3 ? !detailRule.have_zimosun : false;
  } else if (meta.contest_uid) {
    lobby = ": " + meta.contest_uid;
    ruledisp += RUNES.tournament[NAMEPREF];
    TSUMOLOSSOFF = nplayers === 3 ? !detailRule.have_zimosun : false;
  }

  if (modeConfig.mode === 1 || modeConfig.mode === 11) {
    ruledisp += RUNES.tonpuu[NAMEPREF];
  } else if (modeConfig.mode === 2 || modeConfig.mode === 12) {
    ruledisp += RUNES.hanchan[NAMEPREF];
  }

  // Red-fives are enabled iff the mode is a ranked room (`mode_id`)
  // or the friendly/contest room explicitly sets a dora count.
  const hasAka = Boolean(meta.mode_id || detailRule.dora_count);
  if (!hasAka && NAMEPREF !== JPNAME) {
    ruledisp += RUNES.nored[NAMEPREF];
  } else if (hasAka && NAMEPREF === JPNAME) {
    ruledisp += RUNES.red[JPNAME];
  }

  const name: [string, string, string, string] = ["AI", "AI", "AI", "AI"];
  head.accounts.forEach((acc: any) => {
    if (typeof acc.seat === "number" && acc.seat >= 0 && acc.seat < 4) {
      name[acc.seat as 0 | 1 | 2 | 3] = acc.nickname ?? "AI";
    }
  });
  if (nplayers === 3) {
    name[3] = "";
  }

  const endTimeSec =
    typeof head.end_time === "number" ? head.end_time : Number(head.end_time);
  const endTimeMs = (Number.isFinite(endTimeSec) ? endTimeSec : 0) * 1000;

  return {
    title: [
      String(ruledisp) + String(lobby),
      new Date(endTimeMs).toUTCString(),
    ],
    name,
    rule: { aka: hasAka ? 1 : 0 },
    log: generatelog(mjslog),
  };
}
