/*
 * 入学・卒業年計算ロジック
 *
 * 計算方法:
 * - 学年は「4月2日生まれ〜翌年4月1日生まれ」が同学年(学校教育法・年齢計算に関する法律の
 *   運用: 4月1日生まれは誕生日の前日に満6歳に達するため上の学年になる)
 * - 小学校入学年 = 4/2〜12/31生まれ → 生まれ年+7 / 1/1〜4/1生まれ(早生まれ)→ 生まれ年+6
 * - 以降: 小学校6年・中学校3年・高校3年・大学4年(入学は4月・卒業は3月)
 */
(function (global) {
  "use strict";

  var YEAR_MIN = 1900;
  var YEAR_MAX = 2100;

  function isLeapYear(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
  function daysInMonth(y, m) {
    return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  }

  /**
   * 西暦年を和暦表記にする(明治〜令和)。
   */
  function wareki(year) {
    if (year >= 2019) return "令和" + (year - 2018 === 1 ? "元" : year - 2018) + "年";
    if (year >= 1989) return "平成" + (year - 1988 === 1 ? "元" : year - 1988) + "年";
    if (year >= 1926) return "昭和" + (year - 1925 === 1 ? "元" : year - 1925) + "年";
    if (year >= 1912) return "大正" + (year - 1911 === 1 ? "元" : year - 1911) + "年";
    return "明治" + (year - 1867) + "年";
  }

  /**
   * 生年月日から入学・卒業年を計算する。
   * @param {string} birthIso 生年月日 "YYYY-MM-DD"
   * @returns {{ok: true, hayaumare: boolean, elemIn: number, elemOut: number,
   *            jhsIn: number, jhsOut: number, hsIn: number, hsOut: number,
   *            uniIn: number, uniOut: number}|{ok: false, code: string}}
   *   各値は西暦年(入学=その年の4月、卒業=その年の3月) / code: "invalid_date"
   */
  function schoolYears(birthIso) {
    if (typeof birthIso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(birthIso)) {
      return { ok: false, code: "invalid_date" };
    }
    var y = parseInt(birthIso.slice(0, 4), 10);
    var m = parseInt(birthIso.slice(5, 7), 10);
    var d = parseInt(birthIso.slice(8, 10), 10);
    if (y < YEAR_MIN || y > YEAR_MAX || m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) {
      return { ok: false, code: "invalid_date" };
    }
    var hayaumare = m === 1 || m === 2 || m === 3 || (m === 4 && d === 1);
    var elemIn = y + (hayaumare ? 6 : 7);
    return {
      ok: true,
      hayaumare: hayaumare,
      elemIn: elemIn, elemOut: elemIn + 6,
      jhsIn: elemIn + 6, jhsOut: elemIn + 9,
      hsIn: elemIn + 9, hsOut: elemIn + 12,
      uniIn: elemIn + 12, uniOut: elemIn + 16
    };
  }

  /**
   * 浪人・留年・休学の年数を分けて入力できる、補正付きの入学・卒業年計算。
   * - 浪人(ronin): 高校卒業から大学入学までの年数 → 大学入学以降を後ろにずらす
   * - 留年(ryunen)・休学(kyugaku): 大学在学が延びる年数 → 大学卒業以降を後ろにずらす
   * - 大学院は標準修業年限(修士2年・博士3年)で計算(学校教育法による標準年限)
   * @param {string} birthIso 生年月日 "YYYY-MM-DD"
   * @param {number} ronin 浪人の年数(0〜10の整数)
   * @param {number} ryunen 大学での留年の年数(0〜10の整数)
   * @param {number} kyugaku 大学での休学の年数(0〜10の整数)
   * @param {string} grad 進学 "none"(大学まで) | "master"(修士まで) | "doctor"(博士まで)
   * @returns {{ok:true, hayaumare:boolean, elemIn:number, elemOut:number,
   *            jhsIn:number, jhsOut:number, hsIn:number, hsOut:number,
   *            uniIn:number, uniOut:number,
   *            msIn:(number|null), msOut:(number|null), drIn:(number|null), drOut:(number|null)}
   *          |{ok:false, code:string}}
   *   code: "invalid_date" | "invalid_years" | "invalid_grad"
   */
  function detailedYears(birthIso, ronin, ryunen, kyugaku, grad) {
    var base = schoolYears(birthIso);
    if (!base.ok) return base;
    function validYears(v) {
      return typeof v === "number" && v === Math.floor(v) && v >= 0 && v <= 10;
    }
    if (!validYears(ronin) || !validYears(ryunen) || !validYears(kyugaku)) {
      return { ok: false, code: "invalid_years" };
    }
    if (grad !== "none" && grad !== "master" && grad !== "doctor") {
      return { ok: false, code: "invalid_grad" };
    }
    var uniIn = base.hsOut + ronin;
    var uniOut = uniIn + 4 + ryunen + kyugaku;
    var msIn = null, msOut = null, drIn = null, drOut = null;
    if (grad === "master" || grad === "doctor") {
      msIn = uniOut;
      msOut = msIn + 2;
    }
    if (grad === "doctor") {
      drIn = msOut;
      drOut = drIn + 3;
    }
    return {
      ok: true,
      hayaumare: base.hayaumare,
      elemIn: base.elemIn, elemOut: base.elemOut,
      jhsIn: base.jhsIn, jhsOut: base.jhsOut,
      hsIn: base.hsIn, hsOut: base.hsOut,
      uniIn: uniIn, uniOut: uniOut,
      msIn: msIn, msOut: msOut, drIn: drIn, drOut: drOut
    };
  }

  var api = {
    detailedYears: detailedYears, schoolYears: schoolYears, wareki: wareki };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { global.RirekiCalc = api; }
})(typeof window !== "undefined" ? window : globalThis);
