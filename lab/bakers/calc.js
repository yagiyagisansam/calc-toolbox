/*
 * ベーカーズパーセント 計算ロジック
 *
 * 根拠(一次情報):
 * - 富澤商店「ベーカーズパーセントとは？パンの基本配合」
 *   https://tomiz.com/column/bakerspercent/ (2026年7月29日参照)
 *   定義: 粉を100%とし、粉に対する他の材料の割合で配合を表す。
 *   材料のベーカーズ% = 材料の分量(g) ÷ 粉の分量(g) × 100
 *   求めたい材料の分量(g) = 粉の分量(g) × 材料のベーカーズ%(÷100)
 *   目安の配合: 加水率 食パン・菓子パン 65〜70% / ハード系 70〜80%、
 *   塩 菓子パン系1.7%・リーン生地2%、砂糖0〜15%、バター0〜15%、
 *   イースト(ドライ)菓子パン1.5〜2%。
 *
 * 前提:
 * - 粉(小麦粉・全粒粉などの合計)を100%とする。複数の粉を使う場合は合計を粉量とする。
 * - 液体は重量(g)で扱う。水1mL=1gとして換算できるが、牛乳や卵は比重が異なる。
 * - 発酵種(ルヴァン・中種)を使う配合では、種に含まれる粉と水も粉量・加水量に含めて数える
 *   のが一般的だが、ここでは入力された値をそのまま計算する。
 * - 計算結果は小数第1位(0.1g単位)まで。家庭用スケールの読みに合わせている。
 */
(function (global) {
  "use strict";

  var MAX_FLOUR = 1000000; // 粉量の上限(g)。1トンを超える入力は誤入力とみなす
  var MAX_PERCENT = 1000; // 各材料の割合の上限(%)

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function isPlainObject(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
  }

  /**
   * 指定した小数位で四捨五入する(2進小数の誤差でちょうど半分の値が下振れするのを防ぐ)
   * @param {number} x 対象の数値
   * @param {number} digits 小数点以下の桁数(0以上)
   * @returns {number} 四捨五入した数値
   */
  function roundTo(x, digits) {
    if (!isFinite(x)) return x;
    var p = Math.pow(10, digits);
    return Math.round(parseFloat(x.toPrecision(12)) * p) / p;
  }

  function checkFlour(v) {
    return isFiniteNumber(v) && v > 0 && v <= MAX_FLOUR;
  }

  /**
   * 粉量と各材料のベーカーズ%から、各材料の分量(g)を求める
   * @param {number} flourG 粉の分量(g)。0より大きく1,000,000以下
   * @param {Object<string, number>} percents 材料名をキー、ベーカーズ%を値とするオブジェクト
   *   例 {"water":70, "salt":2, "sugar":5, "yeast":1, "fat":3}。各値は0以上1000以下
   * @returns {{ok:true, flourG:number, items:Object<string,{percent:number, grams:number}>,
   *            totalPercent:number, totalG:number}
   *          |{ok:false, code:"invalid_flour"|"invalid_percents"|"invalid_percent_value"}}
   *   items: 材料ごとの割合と分量(g、小数第1位で四捨五入)
   *   totalPercent: 粉100%を含めた合計の割合(%、小数第1位で四捨五入)
   *   totalG: 粉を含めた生地全体の重さ(g、小数第1位で四捨五入)
   */
  function fromFlour(flourG, percents) {
    if (!checkFlour(flourG)) return { ok: false, code: "invalid_flour" };
    if (!isPlainObject(percents)) return { ok: false, code: "invalid_percents" };
    var keys = Object.keys(percents);
    if (keys.length === 0) return { ok: false, code: "invalid_percents" };
    var items = {};
    var sumPercent = 0;
    var sumG = 0;
    for (var i = 0; i < keys.length; i++) {
      var p = percents[keys[i]];
      if (!isFiniteNumber(p) || p < 0 || p > MAX_PERCENT) {
        return { ok: false, code: "invalid_percent_value" };
      }
      var g = roundTo((flourG * p) / 100, 1);
      items[keys[i]] = { percent: roundTo(p, 2), grams: g };
      sumPercent += p;
      sumG += g;
    }
    return {
      ok: true,
      flourG: roundTo(flourG, 1),
      items: items,
      totalPercent: roundTo(100 + sumPercent, 1),
      totalG: roundTo(flourG + sumG, 1)
    };
  }

  /**
   * 粉量と各材料の分量(g)から、ベーカーズ%を逆算する
   * @param {number} flourG 粉の分量(g)。0より大きく1,000,000以下
   * @param {Object<string, number>} grams 材料名をキー、分量(g)を値とするオブジェクト
   *   例 {"water":175, "salt":5}。各値は0以上
   * @returns {{ok:true, flourG:number, items:Object<string,{grams:number, percent:number}>,
   *            totalPercent:number, totalG:number}
   *          |{ok:false, code:"invalid_flour"|"invalid_grams"|"invalid_gram_value"}}
   *   items: 材料ごとの分量とベーカーズ%(%、小数第2位で四捨五入)
   */
  function toPercent(flourG, grams) {
    if (!checkFlour(flourG)) return { ok: false, code: "invalid_flour" };
    if (!isPlainObject(grams)) return { ok: false, code: "invalid_grams" };
    var keys = Object.keys(grams);
    if (keys.length === 0) return { ok: false, code: "invalid_grams" };
    var items = {};
    var sumPercent = 0;
    var sumG = 0;
    for (var i = 0; i < keys.length; i++) {
      var g = grams[keys[i]];
      if (!isFiniteNumber(g) || g < 0 || g > MAX_FLOUR) {
        return { ok: false, code: "invalid_gram_value" };
      }
      var p = (g / flourG) * 100;
      items[keys[i]] = { grams: roundTo(g, 1), percent: roundTo(p, 2) };
      sumPercent += p;
      sumG += g;
    }
    return {
      ok: true,
      flourG: roundTo(flourG, 1),
      items: items,
      totalPercent: roundTo(100 + sumPercent, 1),
      totalG: roundTo(flourG + sumG, 1)
    };
  }

  /**
   * 粉量を変えたときの各材料の分量を求め直す
   * @param {number} oldFlourG 元のレシピの粉の分量(g)
   * @param {number} newFlourG 作りたい粉の分量(g)
   * @param {Object<string, number>} grams 元のレシピの材料名と分量(g)
   * @returns {{ok:true, factor:number, flourG:number,
   *            items:Object<string,{before:number, grams:number, percent:number}>, totalG:number}
   *          |{ok:false, code:"invalid_flour"|"invalid_grams"|"invalid_gram_value"}}
   *   factor: 倍率 = 新しい粉量 ÷ 元の粉量(小数第4位で四捨五入)
   *   items[].grams: 新しい分量(g、小数第1位で四捨五入)
   */
  function scale(oldFlourG, newFlourG, grams) {
    if (!checkFlour(oldFlourG) || !checkFlour(newFlourG)) {
      return { ok: false, code: "invalid_flour" };
    }
    var p = toPercent(oldFlourG, grams);
    if (!p.ok) return p;
    var factor = newFlourG / oldFlourG;
    var items = {};
    var keys = Object.keys(grams);
    var sumG = 0;
    for (var i = 0; i < keys.length; i++) {
      var g = roundTo(grams[keys[i]] * factor, 1);
      items[keys[i]] = {
        before: roundTo(grams[keys[i]], 1),
        grams: g,
        percent: p.items[keys[i]].percent
      };
      sumG += g;
    }
    return {
      ok: true,
      factor: roundTo(factor, 4),
      flourG: roundTo(newFlourG, 1),
      items: items,
      totalG: roundTo(newFlourG + sumG, 1)
    };
  }

  /**
   * できあがりの生地量から、必要な粉の量を逆算する
   * 粉(g) = 生地全体(g) ÷ (1 + 各材料の%の合計 ÷ 100)
   * @param {number} totalDoughG 作りたい生地の総量(g)。0より大きく1,000,000以下
   * @param {Object<string, number>} percents 材料名とベーカーズ%
   * @returns {{ok:true, flourG:number, totalPercent:number,
   *            items:Object<string,{percent:number, grams:number}>, totalG:number}
   *          |{ok:false, code:"invalid_total"|"invalid_percents"|"invalid_percent_value"}}
   *   flourG: 必要な粉の量(g、小数第1位で四捨五入)
   */
  function flourFromTotal(totalDoughG, percents) {
    if (!isFiniteNumber(totalDoughG) || totalDoughG <= 0 || totalDoughG > MAX_FLOUR) {
      return { ok: false, code: "invalid_total" };
    }
    if (!isPlainObject(percents)) return { ok: false, code: "invalid_percents" };
    var keys = Object.keys(percents);
    if (keys.length === 0) return { ok: false, code: "invalid_percents" };
    var sumPercent = 0;
    for (var i = 0; i < keys.length; i++) {
      var p = percents[keys[i]];
      if (!isFiniteNumber(p) || p < 0 || p > MAX_PERCENT) {
        return { ok: false, code: "invalid_percent_value" };
      }
      sumPercent += p;
    }
    var flour = totalDoughG / (1 + sumPercent / 100);
    var r = fromFlour(flour, percents);
    return {
      ok: true,
      flourG: roundTo(flour, 1),
      totalPercent: roundTo(100 + sumPercent, 1),
      items: r.items,
      totalG: r.totalG
    };
  }

  var api = {
    fromFlour: fromFlour,
    toPercent: toPercent,
    scale: scale,
    flourFromTotal: flourFromTotal
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.BakersCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
