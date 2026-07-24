/*
 * お米の合・グラム換算ロジック
 *
 * 計算方法(一般的な目安):
 * - 1合 = 180ml(米用計量カップ1杯)≒ 精白米約150g
 * - 水加減の目安 = 米1合あたり約200ml(米の容積の1.1〜1.2倍)
 * - 炊き上がりは米の重さの約2.2倍(1合→約330g)
 * - お茶碗1杯 ≒ ごはん150g(1合で約2.2杯)
 */
(function (global) {
  "use strict";

  var RICE_G = 150;
  var WATER_ML = 200;
  var COOKED_RATE = 2.2;
  var BOWL_G = 150;

  function round1(x) { return Math.round(x * 10) / 10; }

  /**
   * 合数からお米の重さ・水量・炊き上がりを計算する。
   * @param {number} go 合数(0.5〜20)
   * @returns {{ok: true, riceG: number, waterMl: number, cookedG: number, bowls: number}
   *          |{ok: false, code: string}}  code: "invalid_go"
   */
  function fromGo(go) {
    if (typeof go !== "number" || !isFinite(go) || go <= 0 || go > 20) {
      return { ok: false, code: "invalid_go" };
    }
    var cooked = go * RICE_G * COOKED_RATE;
    return {
      ok: true,
      riceG: round1(go * RICE_G),
      waterMl: Math.round(go * WATER_ML),
      cookedG: Math.round(cooked),
      bowls: round1(cooked / BOWL_G)
    };
  }

  /**
   * お米の重さ(g)から合数を計算する。
   * @returns {{ok: true, go: number}|{ok: false, code: string}}
   */
  function fromGram(grams) {
    if (typeof grams !== "number" || !isFinite(grams) || grams <= 0 || grams > 30000) {
      return { ok: false, code: "invalid_gram" };
    }
    return { ok: true, go: Math.round(grams / RICE_G * 100) / 100 };
  }

  var api = { fromGo: fromGo, fromGram: fromGram, RICE_G: RICE_G, WATER_ML: WATER_ML };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { global.KomeCalc = api; }
})(typeof window !== "undefined" ? window : globalThis);
