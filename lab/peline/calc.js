/*
 * 釣り糸(ライン)の 号数 ⇔ ポンド(lb) ⇔ 標準直径(mm) 換算ロジック
 *
 * 基準の時点: 2026年7月時点。換算表は日本釣用品工業会(JAFTMA)の標準規格を参考にした
 *            TSURI HACK の一覧表(2022年10月20日更新)による。
 *
 * 根拠(一次情報に近い出典):
 * - TSURI HACK「釣り糸(ライン)の号数とポンドについて。太さの規格について正しく知ろう!(換算表付き)」
 *   https://tsurihack.com/2746 (2026年7月29日参照)
 *   ・「※換算の数値の太さは、日本釣用品工業会(JAFTMA)が定めている標準規格を参考にしています。」
 *   ・ナイロン・フロロカーボン・エステルの換算表(0.25号〜20号)
 *     例: 1号 = 1.814kg = 4lb = 0.165mm、2号 = 8lb = 0.235mm、5号 = 20lb = 0.370mm
 *   ・PEラインの換算表(0.1号〜10号)
 *     例: 1号 = 20lb = 0.171mm(200デニール)、2号 = 40lb = 0.242mm
 *   ・「号とは、"釣り糸(ライン)の太さ"の単位」であり、強度の単位ではない
 *   ・PEラインの太さはデニールが標準規格で、「太さはメーカーにより異なり、
 *     4本・8本撚りなどでも誤差があります」
 *   ・強度の目安: ナイロン・フロロは 1号 ≒ 4ポンド。
 *     PEは「2.5号までは×20ポンド。3〜6号は×15ポンド」で概算できるが、メーカー・編み本数で異なる
 * - 1ポンド = 0.45359237キログラム(国際ヤード・ポンド。計量法でも同じ値)
 *
 * 前提:
 * - 号数は本来「太さ」の単位であり、強度(lb・kg)との対応はあくまで規格上の目安。
 *   実際の強力は製品ごとに異なる。特にPEは編み本数・製法で大きく変わる。
 * - 表に載っていない号数・ポンド数は、隣り合う2点から補間する。
 *   直径は「直径の二乗が号数に比例する」性質(断面積が号数に比例する)を使って補間する。
 * - kg は lb × 0.45359237 で計算する。出典の表の kg 値は丸め方が一定でないため、
 *   数g程度の差が出ることがある。
 * - 丸めは、号数は小数第2位、ポンドは小数第1位、kgは小数第3位、直径は小数第3位(いずれも四捨五入)。
 */
(function (global) {
  "use strict";

  var LB_TO_KG = 0.45359237;

  /* ナイロン・フロロカーボン・エステル: [号数, ポンド(lb), 標準直径(mm)] */
  var NYLON = [
    [0.25, 1, 0.083], [0.3, 1.2, 0.090], [0.4, 1.6, 0.104], [0.5, 2, 0.116],
    [0.6, 2.4, 0.128], [0.8, 3, 0.148], [1, 4, 0.165], [1.2, 4.8, 0.185],
    [1.5, 6, 0.205], [1.75, 7, 0.220], [2, 8, 0.235], [2.25, 9, 0.248],
    [2.5, 10, 0.260], [2.75, 11, 0.274], [3, 12, 0.285], [3.5, 14, 0.310],
    [4, 16, 0.330], [5, 20, 0.370], [6, 22, 0.405], [7, 25, 0.435],
    [8, 28, 0.470], [10, 35, 0.520], [12, 40, 0.570], [14, 45, 0.620],
    [16, 50, 0.660], [18, 55, 0.700], [20, 60, 0.740]
  ];

  /* PEライン: [号数, ポンド(lb), 標準直径(mm)] */
  var PE = [
    [0.1, 4, 0.054], [0.15, 4.5, 0.066], [0.2, 5, 0.076], [0.3, 6, 0.094],
    [0.4, 8, 0.108], [0.5, 10, 0.121], [0.6, 12, 0.132], [0.8, 16, 0.153],
    [1, 20, 0.171], [1.2, 24, 0.191], [1.5, 30, 0.209], [1.7, 34, 0.219],
    [2, 40, 0.242], [2.5, 50, 0.270], [3, 55, 0.296], [4, 60, 0.342],
    [5, 80, 0.382], [6, 90, 0.418], [8, 100, 0.483], [10, 130, 0.540]
  ];

  var TABLES = { nylon: NYLON, fluoro: NYLON, pe: PE };

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }
  function round(v, digits) {
    var f = Math.pow(10, digits);
    return Math.round(v * f) / f;
  }

  /* 表の col 列の値 target を挟む2点から、他の列を線形補間する。
     直径だけは「直径² が号数に比例する」性質を使って補間する。 */
  function interpolate(table, col, target) {
    var lo = null, hi = null;
    for (var i = 0; i < table.length; i++) {
      if (table[i][col] === target) return { gou: table[i][0], lb: table[i][1], mm: table[i][2] };
      if (table[i][col] < target) lo = table[i];
      if (table[i][col] > target && hi === null) hi = table[i];
    }
    if (lo === null || hi === null) return null;
    var t = (target - lo[col]) / (hi[col] - lo[col]);
    var gou = lo[0] + (hi[0] - lo[0]) * t;
    var lb = lo[1] + (hi[1] - lo[1]) * t;
    var mm2 = lo[2] * lo[2] + (hi[2] * hi[2] - lo[2] * lo[2]) * t;
    return { gou: gou, lb: lb, mm: Math.sqrt(mm2) };
  }

  /**
   * 号数・ポンド・直径を相互に換算する
   * @param {string} type ライン種別。"nylon"=ナイロン / "fluoro"=フロロカーボン(ナイロンと同じ規格) / "pe"=PE
   * @param {string} unit 入力値の単位。"gou"=号数 / "lb"=ポンド / "mm"=直径(mm)
   * @param {number} value 入力値
   * @returns {{ok:true, gou:number, lb:number, kg:number, mm:number}
   *          |{ok:false, code:"invalid_type"|"invalid_unit"|"invalid_value"|"out_of_range"}}
   *   gou は小数第2位、lb は小数第1位、kg は小数第3位、mm は小数第3位で四捨五入
   */
  function convert(type, unit, value) {
    if (!Object.prototype.hasOwnProperty.call(TABLES, type)) {
      return { ok: false, code: "invalid_type" };
    }
    var col = unit === "gou" ? 0 : unit === "lb" ? 1 : unit === "mm" ? 2 : -1;
    if (col < 0) return { ok: false, code: "invalid_unit" };
    if (!isFiniteNumber(value) || value <= 0) return { ok: false, code: "invalid_value" };

    var table = TABLES[type];
    if (value < table[0][col] || value > table[table.length - 1][col]) {
      return { ok: false, code: "out_of_range" };
    }
    var r = interpolate(table, col, value);
    if (r === null) return { ok: false, code: "out_of_range" };

    return {
      ok: true,
      gou: round(r.gou, 2),
      lb: round(r.lb, 1),
      kg: round(r.lb * LB_TO_KG, 3),
      mm: round(r.mm, 3)
    };
  }

  /**
   * ポンドをキログラムに換算する
   * @param {number} lb ポンド(lb)
   * @returns {{ok:true, kg:number}|{ok:false, code:"invalid_value"}} kg は小数第3位で四捨五入
   */
  function lbToKg(lb) {
    if (!isFiniteNumber(lb) || lb <= 0 || lb > 100000) return { ok: false, code: "invalid_value" };
    return { ok: true, kg: round(lb * LB_TO_KG, 3) };
  }

  /**
   * 種別ごとの換算表をそのまま返す(画面で早見表を出すため)
   * @param {string} type "nylon" / "fluoro" / "pe"
   * @returns {{ok:true, rows:Array<{gou:number, lb:number, kg:number, mm:number}>}|{ok:false, code:"invalid_type"}}
   */
  function table(type) {
    if (!Object.prototype.hasOwnProperty.call(TABLES, type)) {
      return { ok: false, code: "invalid_type" };
    }
    var rows = TABLES[type].map(function (r) {
      return { gou: r[0], lb: r[1], kg: round(r[1] * LB_TO_KG, 3), mm: r[2] };
    });
    return { ok: true, rows: rows };
  }

  var api = {
    convert: convert,
    lbToKg: lbToKg,
    table: table,
    LB_TO_KG: LB_TO_KG
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.PelineCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
