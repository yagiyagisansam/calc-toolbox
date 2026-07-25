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

  /**
   * 人間の年齢が犬・猫の何歳に相当するかを求める(humanAge の逆関数)。
   * 15歳以下 = ÷15 / 15〜24歳 = 1歳+(超過分÷9) / 24歳超 = 2歳+(超過分÷4)。
   * 対応する人間年齢はペット0.1〜30歳にあたる1.5〜136歳。結果は小数第1位で四捨五入。
   * @param {string} type "cat"(猫) | "dog"(小型・中型犬)
   * @param {number} human 人間の年齢(1.5〜136歳)
   * @returns {{ok:true, petAge:number}|{ok:false, code:string}}
   *   code: "invalid_type" | "invalid_age"
   */
  function petAge(type, human) {
    if (type !== "cat" && type !== "dog") return { ok: false, code: "invalid_type" };
    if (typeof human !== "number" || !isFinite(human) || human < 1.5 || human > 136) {
      return { ok: false, code: "invalid_age" };
    }
    var a;
    if (human <= 15) a = human / 15;
    else if (human <= 24) a = 1 + (human - 15) / 9;
    else a = 2 + (human - 24) / 4;
    return { ok: true, petAge: Math.round(a * 10) / 10 };
  }

  /**
   * 1〜20歳の年齢早見表を作る(換算式は猫・小型/中型犬で共通)。
   * 人間年齢は humanAge と同じ式(小数第1位で四捨五入)、区分も同じ。
   * @returns {{ok:true, rows:Array<{age:number, human:number, stage:string}>}}
   */
  function ageTable() {
    var rows = [];
    for (var a = 1; a <= 20; a++) {
      var r = humanAge("cat", a);
      rows.push({ age: a, human: r.humanAge, stage: r.stage });
    }
    return { ok: true, rows: rows };
  }

  var api = {
    ageTable: ageTable,
    petAge: petAge, humanAge: humanAge };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { global.PetageCalc = api; }
})(typeof window !== "undefined" ? window : globalThis);
