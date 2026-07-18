/*
 * 年齢・学年(早生まれ)計算ロジック
 *
 * 根拠(一次情報):
 * - 満年齢の起算: 年齢計算ニ関スル法律(明治35年法律第50号)
 *   https://laws.e-gov.go.jp/law/135AC1000000050
 *   (法律上は誕生日の前日の満了時に加齢する。本ツールは通俗的な
 *    「誕生日当日に1歳加算」で計算し、その旨をページに明記)
 * - 早生まれ(1月1日〜4月1日生まれは前の学年): 学校教育法第17条
 *   https://laws.e-gov.go.jp/law/322AC0000000026
 *   (4月1日生まれが前学年になるのは、前日満了により3月31日に加齢するため)
 *
 * 前提:
 * - 2月29日生まれは、平年では3月1日に加齢する扱い(通俗計算)
 * - 干支(十二支)は生まれ年の西暦から算出
 */
(function (global) {
  "use strict";

  var YEAR_MIN = 1868;
  var YEAR_MAX = 2100;
  var ETO = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];

  function isLeapYear(y) {
    return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  }

  function daysInMonth(y, m) {
    return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  }

  // "YYYY-MM-DD" を検証つきで {y, m, d} に分解する。不正なら null
  function parseDate(iso) {
    if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
    var y = parseInt(iso.slice(0, 4), 10);
    var m = parseInt(iso.slice(5, 7), 10);
    var d = parseInt(iso.slice(8, 10), 10);
    if (m < 1 || m > 12) return null;
    if (d < 1 || d > daysInMonth(y, m)) return null;
    return { y: y, m: m, d: d };
  }

  /**
   * 基準日時点の満年齢・早生まれ判定・干支を計算する。
   * @param {string} birthIso 生年月日 "YYYY-MM-DD"
   * @param {string} asOfIso 基準日 "YYYY-MM-DD"
   * @returns {{ok: true, age: number, hayaumare: boolean, eto: string}
   *          |{ok: false, code: string}}
   *   code: "invalid_birth" | "invalid_asof" | "birth_after_asof"
   */
  function calculate(birthIso, asOfIso) {
    var b = parseDate(birthIso);
    if (!b || b.y < YEAR_MIN || b.y > YEAR_MAX) return { ok: false, code: "invalid_birth" };
    var a = parseDate(asOfIso);
    if (!a || a.y < YEAR_MIN || a.y > YEAR_MAX) return { ok: false, code: "invalid_asof" };
    if (a.y < b.y || (a.y === b.y && (a.m < b.m || (a.m === b.m && a.d < b.d)))) {
      return { ok: false, code: "birth_after_asof" };
    }
    var beforeBirthday = a.m < b.m || (a.m === b.m && a.d < b.d);
    var age = a.y - b.y - (beforeBirthday ? 1 : 0);
    var hayaumare = b.m === 1 || b.m === 2 || b.m === 3 || (b.m === 4 && b.d === 1);
    return {
      ok: true,
      age: age,
      hayaumare: hayaumare,
      eto: ETO[((b.y - 4) % 12 + 12) % 12]
    };
  }

  var api = {
    calculate: calculate,
    YEAR_MIN: YEAR_MIN,
    YEAR_MAX: YEAR_MAX
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.AgeCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
