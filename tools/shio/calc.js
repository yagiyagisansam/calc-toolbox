/*
 * 塩分量換算ロジック(ナトリウム⇔食塩相当量)
 *
 * 計算方法:
 * - 食塩相当量(g) = ナトリウム(mg) × 2.54 ÷ 1000
 *   (換算係数2.54は食品表示基準〔平成27年内閣府令第10号〕による)
 * - 1日の目標量(食塩相当量)は「日本人の食事摂取基準」の成人目標量
 *   男性7.5g未満・女性6.5g未満を使用(達成率%も返す)
 */
(function (global) {
  "use strict";

  var FACTOR = 2.54;
  var TARGET = { male: 7.5, female: 6.5 };

  function round2(x) {
    return Math.round(x * 100) / 100;
  }

  /**
   * ナトリウム量(mg)を食塩相当量(g)に換算する。
   * @param {number} sodiumMg ナトリウム量(mg)
   * @returns {{ok: true, saltG: number, pctMale: number, pctFemale: number}
   *          |{ok: false, code: string}}
   *   saltG: 食塩相当量(g) / pctMale・pctFemale: 1日目標量に対する割合(%)
   *   code: "invalid_value"
   */
  function toSalt(sodiumMg) {
    if (typeof sodiumMg !== "number" || !isFinite(sodiumMg) || sodiumMg <= 0 || sodiumMg > 100000) {
      return { ok: false, code: "invalid_value" };
    }
    var salt = sodiumMg * FACTOR / 1000;
    return {
      ok: true,
      saltG: round2(salt),
      pctMale: Math.round(salt / TARGET.male * 100),
      pctFemale: Math.round(salt / TARGET.female * 100)
    };
  }

  /**
   * 食塩相当量(g)をナトリウム量(mg)に換算する。
   * @param {number} saltG 食塩相当量(g)
   * @returns {{ok: true, sodiumMg: number}|{ok: false, code: string}}
   */
  function toSodium(saltG) {
    if (typeof saltG !== "number" || !isFinite(saltG) || saltG <= 0 || saltG > 100) {
      return { ok: false, code: "invalid_value" };
    }
    return { ok: true, sodiumMg: Math.round(saltG * 1000 / FACTOR) };
  }

  var api = {
    toSalt: toSalt,
    toSodium: toSodium,
    FACTOR: FACTOR,
    TARGET: TARGET
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.ShioCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
