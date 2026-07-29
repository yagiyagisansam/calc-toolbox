/*
 * うるう年の判定と、前後のうるう年・2月29日生まれの年齢の扱いを計算するロジック
 *
 * 基準の時点: 2026年7月時点。グレゴリオ暦の置閏法と、年齢計算に関する法令による。
 *
 * 根拠(一次情報):
 * - 国立天文台 暦計算室「暦Wiki/グレゴリオ暦」
 *   https://eco.mtk.nao.ac.jp/koyomi/wiki/A5B0A5ECA5B4A5EAA5AACEF1.html (2026年7月29日参照)
 *   ・グレゴリオ暦は4年に1度うるう年を置きつつ、400年で3回のうるう年を取り除く。
 *     具体的には、4で割り切れる年をうるう年とし、100で割り切れる年は平年、
 *     400で割り切れる年はうるう年とする。1年の平均の長さは365.2425日になる。
 *   ・2000年・2400年はうるう年、2100年・2200年・2300年は平年
 * - 国立天文台「どの年がうるう年になるの?」
 *   https://www.nao.ac.jp/faq/a0306.html (2026年7月29日参照)
 * - 年齢計算ニ関スル法律(明治35年法律第50号) e-Gov法令検索
 *   https://laws.e-gov.go.jp/law/135AC1000000050 (2026年7月29日参照)
 *   ・「年齢ハ出生ノ日ヨリ之ヲ起算ス」(出生日を1日目として数える)
 *   ・「民法第百四十三条ノ規定ハ年齢ノ計算ニ之ヲ準用ス」
 * - 民法(明治29年法律第89号) 第143条 e-Gov法令検索
 *   https://laws.e-gov.go.jp/law/129AC0000000089 (2026年7月29日参照)
 *   ・第2項「週、月又は年の初めから期間を起算しないときは、その期間は、最後の週、月又は年に
 *     おいてその起算日に応当する日の前日に満了する。ただし、月又は年によって期間を定めた場合に
 *     おいて、最後の月に応当する日がないときは、その月の末日に満了する。」
 *
 * 前提:
 * - グレゴリオ暦の置閏法だけを扱う。日本がグレゴリオ暦を採用したのは明治6年(1873年)1月1日で、
 *   それ以前の日本の暦(太陰太陽暦)には当てはまらない。
 * - 満年齢は、出生日を起算日として1年の期間が満了した日(誕生日の前日)の終了時に1つ増える。
 *   2月29日生まれの人は、平年には応当する日がないため2月28日の終了時に1つ増える。
 *   このため「基準日の月日が誕生日の月日に達しているか」で数える通常の方法と結果が一致する。
 * - 年の範囲は1583年〜9999年(グレゴリオ暦が使われ始めた翌年以降)とする。
 */
(function (global) {
  "use strict";

  var YEAR_MIN = 1583;
  var YEAR_MAX = 9999;
  var LIST_MAX = 2000; // listLeapYears が返す件数の上限

  function isInt(v) {
    return typeof v === "number" && isFinite(v) && Math.floor(v) === v;
  }

  /**
   * 指定した年がうるう年かどうかを判定する
   * @param {number} year 西暦の年(1583〜9999の整数)
   * @returns {{ok:true, leap:boolean, reason:"div400"|"div100"|"div4"|"common", days:number}
   *          |{ok:false, code:"invalid_year"}}
   *   reason は判定の決め手。"div400"=400で割り切れるのでうるう年、
   *   "div100"=100で割り切れるので平年、"div4"=4で割り切れるのでうるう年、"common"=4で割り切れない平年。
   *   days はその年の日数(365か366)
   */
  function isLeap(year) {
    if (!isInt(year) || year < YEAR_MIN || year > YEAR_MAX) {
      return { ok: false, code: "invalid_year" };
    }
    var reason, leap;
    if (year % 400 === 0) { leap = true; reason = "div400"; }
    else if (year % 100 === 0) { leap = false; reason = "div100"; }
    else if (year % 4 === 0) { leap = true; reason = "div4"; }
    else { leap = false; reason = "common"; }
    return { ok: true, leap: leap, reason: reason, days: leap ? 366 : 365 };
  }

  /**
   * 指定した年の前後のうるう年を求める
   * @param {number} year 西暦の年(1583〜9999の整数)
   * @returns {{ok:true, leap:boolean, previous:(number|null), next:(number|null)}
   *          |{ok:false, code:"invalid_year"}}
   *   previous はその年より前の直近のうるう年、next はその年より後の直近のうるう年。
   *   範囲(1583〜9999)を出る場合は null
   */
  function neighbours(year) {
    var r = isLeap(year);
    if (!r.ok) return r;
    var prev = null, next = null, y;
    for (y = year - 1; y >= YEAR_MIN; y--) {
      if (isLeap(y).leap) { prev = y; break; }
    }
    for (y = year + 1; y <= YEAR_MAX; y++) {
      if (isLeap(y).leap) { next = y; break; }
    }
    return { ok: true, leap: r.leap, previous: prev, next: next };
  }

  /**
   * 指定した範囲のうるう年を列挙する
   * @param {number} fromYear 開始年(この年を含む)
   * @param {number} toYear 終了年(この年を含む)
   * @returns {{ok:true, years:Array<number>, count:number, days:number}
   *          |{ok:false, code:"invalid_year"|"invalid_range"|"too_wide"}}
   *   count はうるう年の数、days はその範囲の合計日数
   */
  function listLeapYears(fromYear, toYear) {
    var a = isLeap(fromYear);
    if (!a.ok) return a;
    var b = isLeap(toYear);
    if (!b.ok) return b;
    if (fromYear > toYear) return { ok: false, code: "invalid_range" };
    if (toYear - fromYear + 1 > LIST_MAX) return { ok: false, code: "too_wide" };
    var years = [];
    var days = 0;
    for (var y = fromYear; y <= toYear; y++) {
      var r = isLeap(y);
      days += r.days;
      if (r.leap) years.push(y);
    }
    return { ok: true, years: years, count: years.length, days: days };
  }

  /**
   * 誕生日と基準日から満年齢を計算する(2月29日生まれにも対応)
   * @param {number} birthYear 生まれた年
   * @param {number} birthMonth 生まれた月(1〜12)
   * @param {number} birthDay 生まれた日(1〜31)
   * @param {number} refYear 基準日の年
   * @param {number} refMonth 基準日の月(1〜12)
   * @param {number} refDay 基準日の日(1〜31)
   * @returns {{ok:true, age:number, isFeb29Birth:boolean, birthdayThisYear:string}
   *          |{ok:false, code:"invalid_birth_date"|"invalid_reference_date"|"reference_before_birth"}}
   *   age は基準日時点の満年齢。isFeb29Birth は2月29日生まれかどうか。
   *   birthdayThisYear は基準日の年における「年齢が増える日」("YYYY-MM-DD")。
   *   2月29日生まれで基準日の年が平年のときは2月28日になる
   */
  function ageOn(birthYear, birthMonth, birthDay, refYear, refMonth, refDay) {
    if (!validDate(birthYear, birthMonth, birthDay)) {
      return { ok: false, code: "invalid_birth_date" };
    }
    if (!validDate(refYear, refMonth, refDay)) {
      return { ok: false, code: "invalid_reference_date" };
    }
    var birthKey = birthYear * 10000 + birthMonth * 100 + birthDay;
    var refKey = refYear * 10000 + refMonth * 100 + refDay;
    if (refKey < birthKey) return { ok: false, code: "reference_before_birth" };

    var age = refYear - birthYear;
    if (refMonth * 100 + refDay < birthMonth * 100 + birthDay) age--;

    var isFeb29 = birthMonth === 2 && birthDay === 29;
    var m = birthMonth, d = birthDay;
    if (isFeb29 && !isLeap(refYear).leap) d = 28;
    return {
      ok: true,
      age: age,
      isFeb29Birth: isFeb29,
      birthdayThisYear: refYear + "-" + (m < 10 ? "0" : "") + m + "-" + (d < 10 ? "0" : "") + d
    };
  }

  function validDate(y, m, d) {
    if (!isInt(y) || y < YEAR_MIN || y > YEAR_MAX) return false;
    if (!isInt(m) || m < 1 || m > 12) return false;
    if (!isInt(d) || d < 1 || d > 31) return false;
    var last = [31, isLeap(y).leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
    return d <= last;
  }

  var api = {
    isLeap: isLeap,
    neighbours: neighbours,
    listLeapYears: listLeapYears,
    ageOn: ageOn
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.UruudoshiCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
