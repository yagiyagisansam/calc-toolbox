/*
 * 部屋の広さから必要ルーメンを求める計算ロジック
 *
 * 根拠(一次情報):
 * - 一般社団法人 日本照明工業会「LED照明器具の適用畳数について」(ガイドA121:2023にもとづく)
 *   https://www.jlma.or.jp/led-navi/contents/cont22_LEDCeiling.htm (2026年7月29日参照)
 *   ・「定格光束は、机上面の目安照度である100 lx(ルクス)を基準とし75 lxから150 lxとした場合の
 *     光束(ルーメン)を示している」
 *   ・適用畳数のランクは 〜4.5畳 / 〜6畳 / 〜8畳 / 〜10畳 / 〜12畳 / 〜14畳
 *   ・16畳以上は照度均斉度を考慮し、1器具での畳数表示は設けない
 *   数値表は画像のため、同じ表を掲載している次のページで数値を確認した:
 *   - 三菱電機 FAQ「LED居室用シーリングの畳数にあわせた明るさ」(ガイドA121にもとづく下限値・上限値)
 *     https://faq01.mitsubishielectric.co.jp/faq/show/6067 (2026年7月29日参照)
 *   - 大光電機「『適用畳数』の表示基準」(標準定格光束と範囲)
 *     https://www2.lighting-daiko.co.jp/support/maintenance/tatami.html (2026年7月29日参照)
 * - 不動産公正取引協議会連合会「不動産の表示に関する公正競争規約・同施行規則」
 *   (畳1枚=1.62㎡の表示基準)
 *   https://www.rftc.jp/koseikyosokiyaku/ (2026年7月29日参照)
 *
 * 前提:
 * - LEDシーリングライト1器具を部屋の中央に付ける前提の目安。ダウンライトや間接照明の併用は含まない
 * - 目標照度による調整は「標準定格光束＝机上面100lx」の記述から比例計算したもの
 * - 天井高による補正は、光源から机上面(高さ0.7m)までの距離の逆二乗則で概算したもの。
 *   JLMAの適用畳数の基準に天井高の規定はないため、本ツール独自の目安である
 */
(function (global) {
  "use strict";

  var SQM_PER_JO = 1.62; // 不動産の表示に関する公正競争規約(畳1枚=1.62㎡)
  var MAX_RANK_JO = 14; // 1器具で畳数表示を設ける上限
  var BASE_LUX = 100; // 標準定格光束の基準となる机上面照度(lx)
  var BASE_CEILING_M = 2.4; // 本ツールが基準とする天井高(m)
  var DESK_HEIGHT_M = 0.7; // 本ツールが基準とする机上面の高さ(m)

  // 日本照明工業会 ガイドA121 の適用畳数と定格光束(lm)
  // [適用畳数, 標準定格光束, 下限値, 上限値]
  var RANKS = [
    [4.5, 2700, 2200, 3200],
    [6, 3200, 2700, 3700],
    [8, 3800, 3300, 4300],
    [10, 4400, 3900, 4900],
    [12, 5000, 4500, 5500],
    [14, 5600, 5100, 6100]
  ];

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function round1(v) { return Math.round(v * 10) / 10; }

  function rankFor(jo) {
    for (var i = 0; i < RANKS.length; i++) {
      if (jo <= RANKS[i][0]) return RANKS[i];
    }
    return RANKS[RANKS.length - 1];
  }

  /**
   * 部屋の広さ(畳)から、シーリングライトに必要な明るさ(lm)の目安を求める。
   * 14畳を超える場合は器具を分ける前提で、1器具あたりの畳数から求める。
   * @param {number} tatami 部屋の広さ(畳)。0超〜100
   * @returns {{ok:true, tatami:number, fixtures:number, perFixtureTatami:number,
   *            rankJo:number, standardLm:number, minLm:number, maxLm:number, overMax:boolean}
   *          |{ok:false, code:"invalid_tatami"}}
   *   standardLm は机上面100lxを目安とした標準定格光束、minLm/maxLm はそのランクの範囲。
   */
  function recommend(tatami) {
    if (!isFiniteNumber(tatami) || tatami <= 0 || tatami > 100) {
      return { ok: false, code: "invalid_tatami" };
    }
    var fixtures = tatami > MAX_RANK_JO ? Math.ceil(tatami / MAX_RANK_JO) : 1;
    var per = tatami / fixtures;
    var r = rankFor(per);
    return {
      ok: true,
      tatami: round1(tatami),
      fixtures: fixtures,
      perFixtureTatami: round1(per),
      rankJo: r[0],
      standardLm: r[1],
      minLm: r[2],
      maxLm: r[3],
      overMax: tatami > MAX_RANK_JO
    };
  }

  /**
   * 平方メートルから畳数に換算する(不動産広告の表示基準 1畳=1.62㎡)。
   * @param {number} squareMeters 部屋の面積(㎡)。0超〜200
   * @returns {{ok:true, tatami:number}|{ok:false, code:"invalid_area"}}
   *   tatami は小数第1位で四捨五入。
   */
  function fromSquareMeters(squareMeters) {
    if (!isFiniteNumber(squareMeters) || squareMeters <= 0 || squareMeters > 200) {
      return { ok: false, code: "invalid_area" };
    }
    return { ok: true, tatami: round1(squareMeters / SQM_PER_JO) };
  }

  /**
   * 天井が高い部屋の補正係数を求める(本ツール独自の目安)。
   * 光源から机上面(高さ0.7m)までの距離の逆二乗則で、天井高2.4mを1.00とする。
   * @param {number} ceilingHeightM 天井高(m)。1.5〜6
   * @returns {{ok:true, factor:number}|{ok:false, code:"invalid_ceiling"}}
   *   factor は小数第2位で四捨五入した倍率。
   */
  function ceilingFactor(ceilingHeightM) {
    if (!isFiniteNumber(ceilingHeightM) || ceilingHeightM < 1.5 || ceilingHeightM > 6) {
      return { ok: false, code: "invalid_ceiling" };
    }
    var base = BASE_CEILING_M - DESK_HEIGHT_M;
    var d = ceilingHeightM - DESK_HEIGHT_M;
    return { ok: true, factor: Math.round(((d * d) / (base * base)) * 100) / 100 };
  }

  /**
   * 目標照度と天井高を反映した必要光束を求める。
   * @param {number} tatami 部屋の広さ(畳)。0超〜100
   * @param {number} [targetLux=100] 机上面の目標照度(lx)。10〜1000
   * @param {number} [ceilingHeightM=2.4] 天井高(m)。1.5〜6
   * @returns {{ok:true, standardLm:number, requiredLm:number, luxFactor:number,
   *            ceilingFactor:number, fixtures:number, requiredPerFixtureLm:number}
   *          |{ok:false, code:"invalid_tatami"|"invalid_lux"|"invalid_ceiling"}}
   *   requiredLm は部屋全体で必要な光束(lm、10lm単位に四捨五入)。
   */
  function adjusted(tatami, targetLux, ceilingHeightM) {
    var lux = targetLux === undefined ? BASE_LUX : targetLux;
    var height = ceilingHeightM === undefined ? BASE_CEILING_M : ceilingHeightM;
    var base = recommend(tatami);
    if (!base.ok) return base;
    if (!isFiniteNumber(lux) || lux < 10 || lux > 1000) return { ok: false, code: "invalid_lux" };
    var cf = ceilingFactor(height);
    if (!cf.ok) return cf;
    var luxFactor = lux / BASE_LUX;
    var perFixture = base.standardLm * luxFactor * cf.factor;
    var total = perFixture * base.fixtures;
    return {
      ok: true,
      standardLm: base.standardLm,
      luxFactor: Math.round(luxFactor * 100) / 100,
      ceilingFactor: cf.factor,
      fixtures: base.fixtures,
      requiredPerFixtureLm: Math.round(perFixture / 10) * 10,
      requiredLm: Math.round(total / 10) * 10
    };
  }

  var api = {
    SQM_PER_JO: SQM_PER_JO,
    RANKS: RANKS,
    recommend: recommend,
    fromSquareMeters: fromSquareMeters,
    ceilingFactor: ceilingFactor,
    adjusted: adjusted
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.LumenCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
