/*
 * 日本の学年 計算ロジック(生年月日 → 今の学年 / 学年 → 生まれ年)
 *
 * 計算方法の根拠:
 * - 学校教育法第17条: 保護者は子が満6歳に達した日の翌日以後における最初の学年の初めから
 *   小学校に就学させる義務を負う(学年は4月1日に始まり翌年3月31日に終わる。学校教育法施行規則第59条)
 * - 年齢計算ニ関スル法律・民法第143条: 誕生日の前日の満了時に年齢が加算されるため、
 *   4月1日生まれは3月31日に満6歳となり、1つ上の学年になる(いわゆる早生まれ)
 * → 同じ学年になるのは「4月2日生まれ〜翌年4月1日生まれ」
 *
 * 前提:
 * - 標準的な進級(留年・飛び級なし)。小学校6年・中学校3年・高校3年
 * - 義務教育は小学校・中学校の9年。高校は義務教育ではない
 */
(function (global) {
  "use strict";

  var YEAR_MIN = 1900;
  var YEAR_MAX = 2100;

  // [段階キー, 表示名, 学年数, 通算開始学年]
  var STAGES = [
    ["elementary", "小学校", 6, 1],
    ["juniorhigh", "中学校", 3, 7],
    ["highschool", "高校", 3, 10]
  ];

  function isLeapYear(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
  function daysInMonth(y, m) {
    return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  }
  function parseDate(iso) {
    if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
    var y = parseInt(iso.slice(0, 4), 10);
    var m = parseInt(iso.slice(5, 7), 10);
    var d = parseInt(iso.slice(8, 10), 10);
    if (y < YEAR_MIN || y > YEAR_MAX) return null;
    if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
    return { y: y, m: m, d: d };
  }

  /**
   * 学年の区切り年(コホート年)。4/2〜12/31生まれはその年、1/1〜4/1生まれは前年。
   */
  function cohortYear(p) {
    return (p.m > 4 || (p.m === 4 && p.d >= 2)) ? p.y : p.y - 1;
  }

  /**
   * 基準日が属する年度(4月1日始まり)。
   */
  function schoolYearOf(p) {
    return p.m >= 4 ? p.y : p.y - 1;
  }

  /**
   * 通算学年(小1=1 … 高3=12)から段階と段階内学年を求める。
   * @returns {{stage:string, stageName:string, gradeInStage:number}|null}
   */
  function splitGrade(overall) {
    for (var i = 0; i < STAGES.length; i++) {
      var s = STAGES[i];
      if (overall >= s[3] && overall < s[3] + s[2]) {
        return { stage: s[0], stageName: s[1], gradeInStage: overall - s[3] + 1 };
      }
    }
    return null;
  }

  /**
   * 生年月日と基準日から、その時点の学年を求める。
   * @param {string} birthIso 生年月日 "YYYY-MM-DD"
   * @param {string} refIso   基準日 "YYYY-MM-DD"
   * @returns {{ok:true, schoolYear:number, overallGrade:number, stage:string,
   *            stageName:string, gradeInStage:number, label:string, hayaumare:boolean}
   *          |{ok:true, schoolYear:number, overallGrade:number, stage:"preschool"|"graduated",
   *            label:string, hayaumare:boolean}
   *          |{ok:false, code:"invalid_date"|"invalid_order"}}
   *   stage: "preschool"(就学前) / "elementary" / "juniorhigh" / "highschool" / "graduated"(高校卒業後)
   */
  function gradeOn(birthIso, refIso) {
    var b = parseDate(birthIso);
    var r = parseDate(refIso);
    if (!b || !r) return { ok: false, code: "invalid_date" };
    var bSerial = b.y * 10000 + b.m * 100 + b.d;
    var rSerial = r.y * 10000 + r.m * 100 + r.d;
    if (rSerial < bSerial) return { ok: false, code: "invalid_order" };

    var c = cohortYear(b);
    var sy = schoolYearOf(r);
    var overall = sy - (c + 7) + 1;
    var hayaumare = b.m === 1 || b.m === 2 || b.m === 3 || (b.m === 4 && b.d === 1);

    if (overall < 1) {
      return { ok: true, schoolYear: sy, overallGrade: overall, stage: "preschool",
        label: "就学前", hayaumare: hayaumare };
    }
    if (overall > 12) {
      return { ok: true, schoolYear: sy, overallGrade: overall, stage: "graduated",
        label: "高校卒業後", hayaumare: hayaumare };
    }
    var sp = splitGrade(overall);
    return { ok: true, schoolYear: sy, overallGrade: overall, stage: sp.stage,
      stageName: sp.stageName, gradeInStage: sp.gradeInStage,
      label: sp.stageName + sp.gradeInStage + "年", hayaumare: hayaumare };
  }

  /**
   * 年度と通算学年から、その学年の子の生年月日の範囲を求める(逆引き)。
   * @param {number} schoolYear 年度(西暦)
   * @param {number} overallGrade 通算学年(1〜12)
   * @returns {{ok:true, from:string, to:string, label:string}
   *          |{ok:false, code:"invalid_year"|"invalid_grade"}}
   */
  function birthRangeOf(schoolYear, overallGrade) {
    if (typeof schoolYear !== "number" || schoolYear !== Math.floor(schoolYear) ||
        schoolYear < YEAR_MIN || schoolYear > YEAR_MAX) {
      return { ok: false, code: "invalid_year" };
    }
    if (typeof overallGrade !== "number" || overallGrade !== Math.floor(overallGrade) ||
        overallGrade < 1 || overallGrade > 12) {
      return { ok: false, code: "invalid_grade" };
    }
    var c = schoolYear - overallGrade + 1 - 7;
    var sp = splitGrade(overallGrade);
    return {
      ok: true,
      from: c + "-04-02",
      to: (c + 1) + "-04-01",
      label: sp.stageName + sp.gradeInStage + "年"
    };
  }

  /**
   * 通算学年に対応する、その年度内の入学年月・卒業年月。
   * @param {number} schoolYear 年度(西暦)
   * @param {number} overallGrade 通算学年(1〜12)
   * @returns {{ok:true, stageName:string, entryYear:number, gradYear:number}
   *          |{ok:false, code:string}}
   *   entryYear: その段階に入学した年(4月) / gradYear: その段階を卒業する年(3月)
   */
  function stageTerm(schoolYear, overallGrade) {
    var range = birthRangeOf(schoolYear, overallGrade);
    if (!range.ok) return range;
    var sp = splitGrade(overallGrade);
    var stageDef = null;
    for (var i = 0; i < STAGES.length; i++) if (STAGES[i][0] === sp.stage) stageDef = STAGES[i];
    var entry = schoolYear - (sp.gradeInStage - 1);
    return {
      ok: true,
      stageName: sp.stageName,
      entryYear: entry,
      gradYear: entry + stageDef[2]
    };
  }

  var api = {
    gradeOn: gradeOn,
    birthRangeOf: birthRangeOf,
    stageTerm: stageTerm,
    STAGES: STAGES,
    YEAR_MIN: YEAR_MIN,
    YEAR_MAX: YEAR_MAX
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.GakunenCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
