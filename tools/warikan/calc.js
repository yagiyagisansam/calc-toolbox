/*
 * 割り勘 計算ロジック
 *
 * 計算方法:
 * - 1人あたり = 合計金額 ÷ 人数 を、指定した単位(1円/10円/100円/500円/1000円)で切り上げ
 * - 集金合計 = 1人あたり × 人数、余り = 集金合計 − 合計金額(幹事の手元に残る)
 *
 * 前提(ページにも明記):
 * - 切り上げ方式のため、余りが出た分は幹事の負担軽減や次回繰越しに充てる想定
 */
(function (global) {
  "use strict";

  var TOTAL_MIN_YEN = 1;
  var TOTAL_MAX_YEN = 10000000;
  var PEOPLE_MIN = 2;
  var PEOPLE_MAX = 100;
  var UNITS = [1, 10, 100, 500, 1000];

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  /**
   * 割り勘を計算する。
   * @param {number} totalYen 合計金額(円・整数)
   * @param {number} people 人数(2〜100・整数)
   * @param {number} unitYen 切り上げ単位(1/10/100/500/1000)
   * @returns {{ok: true, perPerson: number, collected: number, surplus: number}
   *          |{ok: false, code: string}}
   *   code: "invalid_total" | "invalid_people" | "invalid_unit"
   */
  function split(totalYen, people, unitYen) {
    if (!isFiniteNumber(totalYen) || totalYen !== Math.floor(totalYen) ||
        totalYen < TOTAL_MIN_YEN || totalYen > TOTAL_MAX_YEN) {
      return { ok: false, code: "invalid_total" };
    }
    if (!isFiniteNumber(people) || people !== Math.floor(people) ||
        people < PEOPLE_MIN || people > PEOPLE_MAX) {
      return { ok: false, code: "invalid_people" };
    }
    if (UNITS.indexOf(unitYen) === -1) {
      return { ok: false, code: "invalid_unit" };
    }
    var perPerson = Math.ceil(totalYen / people / unitYen) * unitYen;
    var collected = perPerson * people;
    return { ok: true, perPerson: perPerson, collected: collected, surplus: collected - totalYen };
  }

  var api = {
    split: split,
    TOTAL_MIN_YEN: TOTAL_MIN_YEN,
    TOTAL_MAX_YEN: TOTAL_MAX_YEN,
    PEOPLE_MIN: PEOPLE_MIN,
    PEOPLE_MAX: PEOPLE_MAX,
    UNITS: UNITS
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.WarikanCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
