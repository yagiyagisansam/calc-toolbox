/*
 * 定年退職日・再雇用期間の計算ロジック
 *
 * 根拠(一次情報):
 * - 年齢計算ニ関スル法律(明治35年法律第50号)
 *   https://laws.e-gov.go.jp/law/135AC1000000050 (2026年7月29日参照)
 *   「年齢ハ出生ノ日ヨリ之ヲ起算ス」「民法第百四十三条ノ規定ハ年齢ノ計算ニ之ヲ準用ス」
 *   → 起算日は誕生日当日で、応当日の前日の満了により加齢する。
 *     つまり満N歳に達するのは「誕生日の前日」。
 * - 高年齢者等の雇用の安定等に関する法律(昭和46年法律第68号)
 *   https://laws.e-gov.go.jp/law/346AC0000000068 (2026年7月29日参照)
 *   第8条「事業主がその雇用する労働者の定年…の定めをする場合には、当該定年は、
 *   六十歳を下回ることができない。」(厚生労働省令で定める業務は除く)
 *   第9条「定年(六十五歳未満のものに限る)の定めをしている事業主は、その雇用する
 *   高年齢者の六十五歳までの安定した雇用を確保するため、次の各号に掲げる措置
 *   (定年の引上げ/継続雇用制度の導入/定年の定めの廃止)のいずれかを講じなければならない。」
 *   第10条の2「定年(六十五歳以上七十歳未満のものに限る)の定めをしている事業主…は、
 *   …六十五歳から七十歳までの安定した雇用を確保するよう努めなければならない。」(努力義務)
 *
 * 制度の時点:
 * - 上記は2026年7月29日時点の現行法(高年齢者雇用安定法は令和4年10月1日施行の版)。
 *
 * 前提:
 * - 退職日をいつにするかは会社の就業規則で決まる。本ロジックは代表的な3つの規定
 *   (誕生日/年齢到達日の属する月の末日/年度末)に対応する。
 * - 年度は4月1日から翌年3月31日まで。
 * - うるう日(2月29日)生まれの年齢到達日は、平年では2月28日になる。
 * - 再雇用期間は「退職日の翌日から65歳到達日まで」として日数・月数を出す。
 *   実際の契約期間・更新条件は会社の制度による。
 */
(function (global) {
  "use strict";

  var MIN_YEAR = 1900;
  var MAX_YEAR = 2200;
  var MAX_AGE = 120;
  var MS_PER_DAY = 86400000;

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function isInt(v) {
    return isFiniteNumber(v) && Math.floor(v) === v;
  }

  function isRealDate(y, m, d) {
    if (!isInt(y) || !isInt(m) || !isInt(d)) return false;
    if (y < MIN_YEAR || y > MAX_YEAR || m < 1 || m > 12 || d < 1 || d > 31) return false;
    var dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }

  function toResult(dt) {
    return {
      year: dt.getUTCFullYear(),
      month: dt.getUTCMonth() + 1,
      day: dt.getUTCDate(),
      iso: dt.toISOString().slice(0, 10)
    };
  }

  function endOfMonth(dt) {
    return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0));
  }

  function endOfFiscalYear(dt) {
    var y = dt.getUTCFullYear();
    var fy = dt.getUTCMonth() + 1 >= 4 ? y + 1 : y;
    return new Date(Date.UTC(fy, 2, 31));
  }

  /**
   * 満N歳に達する日(年齢到達日)を求める。年齢計算ニ関スル法律により誕生日の前日になる。
   * @param {number} birthYear 生年(1900〜2200)
   * @param {number} birthMonth 生月(1〜12)
   * @param {number} birthDay 生日(1〜31。存在しない日付はエラー)
   * @param {number} age 到達する年齢(0〜120の整数)
   * @returns {{ok:true, year:number, month:number, day:number, iso:string}
   *          |{ok:false, code:"invalid_birth_date"|"invalid_age"}}
   *   iso は "YYYY-MM-DD" 形式。2月29日生まれは平年では2月28日を返す。
   */
  function ageAttainmentDate(birthYear, birthMonth, birthDay, age) {
    if (!isRealDate(birthYear, birthMonth, birthDay)) return { ok: false, code: "invalid_birth_date" };
    if (!isInt(age) || age < 0 || age > MAX_AGE) return { ok: false, code: "invalid_age" };
    // 誕生日の応当日(2/29生まれで平年なら3/1に繰り上がる)の前日
    var anniversary = new Date(Date.UTC(birthYear + age, birthMonth - 1, birthDay));
    var attained = new Date(anniversary.getTime() - MS_PER_DAY);
    if (attained.getUTCFullYear() > MAX_YEAR) return { ok: false, code: "invalid_age" };
    return Object.assign({ ok: true }, toResult(attained));
  }

  /**
   * 定年退職日と、65歳までの再雇用期間を計算する。
   * @param {number} birthYear 生年(1900〜2200)
   * @param {number} birthMonth 生月(1〜12)
   * @param {number} birthDay 生日(1〜31)
   * @param {number} retirementAge 会社の定年年齢(60〜80の整数。高年齢者雇用安定法第8条により60歳未満は不可)
   * @param {"birthday"|"end_of_month"|"end_of_fiscal_year"} rule 退職日の規定
   *   "birthday"=年齢到達日(誕生日の前日) /
   *   "end_of_month"=年齢到達日の属する月の末日 /
   *   "end_of_fiscal_year"=年齢到達日の属する年度の3月31日
   * @returns {{ok:true, attainmentDate:{year:number,month:number,day:number,iso:string},
   *            retirementDate:{year:number,month:number,day:number,iso:string},
   *            age65Date:{year:number,month:number,day:number,iso:string},
   *            reemploymentDays:number, reemploymentMonths:number,
   *            needsMeasureTo65:boolean, effortTo70:boolean}
   *          |{ok:false, code:"invalid_birth_date"|"invalid_age"|"invalid_rule"}}
   *   reemploymentDays は退職日の翌日から65歳到達日までの日数(両端を含む。すでに過ぎていれば0)。
   *   reemploymentMonths は日数を30.4375(1年365.25日の1/12)で割って小数第1位で四捨五入した目安。
   *   needsMeasureTo65 は定年が65歳未満か(第9条の高年齢者雇用確保措置の対象)。
   *   effortTo70 は定年が65歳以上70歳未満か(第10条の2の高年齢者就業確保措置の努力義務の対象)。
   */
  function retirementDate(birthYear, birthMonth, birthDay, retirementAge, rule) {
    if (rule !== "birthday" && rule !== "end_of_month" && rule !== "end_of_fiscal_year") {
      return { ok: false, code: "invalid_rule" };
    }
    if (!isInt(retirementAge) || retirementAge < 60 || retirementAge > 80) {
      return { ok: false, code: "invalid_age" };
    }
    var att = ageAttainmentDate(birthYear, birthMonth, birthDay, retirementAge);
    if (!att.ok) return att;
    var a65 = ageAttainmentDate(birthYear, birthMonth, birthDay, 65);
    if (!a65.ok) return a65;

    var attDate = new Date(att.iso + "T00:00:00Z");
    var retire = rule === "end_of_month" ? endOfMonth(attDate)
      : rule === "end_of_fiscal_year" ? endOfFiscalYear(attDate)
      : attDate;
    var date65 = new Date(a65.iso + "T00:00:00Z");
    // 退職日の翌日から65歳到達日までの日数(両端を含む)は (65歳到達日 − 退職日) と等しい
    var days = Math.max(0, Math.round((date65.getTime() - retire.getTime()) / MS_PER_DAY));

    return {
      ok: true,
      attainmentDate: toResult(attDate),
      retirementDate: toResult(retire),
      age65Date: toResult(date65),
      reemploymentDays: days,
      reemploymentMonths: Math.round(days / 30.4375 * 10) / 10,
      needsMeasureTo65: retirementAge < 65,
      effortTo70: retirementAge >= 65 && retirementAge < 70
    };
  }

  var api = {
    ageAttainmentDate: ageAttainmentDate,
    retirementDate: retirementDate
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.TeinenCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
