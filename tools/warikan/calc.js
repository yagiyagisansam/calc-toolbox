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

  /**
   * 傾斜配分の割り勘: 「多めに払う人」(先輩・上司など)が普通の人の○倍払う分け方。
   * 普通の人 = 合計 ÷ (多め人数 × 倍率 + 普通人数) を円未満切り捨て。
   * 多めの人 = (合計 − 普通の人 × 普通人数) ÷ 多め人数 を円未満切り上げ(端数は多め側が吸収)。
   * 集金合計 − 合計金額 = 余り(切り上げで生じた分・幹事の手元に残る)。
   * @param {number} totalYen 合計金額(円・整数・1〜1,000万)
   * @param {number} heavyCount 多めに払う人数(1〜99の整数)
   * @param {number} multiplier 倍率(普通の人の何倍払うか・1〜10)
   * @param {number} normalCount 普通に払う人数(1〜99の整数)
   * @returns {{ok:true, heavyPay:number, normalPay:number, collected:number, surplus:number}
   *          |{ok:false, code:string}}
   *   code: "invalid_total" | "invalid_people" | "invalid_mult"
   */
  function weightedSplit(totalYen, heavyCount, multiplier, normalCount) {
    if (!isFiniteNumber(totalYen) || totalYen !== Math.floor(totalYen) ||
        totalYen < TOTAL_MIN_YEN || totalYen > TOTAL_MAX_YEN) {
      return { ok: false, code: "invalid_total" };
    }
    if (!isFiniteNumber(heavyCount) || heavyCount !== Math.floor(heavyCount) || heavyCount < 1 || heavyCount > 99) {
      return { ok: false, code: "invalid_people" };
    }
    if (!isFiniteNumber(normalCount) || normalCount !== Math.floor(normalCount) || normalCount < 1 || normalCount > 99) {
      return { ok: false, code: "invalid_people" };
    }
    if (heavyCount + normalCount > PEOPLE_MAX) {
      return { ok: false, code: "invalid_people" };
    }
    if (!isFiniteNumber(multiplier) || multiplier < 1 || multiplier > 10) {
      return { ok: false, code: "invalid_mult" };
    }
    var normalPay = Math.floor(totalYen / (heavyCount * multiplier + normalCount));
    var rest = totalYen - normalPay * normalCount;
    var heavyPay = Math.ceil(rest / heavyCount);
    var collected = heavyPay * heavyCount + normalPay * normalCount;
    return { ok: true, heavyPay: heavyPay, normalPay: normalPay, collected: collected, surplus: collected - totalYen };
  }

  /**
   * 集金額の過不足チェック: 「1人○円ずつ集めたら足りる?」を確認する。
   * 差額 = 集金額 × 人数 − 合計金額(プラスなら余り・マイナスなら不足)。
   * @param {number} totalYen 合計金額(円・整数・1〜1,000万)
   * @param {number} people 人数(2〜100の整数)
   * @param {number} perYen 1人から集める額(円・整数・1〜1,000万)
   * @returns {{ok:true, collected:number, diff:number}|{ok:false, code:string}}
   *   code: "invalid_total" | "invalid_people" | "invalid_per"
   */
  function collectCheck(totalYen, people, perYen) {
    if (!isFiniteNumber(totalYen) || totalYen !== Math.floor(totalYen) ||
        totalYen < TOTAL_MIN_YEN || totalYen > TOTAL_MAX_YEN) {
      return { ok: false, code: "invalid_total" };
    }
    if (!isFiniteNumber(people) || people !== Math.floor(people) ||
        people < PEOPLE_MIN || people > PEOPLE_MAX) {
      return { ok: false, code: "invalid_people" };
    }
    if (!isFiniteNumber(perYen) || perYen !== Math.floor(perYen) || perYen < 1 || perYen > TOTAL_MAX_YEN) {
      return { ok: false, code: "invalid_per" };
    }
    var collected = perYen * people;
    return { ok: true, collected: collected, diff: collected - totalYen };
  }

  var api = {
    collectCheck: collectCheck,
    weightedSplit: weightedSplit,
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
