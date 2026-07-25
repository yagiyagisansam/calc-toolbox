/*
 * 大さじ・小さじ・カップ換算ロジック(容量)
 *
 * 計算方法(日本の計量器具の規格):
 * - 小さじ1 = 5ml / 大さじ1 = 15ml(小さじ3杯) / 1カップ = 200ml
 * - すべて容量(ml)に直してから各単位に換算する
 * - 表示は小数第2位で四捨五入
 */
(function (global) {
  "use strict";

  var ML = { tsp: 5, tbsp: 15, cup: 200, ml: 1 };

  function round2(x) { return Math.round(x * 100) / 100; }

  /**
   * 容量を全単位に換算する。
   * @param {number} value 数値
   * @param {string} unit "tsp"(小さじ) | "tbsp"(大さじ) | "cup"(カップ) | "ml"
   * @returns {{ok: true, ml: number, tsp: number, tbsp: number, cup: number}
   *          |{ok: false, code: string}}  code: "invalid_value" | "invalid_unit"
   */
  function convert(value, unit) {
    if (typeof value !== "number" || !isFinite(value) || value <= 0 || value > 100000) {
      return { ok: false, code: "invalid_value" };
    }
    if (!ML.hasOwnProperty(unit)) return { ok: false, code: "invalid_unit" };
    var ml = value * ML[unit];
    return {
      ok: true,
      ml: round2(ml),
      tsp: round2(ml / ML.tsp),
      tbsp: round2(ml / ML.tbsp),
      cup: round2(ml / ML.cup)
    };
  }

  /*
   * 材料ごとの大さじ1杯(15ml)・小さじ1杯(5ml)の重さ(グラム)の目安。
   * 文部科学省「日本食品標準成分表」や調理実習で広く使われる標準計量スプーン表
   * (女子栄養大学「調理のためのベーシックデータ」等)に基づく一般的な目安値。
   * 同じ大さじ1でも材料のかさ(密度)が違うため重さが変わる。
   */
  var MATERIALS = {
    water: { label: "水", tbsp: 15, tsp: 5 },
    sugar: { label: "砂糖(上白糖)", tbsp: 9, tsp: 3 },
    salt: { label: "塩(食塩)", tbsp: 18, tsp: 6 },
    flour: { label: "小麦粉(薄力粉)", tbsp: 9, tsp: 3 },
    oil: { label: "油", tbsp: 12, tsp: 4 },
    soy: { label: "しょうゆ", tbsp: 18, tsp: 6 },
    miso: { label: "みそ", tbsp: 18, tsp: 6 }
  };

  /**
   * 大さじ・小さじの杯数と材料から、重さ(グラム)を計算する。
   * 重さ = 大さじ杯数 × 大さじ1杯のg + 小さじ杯数 × 小さじ1杯のg。
   * 係数は MATERIALS の目安値(上記コメントの出典参照)。
   * 丸め: 小数第2位で四捨五入。
   * @param {number} tbsp 大さじの杯数(0以上)
   * @param {number} tsp 小さじの杯数(0以上)
   * @param {string} material 材料キー(water|sugar|salt|flour|oil|soy|miso)
   * @returns {{ok:true, grams:number, gramsPerTbsp:number, gramsPerTsp:number, label:string}
   *          |{ok:false, code:string}} code: "invalid_amount"|"invalid_material"
   */
  function toGrams(tbsp, tsp, material) {
    if (typeof tbsp !== "number" || !isFinite(tbsp) || tbsp < 0 || tbsp > 10000 ||
        typeof tsp !== "number" || !isFinite(tsp) || tsp < 0 || tsp > 10000 ||
        (tbsp === 0 && tsp === 0)) {
      return { ok: false, code: "invalid_amount" };
    }
    if (!MATERIALS.hasOwnProperty(material)) return { ok: false, code: "invalid_material" };
    var m = MATERIALS[material];
    return {
      ok: true,
      grams: round2(tbsp * m.tbsp + tsp * m.tsp),
      gramsPerTbsp: m.tbsp,
      gramsPerTsp: m.tsp,
      label: m.label
    };
  }

  /**
   * 重さ(グラム)と材料から、大さじ・小さじの杯数を逆算する。
   * 「砂糖30g」→ 大さじ3.33杯 = 大さじ3+小さじ1、のように
   * はかりがない時にスプーンで量るための換算。
   * 丸め: 杯数は小数第2位で四捨五入。組み合わせ表示は大さじの整数部+残りを小さじで表す。
   * @param {number} grams 重さ(グラム)(0より大きい)
   * @param {string} material 材料キー(water|sugar|salt|flour|oil|soy|miso)
   * @returns {{ok:true, tbsp:number, tsp:number, tbspWhole:number, tspRest:number, label:string}
   *          |{ok:false, code:string}} code: "invalid_value"|"invalid_material"
   */
  function fromGrams(grams, material) {
    if (typeof grams !== "number" || !isFinite(grams) || grams <= 0 || grams > 100000) {
      return { ok: false, code: "invalid_value" };
    }
    if (!MATERIALS.hasOwnProperty(material)) return { ok: false, code: "invalid_material" };
    var m = MATERIALS[material];
    var tbspWhole = Math.floor(grams / m.tbsp);
    return {
      ok: true,
      tbsp: round2(grams / m.tbsp),
      tsp: round2(grams / m.tsp),
      tbspWhole: tbspWhole,
      tspRest: round2((grams - tbspWhole * m.tbsp) / m.tsp),
      label: m.label
    };
  }

  var api = {
    MATERIALS: MATERIALS,
    fromGrams: fromGrams,
    toGrams: toGrams, convert: convert, ML: ML };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { global.SpoonCalc = api; }
})(typeof window !== "undefined" ? window : globalThis);
