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

  /**
   * 「100gあたり食塩相当量」の表示から、実際に食べる量に含まれる食塩相当量を計算する。
   * 食塩相当量(g) = 100gあたりの食塩相当量(g) × 食べる量(g) ÷ 100
   * 1日目標量(厚生労働省「日本人の食事摂取基準(2020年版)」成人: 男性7.5g・女性6.5g未満)
   * に対する割合も返す。
   * 丸め方針: 食塩相当量は小数第2位で四捨五入、割合(%)は整数に四捨五入。
   * @param {number} saltPer100g 100gあたりの食塩相当量(g)
   * @param {number} grams 実際に食べる量(g)
   * @returns {{ok:true, saltG:number, pctMale:number, pctFemale:number}
   *          |{ok:false, code:string}}
   *   code: "invalid_value"
   */
  function portionSalt(saltPer100g, grams) {
    if (typeof saltPer100g !== "number" || !isFinite(saltPer100g) ||
        saltPer100g <= 0 || saltPer100g > 100) {
      return { ok: false, code: "invalid_value" };
    }
    if (typeof grams !== "number" || !isFinite(grams) || grams <= 0 || grams > 5000) {
      return { ok: false, code: "invalid_value" };
    }
    var salt = saltPer100g * grams / 100;
    return {
      ok: true,
      saltG: round2(salt),
      pctMale: Math.round(salt / TARGET.male * 100),
      pctFemale: Math.round(salt / TARGET.female * 100)
    };
  }

  /**
   * 1日に食べたものの食塩相当量(g)を合計し、目標量に対する残りを返す。
   * 目標量は厚生労働省「日本人の食事摂取基準(2020年版)」の成人目標量
   * (男性7.5g未満・女性6.5g未満)を使用。
   * 丸め方針: 合計と残りは小数第2位で四捨五入、割合(%)は整数に四捨五入。
   * @param {Array<{name:string, salt:number}>} items 食品ごとの食塩相当量(g)。1〜6件
   * @param {string} sex "male" | "female"
   * @returns {{ok:true, totalG:number, targetG:number, remainingG:number,
   *            over:boolean, pct:number}
   *          |{ok:false, code:string}}
   *   remainingG: 目標量までの残り(g)。超過時はマイナス / over: 目標量以上ならtrue
   *   code: "invalid_items" | "too_many_items" | "invalid_value" | "invalid_sex"
   */
  function dailyTotal(items, sex) {
    if (!Array.isArray(items) || items.length === 0) {
      return { ok: false, code: "invalid_items" };
    }
    if (items.length > 6) return { ok: false, code: "too_many_items" };
    if (sex !== "male" && sex !== "female") {
      return { ok: false, code: "invalid_sex" };
    }
    var total = 0;
    for (var i = 0; i < items.length; i++) {
      var s = items[i] && items[i].salt;
      if (typeof s !== "number" || !isFinite(s) || s < 0 || s > 100) {
        return { ok: false, code: "invalid_value" };
      }
      total += s;
    }
    var target = TARGET[sex];
    return {
      ok: true,
      totalG: round2(total),
      targetG: target,
      remainingG: round2(target - total),
      over: total >= target,
      pct: Math.round(total / target * 100)
    };
  }

  var api = {
    portionSalt: portionSalt,
    dailyTotal: dailyTotal,
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
