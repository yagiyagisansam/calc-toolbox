/*
 * タンパク質摂取量計算ロジック
 *
 * 計算方法(目安):
 * - ふつうの生活: 体重×0.9g/日(食事摂取基準の推奨量の算定に用いられる維持必要量
 *   0.66g/kg×利用効率補正に相当する概数)
 * - 運動習慣あり: 体重×1.2g / 筋トレ・スポーツ選手: 体重×1.6g
 *   (スポーツ栄養で一般的に推奨される1.2〜2.0g/kgの範囲の代表値)
 */
(function (global) {
  "use strict";

  var LEVELS = {
    normal: { rate: 0.9, label: "ふつうの生活" },
    active: { rate: 1.2, label: "運動習慣あり(週2〜3回)" },
    training: { rate: 1.6, label: "筋トレ・スポーツ選手" }
  };

  /**
   * 1日のタンパク質摂取量の目安を計算する。
   * @param {number} weightKg 体重(kg・20〜300)
   * @param {string} level "normal" | "active" | "training"
   * @returns {{ok: true, grams: number, rate: number, label: string}
   *          |{ok: false, code: string}}  code: "invalid_weight" | "invalid_level"
   */
  function needs(weightKg, level) {
    if (typeof weightKg !== "number" || !isFinite(weightKg) || weightKg < 20 || weightKg > 300) {
      return { ok: false, code: "invalid_weight" };
    }
    if (!LEVELS.hasOwnProperty(level)) return { ok: false, code: "invalid_level" };
    var l = LEVELS[level];
    return { ok: true, grams: Math.round(weightKg * l.rate), rate: l.rate, label: l.label };
  }

  // 食品1単位あたりのタンパク質量の目安(g)。いずれも概数で、製品・調理法により変わる:
  // 鶏むね肉100g≒22g / 卵1個≒6g / 納豆1パック≒8g / 牛乳200ml≒7g / プロテイン1杯≒20g
  var FOOD_PROTEIN_ADV = {
    chickenPer100g: 22,
    eggPerPiece: 6,
    nattoPerPack: 8,
    milkPer200ml: 7,
    powderPerScoop: 20
  };

  function round1Adv(v) { return Math.round(v * 10) / 10; }

  /**
   * 必要なタンパク質量(g)を身近な食品の量に換算する。
   * 係数は FOOD_PROTEIN_ADV の目安値(あくまで概数。製品・調理法で変わる)。
   * 「その食品だけで全量をまかなう場合」の量なので、実際は組み合わせて摂る。
   * 丸め方針: 鶏むね肉は整数g、個数・パック・杯数は小数第1位に四捨五入。
   * @param {number} grams 必要量(g・1〜500)
   * @returns {{ok:true, grams:number, chickenG:number, eggs:number, natto:number,
   *            milkCups:number, scoops:number}
   *          |{ok:false, code:string}}  code: "invalid_grams"
   */
  function foodEquivalents(grams) {
    if (typeof grams !== "number" || !isFinite(grams) || grams < 1 || grams > 500) {
      return { ok: false, code: "invalid_grams" };
    }
    return {
      ok: true,
      grams: grams,
      chickenG: Math.round(grams / FOOD_PROTEIN_ADV.chickenPer100g * 100),
      eggs: round1Adv(grams / FOOD_PROTEIN_ADV.eggPerPiece),
      natto: round1Adv(grams / FOOD_PROTEIN_ADV.nattoPerPack),
      milkCups: round1Adv(grams / FOOD_PROTEIN_ADV.milkPer200ml),
      scoops: round1Adv(grams / FOOD_PROTEIN_ADV.powderPerScoop)
    };
  }

  /**
   * 今日食べた食品からタンパク質摂取量を合計する(係数は foodEquivalents と同じ目安)。
   * 丸め方針: 合計は小数第1位に四捨五入。
   * @param {{chickenG?:number, eggs?:number, natto?:number, milkMl?:number, scoops?:number}} foods
   *   鶏むね肉(g・0〜2000) / 卵(個・0〜30) / 納豆(パック・0〜20) /
   *   牛乳(ml・0〜3000) / プロテイン(杯・0〜10)。未入力は0扱い
   * @returns {{ok:true, totalG:number}|{ok:false, code:string}}
   *   code: "invalid_foods"(すべて未入力) | "invalid_amount"(範囲外の値)
   */
  function intakeFromFoods(foods) {
    if (!foods || typeof foods !== "object") return { ok: false, code: "invalid_foods" };
    var defs = [
      ["chickenG", 2000, FOOD_PROTEIN_ADV.chickenPer100g / 100],
      ["eggs", 30, FOOD_PROTEIN_ADV.eggPerPiece],
      ["natto", 20, FOOD_PROTEIN_ADV.nattoPerPack],
      ["milkMl", 3000, FOOD_PROTEIN_ADV.milkPer200ml / 200],
      ["scoops", 10, FOOD_PROTEIN_ADV.powderPerScoop]
    ];
    var total = 0;
    var any = false;
    for (var i = 0; i < defs.length; i++) {
      var v = foods[defs[i][0]];
      if (v === undefined || v === null || v === 0) continue;
      if (typeof v !== "number" || !isFinite(v) || v < 0 || v > defs[i][1]) {
        return { ok: false, code: "invalid_amount" };
      }
      any = true;
      total += v * defs[i][2];
    }
    if (!any) return { ok: false, code: "invalid_foods" };
    return { ok: true, totalG: round1Adv(total) };
  }

  var api = {
    intakeFromFoods: intakeFromFoods,
    foodEquivalents: foodEquivalents, needs: needs, LEVELS: LEVELS };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { global.ProteinCalc = api; }
})(typeof window !== "undefined" ? window : globalThis);
