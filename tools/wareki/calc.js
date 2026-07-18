/*
 * 西暦⇔和暦 変換ロジック
 *
 * 元号データの根拠(一次情報):
 * - 元号法(昭和54年法律第43号) https://laws.e-gov.go.jp/law/354AC0000000043
 * - 元号を改める政令(平成31年政令第143号・令和) https://laws.e-gov.go.jp/law/431CO0000000143
 * - 各元号の期間: 明治1868〜1912 / 大正1912〜1926 / 昭和1926〜1989 / 平成1989〜2019 / 令和2019〜
 *
 * 前提:
 * - 年単位の変換。改元があった年(1912・1926・1989・2019)は新旧両方の元号を返す
 *   (改元日を境に月日単位で切り替わるが、本ツールは年単位の概算)
 */
(function (global) {
  "use strict";

  var YEAR_MIN = 1868;
  var YEAR_MAX = 2100;

  // [元号名, 元年の西暦, 最終年の西暦(現行元号はYEAR_MAX)]
  var ERAS = [
    ["明治", 1868, 1912],
    ["大正", 1912, 1926],
    ["昭和", 1926, 1989],
    ["平成", 1989, 2019],
    ["令和", 2019, YEAR_MAX]
  ];

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function label(era, eraYear) {
    return era + (eraYear === 1 ? "元" : String(eraYear)) + "年";
  }

  /**
   * 西暦→和暦。改元年は新旧両方を返す。
   * @param {number} year 西暦年(1868〜2100)
   * @returns {{ok: true, results: Array<{era: string, eraYear: number, label: string}>}
   *          |{ok: false, code: "invalid_year"}}
   */
  function toWareki(year) {
    if (!isFiniteNumber(year) || year !== Math.floor(year) || year < YEAR_MIN || year > YEAR_MAX) {
      return { ok: false, code: "invalid_year" };
    }
    var results = [];
    for (var i = 0; i < ERAS.length; i++) {
      var era = ERAS[i];
      if (year >= era[1] && year <= era[2]) {
        var eraYear = year - era[1] + 1;
        results.push({ era: era[0], eraYear: eraYear, label: label(era[0], eraYear) });
      }
    }
    return { ok: true, results: results };
  }

  /**
   * 和暦→西暦。
   * @param {string} eraName 元号名(明治/大正/昭和/平成/令和)
   * @param {number} eraYear 和暦年(元年=1)
   * @returns {{ok: true, year: number}|{ok: false, code: string}}
   *   code: "invalid_era" | "invalid_era_year"
   */
  function toSeireki(eraName, eraYear) {
    var era = null;
    for (var i = 0; i < ERAS.length; i++) {
      if (ERAS[i][0] === eraName) { era = ERAS[i]; break; }
    }
    if (!era) return { ok: false, code: "invalid_era" };
    var maxEraYear = era[2] - era[1] + 1;
    if (!isFiniteNumber(eraYear) || eraYear !== Math.floor(eraYear) || eraYear < 1 || eraYear > maxEraYear) {
      return { ok: false, code: "invalid_era_year" };
    }
    return { ok: true, year: era[1] + eraYear - 1 };
  }

  var api = {
    toWareki: toWareki,
    toSeireki: toSeireki,
    YEAR_MIN: YEAR_MIN,
    YEAR_MAX: YEAR_MAX,
    ERAS: ERAS
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.WarekiCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
