/*
 * 犬猫の1日必要カロリー(RER・DER)と給餌量の計算ロジック
 *
 * 根拠(一次情報):
 * - 栃木県動物愛護指導センター「愛犬と愛猫へのフード量はどう計算するの？」(2024年4月17日)
 *   https://www.douai.pref.tochigi.lg.jp/20240477_1/ (2026年7月29日参照)
 *   RER =(体重kg)の0.75乗 × 70
 *   DER = RER × 活動係数
 *   1日あたりのフード量 = DER ÷ 100gあたりのカロリー数 × 100
 *   1回あたりのフード量 = 1日あたりのフード量 ÷ 1日の給餌回数
 *   活動係数は同ページ掲載の表(犬・猫別)による。下の FACTORS はその表をそのまま写したもの。
 *   同ページの計算例: 体重3kgの子犬(離乳期〜3ヶ月、係数3)、フード400kcal/100g、1日2回
 *   → RER 159.56 → DER 479kcal → 1日120g → 1回60g。本ロジックも同じ値になる。
 *
 * 制度・基準の時点:
 * - 上記ページは2024年4月17日公開(2024年4月24日更新)。2026年7月29日時点の内容による。
 *
 * 前提:
 * - 健康な動物の維持エネルギーの目安。療養食や病気の治療中の給与量は獣医師の指示に従うこと。
 * - フードのカロリーは「代謝エネルギー ○○kcal/100g」の表示を使う。
 * - 活動係数に幅がある区分は min/max を返す。計算には利用者が選んだ1つの係数を使う。
 */
(function (global) {
  "use strict";

  var RER_COEFFICIENT = 70;
  var RER_EXPONENT = 0.75;

  var MAX_WEIGHT_KG = 200;
  var MAX_FACTOR = 10;
  var MAX_KCAL_PER_100G = 1000;
  var MAX_MEALS = 10;

  // 出典ページの活動係数表。[最小, 最大](幅がない区分は同じ値)
  var FACTORS = {
    dog: {
      adult_intact: [1.8, 1.8],
      adult_neutered: [1.6, 1.6],
      obese: [1.4, 1.4],
      weight_loss: [1.0, 1.0],
      critical_care: [1.0, 1.0],
      weight_gain: [1.2, 1.4],
      senior: [1.4, 1.4],
      young_0_3m: [3.0, 3.0],
      young_4_9m: [2.5, 2.5],
      young_10_12m: [2.0, 2.0],
      pregnancy_1_4w: [2.0, 2.0],
      pregnancy_5_6w: [2.5, 2.5],
      pregnancy_7_8w: [3.0, 3.0],
      lactation: [4.0, 8.0]
    },
    cat: {
      adult_intact: [1.4, 1.4],
      adult_neutered: [1.2, 1.2],
      obese: [1.0, 1.0],
      weight_loss: [0.8, 0.8],
      critical_care: [1.0, 1.0],
      weight_gain: [1.2, 1.4],
      senior: [1.1, 1.1],
      young_0_3m: [3.0, 3.0],
      young_4_6m: [2.5, 2.5],
      young_7_12m: [2.0, 2.0],
      pregnancy: [2.0, 2.0],
      lactation: [2.0, 6.0]
    }
  };

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  /**
   * 安静時エネルギー要求量(RER)を求める。
   * @param {number} weightKg 体重(kg。0より大きく200以下)
   * @returns {{ok:true, rerKcal:number, raw:number}|{ok:false, code:"invalid_weight"}}
   *   rerKcal は小数第2位で四捨五入した表示用の値。raw は丸めていない値。
   */
  function rer(weightKg) {
    if (!isFiniteNumber(weightKg) || weightKg <= 0 || weightKg > MAX_WEIGHT_KG) {
      return { ok: false, code: "invalid_weight" };
    }
    var raw = RER_COEFFICIENT * Math.pow(weightKg, RER_EXPONENT);
    return { ok: true, rerKcal: Math.round(raw * 100) / 100, raw: raw };
  }

  /**
   * 出典ページの表から活動係数を引く。
   * @param {"dog"|"cat"} species 犬か猫か
   * @param {string} key 区分のキー(FACTORS のキー。例 "adult_neutered")
   * @returns {{ok:true, min:number, max:number, mid:number}
   *          |{ok:false, code:"invalid_species"|"invalid_factor_key"}}
   *   mid は min と max の中央値(小数第2位で四捨五入)。幅のない区分では min と同じ。
   */
  function factorFor(species, key) {
    var table = FACTORS[species];
    if (!table) return { ok: false, code: "invalid_species" };
    var v = Object.prototype.hasOwnProperty.call(table, key) ? table[key] : null;
    if (!v) return { ok: false, code: "invalid_factor_key" };
    return { ok: true, min: v[0], max: v[1], mid: Math.round((v[0] + v[1]) / 2 * 100) / 100 };
  }

  /**
   * 1日の必要カロリー(DER)とフードの給餌量を求める。
   * @param {number} weightKg 体重(kg。0より大きく200以下)
   * @param {number} factor 活動係数(0より大きく10以下)
   * @param {number} kcalPer100g フードの代謝エネルギー(kcal/100g。0より大きく1000以下)
   * @param {number} [mealsPerDay=1] 1日の給餌回数(1〜10の整数)
   * @returns {{ok:true, rerKcal:number, derKcal:number, gramsPerDay:number, gramsPerMeal:number}
   *          |{ok:false, code:"invalid_weight"|"invalid_factor"|"invalid_kcal"|"invalid_meals"}}
   *   derKcal は1kcal単位で四捨五入(出典ページの計算例と同じ扱い)。
   *   gramsPerDay は丸めた derKcal から求め、1g単位で四捨五入する。
   *   gramsPerMeal は gramsPerDay ÷ 回数を小数第1位で四捨五入。
   */
  function calculate(weightKg, factor, kcalPer100g, mealsPerDay) {
    var meals = mealsPerDay === undefined || mealsPerDay === null ? 1 : mealsPerDay;
    var r = rer(weightKg);
    if (!r.ok) return r;
    if (!isFiniteNumber(factor) || factor <= 0 || factor > MAX_FACTOR) {
      return { ok: false, code: "invalid_factor" };
    }
    if (!isFiniteNumber(kcalPer100g) || kcalPer100g <= 0 || kcalPer100g > MAX_KCAL_PER_100G) {
      return { ok: false, code: "invalid_kcal" };
    }
    if (!isFiniteNumber(meals) || meals < 1 || meals > MAX_MEALS || Math.floor(meals) !== meals) {
      return { ok: false, code: "invalid_meals" };
    }
    var der = Math.round(r.raw * factor);
    var grams = Math.round(der / kcalPer100g * 100);
    return {
      ok: true,
      rerKcal: r.rerKcal,
      derKcal: der,
      gramsPerDay: grams,
      gramsPerMeal: Math.round(grams / meals * 10) / 10
    };
  }

  var api = {
    rer: rer,
    factorFor: factorFor,
    calculate: calculate
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.PetFoodCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
