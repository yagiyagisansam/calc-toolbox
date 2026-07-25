/*
 * 温度換算ロジック(摂氏⇔華氏⇔ケルビン)
 *
 * 計算方法(定義式):
 * - 華氏(°F) = 摂氏(°C) × 1.8 + 32
 * - ケルビン(K) = 摂氏(°C) + 273.15
 * - 絶対零度(-273.15°C / -459.67°F / 0K)未満はエラー
 * - 表示は小数第2位で四捨五入
 */
(function (global) {
  "use strict";

  var ABS_ZERO = { c: -273.15, f: -459.67, k: 0 };
  var EPS = 1e-9;

  function round2(x) {
    return Math.round(x * 100) / 100;
  }

  /**
   * 温度を3単位すべてに換算する。
   * @param {number} value 温度の値
   * @param {string} unit 入力の単位 "c" | "f" | "k"
   * @returns {{ok: true, c: number, f: number, k: number}
   *          |{ok: false, code: string}}
   *   code: "invalid_value" | "invalid_unit" | "below_absolute_zero"
   */
  function convert(value, unit) {
    if (typeof value !== "number" || !isFinite(value)) {
      return { ok: false, code: "invalid_value" };
    }
    if (unit !== "c" && unit !== "f" && unit !== "k") {
      return { ok: false, code: "invalid_unit" };
    }
    if (value < ABS_ZERO[unit] - EPS) {
      return { ok: false, code: "below_absolute_zero" };
    }
    var c = unit === "c" ? value : unit === "f" ? (value - 32) / 1.8 : value - 273.15;
    return {
      ok: true,
      c: round2(c),
      f: round2(c * 1.8 + 32),
      k: round2(c + 273.15)
    };
  }

  /**
   * 摂氏⇔華氏の早見表を作る。
   * start から end まで step 刻みで温度を並べ、各行を摂氏と華氏の両方で返す。
   * 丸め方針: 各値は小数第2位で四捨五入(convert と同じ)。
   * @param {number} start 開始温度
   * @param {number} end 終了温度(start 以上)
   * @param {number} step 刻み(0より大きい)
   * @param {string} unit start/end/step の単位 "c" | "f"
   * @returns {{ok:true, count:number, rows:Array<{c:number, f:number}>}
   *          |{ok:false, code:string}}
   *   code: "invalid_value" | "invalid_unit" | "invalid_range" | "invalid_step"
   *         | "too_many_rows" | "below_absolute_zero"
   */
  function makeTable(start, end, step, unit) {
    if (typeof start !== "number" || !isFinite(start) ||
        typeof end !== "number" || !isFinite(end) ||
        typeof step !== "number" || !isFinite(step)) {
      return { ok: false, code: "invalid_value" };
    }
    if (unit !== "c" && unit !== "f") {
      return { ok: false, code: "invalid_unit" };
    }
    if (end < start) return { ok: false, code: "invalid_range" };
    if (step <= 0) return { ok: false, code: "invalid_step" };
    if (start < ABS_ZERO[unit] - EPS) {
      return { ok: false, code: "below_absolute_zero" };
    }
    var n = Math.floor((end - start) / step + EPS) + 1;
    if (n > 101) return { ok: false, code: "too_many_rows" };
    var rows = [];
    for (var i = 0; i < n; i++) {
      var v = start + step * i;
      var r = convert(v, unit);
      if (!r.ok) return r;
      rows.push({ c: r.c, f: r.f });
    }
    return { ok: true, count: rows.length, rows: rows };
  }

  /**
   * 海外レシピの華氏(°F)を、日本のオーブンで設定しやすい温度に直す。
   * - cExact: 換算した摂氏(小数第2位で四捨五入)
   * - cOven: 10°C単位に四捨五入した設定の目安(日本の家庭用オーブンは10°C刻みが多い)
   * - gasMark: 英国レシピのガスマーク相当(Mark 1=275°F、以降25°Fごとに+1。
   *   275〜475°Fの範囲で最も近い整数マーク、範囲外は null)
   * @param {number} f オーブン温度(°F)。100〜600°Fの範囲
   * @returns {{ok:true, cExact:number, cOven:number, gasMark:(number|null)}
   *          |{ok:false, code:string}}
   *   code: "invalid_value" | "out_of_range"
   */
  function ovenSetting(f) {
    if (typeof f !== "number" || !isFinite(f)) {
      return { ok: false, code: "invalid_value" };
    }
    if (f < 100 || f > 600) return { ok: false, code: "out_of_range" };
    var c = (f - 32) / 1.8;
    var gm = null;
    if (f >= 275 - EPS && f <= 475 + EPS) {
      gm = Math.round((f - 250) / 25);
      if (gm < 1) gm = 1;
      if (gm > 9) gm = 9;
    }
    return {
      ok: true,
      cExact: round2(c),
      cOven: Math.round(c / 10) * 10,
      gasMark: gm
    };
  }

  var api = {
    ovenSetting: ovenSetting,
    makeTable: makeTable,
    convert: convert,
    ABS_ZERO: ABS_ZERO
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.OndoCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
