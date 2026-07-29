/*
 * 育児休業の取得可能期間(節目の日付)の計算ロジック
 *
 * 根拠(一次情報):
 * - 育児休業、介護休業等育児又は家族介護を行う労働者の福祉に関する法律
 *   (平成3年法律第76号。育児・介護休業法)
 *   https://laws.e-gov.go.jp/law/403AC0000000076 (2026年7月29日参照)
 *   ・第5条第1項: 労働者は、その養育する一歳に満たない子について…育児休業をすることができる
 *   ・第5条第2項: その養育する子が一歳に達する日(以下「一歳到達日」という。)までの期間…
 *     内に二回の育児休業をした場合には…申出をすることができない(=原則2回まで分割可)
 *   ・第5条第3項: その養育する一歳から一歳六か月に達するまでの子について…(延長)
 *   ・第5条第4項: その養育する一歳六か月から二歳に達するまでの子について…(再延長)
 *   ・第9条の2第1項: 出生時育児休業は「子の出生の日から起算して八週間を経過する日の翌日まで
 *     (出産予定日前に当該子が出生した場合にあっては当該出生の日から当該出産予定日から起算して
 *     八週間を経過する日の翌日までとし、出産予定日後に当該子が出生した場合にあっては当該出産
 *     予定日から当該出生の日から起算して八週間を経過する日の翌日までとする。)の期間内に
 *     四週間以内の期間を定めてする休業」
 *   ・第9条の2第2項: 出生時育児休業は二回まで、日数は通算二十八日まで
 *   ・第9条の6第1項: 配偶者が一歳到達日以前に育児休業をしている場合、「一歳に満たない子」を
 *     「一歳二か月に満たない子」と読み替える(パパ・ママ育休プラス)
 * - 年齢計算ニ関スル法律(明治35年法律第50号)
 *   https://laws.e-gov.go.jp/law/135AC0000000050 (2026年7月29日参照)
 *   年齢は出生の日より起算する → 民法第143条第2項により「一歳に達する日」は誕生日の前日
 *
 * 前提(2026年7月29日時点の法令):
 * - 「◯歳に達する日」「◯か月に達する日」は、起算日(出生日)に応当する日の前日。
 *   応当する日がない月(例: 2月29日生まれの翌年2月)は、その月の末日に満了する(民法第143条第2項)
 * - 出生時育児休業の期間は「min(出生日, 出産予定日) 〜 max(出生日, 出産予定日)+56日」。
 *   八週間=56日、「八週間を経過する日の翌日」= 起算日から56日後の日
 * - 表示するのは法律上の期間の上限であって、労使協定や申出期限、育児休業給付金の
 *   支給要件は別に確認が必要
 * - 延長(1歳6か月・2歳まで)は保育所に入所できない等の要件を満たす場合に限られる
 */
(function (global) {
  "use strict";

  var MIN_YEAR = 1900;
  var MAX_YEAR = 2200;
  var POSTNATAL_DAYS = 56;      // 八週間
  var POSTNATAL_MAX_DAYS = 28;  // 通算四週間
  var POSTNATAL_MAX_TIMES = 2;

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function isInt(v) {
    return isFiniteNumber(v) && v === Math.floor(v);
  }

  function daysInMonth(y, m) {
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  }

  function isRealDate(y, m, d) {
    if (!isInt(y) || !isInt(m) || !isInt(d)) return false;
    if (y < MIN_YEAR || y > MAX_YEAR) return false;
    if (m < 1 || m > 12) return false;
    return d >= 1 && d <= daysInMonth(y, m);
  }

  function pad(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function ymd(y, m, d) {
    return y + "-" + pad(m) + "-" + pad(d);
  }

  function toUtc(y, m, d) {
    return Date.UTC(y, m - 1, d);
  }

  function fromUtc(ms) {
    var dt = new Date(ms);
    return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
  }

  function addDays(y, m, d, n) {
    return fromUtc(toUtc(y, m, d) + n * 86400000);
  }

  /**
   * 起算日から n か月後の「満了日」(=◯か月に達する日)を求める。
   * 民法第143条第2項により、応当日の前日。応当日がない月はその月の末日。
   * @param {number} y 起算日の年 @param {number} m 月 @param {number} d 日
   * @param {number} n 月数(1以上)
   * @returns {{y:number, m:number, d:number}}
   */
  function expiryAfterMonths(y, m, d, n) {
    var total = (m - 1) + n;
    var ty = y + Math.floor(total / 12);
    var tm = (total % 12) + 1;
    var dim = daysInMonth(ty, tm);
    if (d > dim) return { y: ty, m: tm, d: dim }; // 応当日がない → その月の末日に満了
    var prev = fromUtc(toUtc(ty, tm, d) - 86400000);
    return prev;
  }

  /**
   * 子の生年月日から、育児休業の節目となる日付を求める。
   * @param {number} year 子の生年(1900〜2200)
   * @param {number} month 月(1〜12)
   * @param {number} day 日
   * @returns {{ok:true, birthDate:string, age1Date:string, age1m2Date:string,
   *            age1m6Date:string, age2Date:string, maxTimes:number}
   *          |{ok:false, code:"invalid_birth_date"}}
   *   age1Date  : 一歳到達日(原則の育児休業の最終日)
   *   age1m2Date: 一歳二か月に達する日(パパ・ママ育休プラスの上限)
   *   age1m6Date: 一歳六か月に達する日(1回目の延長の上限)
   *   age2Date  : 二歳に達する日(再延長の上限)
   *   maxTimes  : 原則の育児休業を分割できる回数(2回)
   *   日付はすべて "YYYY-MM-DD" 形式
   */
  function calculate(year, month, day) {
    if (!isRealDate(year, month, day)) return { ok: false, code: "invalid_birth_date" };
    var a1 = expiryAfterMonths(year, month, day, 12);
    var a12 = expiryAfterMonths(year, month, day, 14);
    var a16 = expiryAfterMonths(year, month, day, 18);
    var a2 = expiryAfterMonths(year, month, day, 24);
    return {
      ok: true,
      birthDate: ymd(year, month, day),
      age1Date: ymd(a1.y, a1.m, a1.d),
      age1m2Date: ymd(a12.y, a12.m, a12.d),
      age1m6Date: ymd(a16.y, a16.m, a16.d),
      age2Date: ymd(a2.y, a2.m, a2.d),
      maxTimes: 2
    };
  }

  /**
   * 出生時育児休業(産後パパ育休)を取得できる期間を求める。
   * @param {number} birthYear 出生日の年 @param {number} birthMonth 月 @param {number} birthDay 日
   * @param {number} [dueYear] 出産予定日の年(省略時は出生日と同じ)
   * @param {number} [dueMonth] 月 @param {number} [dueDay] 日
   * @returns {{ok:true, startDate:string, endDate:string, windowDays:number,
   *            maxDays:number, maxTimes:number}
   *          |{ok:false, code:"invalid_birth_date"|"invalid_due_date"}}
   *   startDate: 期間の初日(出生日と出産予定日の早いほう)
   *   endDate  : 期間の末日(遅いほうから起算して八週間を経過する日の翌日)
   *   windowDays: 期間の日数(初日と末日を含む)
   *   maxDays  : 通算で取得できる日数の上限(28日) / maxTimes: 分割できる回数(2回)
   */
  function postnatalWindow(birthYear, birthMonth, birthDay, dueYear, dueMonth, dueDay) {
    if (!isRealDate(birthYear, birthMonth, birthDay)) return { ok: false, code: "invalid_birth_date" };
    var hasDue = dueYear !== undefined && dueYear !== null;
    var dy = hasDue ? dueYear : birthYear;
    var dm = hasDue ? dueMonth : birthMonth;
    var dd = hasDue ? dueDay : birthDay;
    if (!isRealDate(dy, dm, dd)) return { ok: false, code: "invalid_due_date" };

    var birthMs = toUtc(birthYear, birthMonth, birthDay);
    var dueMs = toUtc(dy, dm, dd);
    var startMs = Math.min(birthMs, dueMs);
    var endMs = Math.max(birthMs, dueMs) + POSTNATAL_DAYS * 86400000;
    var s = fromUtc(startMs);
    var e = fromUtc(endMs);
    return {
      ok: true,
      startDate: ymd(s.y, s.m, s.d),
      endDate: ymd(e.y, e.m, e.d),
      windowDays: Math.round((endMs - startMs) / 86400000) + 1,
      maxDays: POSTNATAL_MAX_DAYS,
      maxTimes: POSTNATAL_MAX_TIMES
    };
  }

  var api = {
    expiryAfterMonths: expiryAfterMonths,
    calculate: calculate,
    postnatalWindow: postnatalWindow
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.IkujiKikanCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
