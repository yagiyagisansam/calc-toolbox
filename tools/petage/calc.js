/*
 * 犬・猫の年齢換算ロジック(人間年齢の目安)
 *
 * 計算方法(欧米の獣医団体等で広く使われる目安):
 * - 1歳 = 人間の約15歳 / 2歳 = 約24歳 / 以降1年ごとに約+4歳
 * - 1歳未満・端数は直線補間で計算
 * - 対象は猫と小型・中型犬。大型犬は加齢が速く確立した式が異なるため対象外
 */
(function (global) {
  "use strict";

  /**
   * ペットの年齢を人間の年齢の目安に換算する。
   * @param {string} type "cat"(猫) | "dog"(小型・中型犬)
   * @param {number} age ペットの年齢(0.1〜30歳)
   * @returns {{ok: true, humanAge: number, stage: string}|{ok: false, code: string}}
   *   stage: "子ども" | "成年期" | "シニア期" の目安
   *   code: "invalid_type" | "invalid_age"
   */
  function humanAge(type, age) {
    if (type !== "cat" && type !== "dog") return { ok: false, code: "invalid_type" };
    if (typeof age !== "number" || !isFinite(age) || age < 0.1 || age > 30) {
      return { ok: false, code: "invalid_age" };
    }
    var h;
    if (age <= 1) h = 15 * age;
    else if (age <= 2) h = 15 + 9 * (age - 1);
    else h = 24 + 4 * (age - 2);
    var stage = age < 1 ? "子ども" : age < 7 ? "成年期" : "シニア期";
    return { ok: true, humanAge: Math.round(h * 10) / 10, stage: stage };
  }

  var api = { humanAge: humanAge };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { global.PetageCalc = api; }
})(typeof window !== "undefined" ? window : globalThis);
