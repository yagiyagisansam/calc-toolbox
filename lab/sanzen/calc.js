/*
 * 産前産後休業(産休)の期間計算ロジック
 *
 * 根拠(一次情報):
 * - 労働基準法(昭和22年法律第49号) 第65条(産前産後) e-Gov法令検索
 *   https://laws.e-gov.go.jp/law/322AC0000000049 (2026年7月29日参照)
 *   第1項「使用者は、六週間(多胎妊娠の場合にあつては、十四週間)以内に出産する予定の女性が
 *          休業を請求した場合においては、その者を就業させてはならない。」
 *   第2項「使用者は、産後八週間を経過しない女性を就業させてはならない。
 *          ただし、産後六週間を経過した女性が請求した場合において、その者について医師が
 *          支障がないと認めた業務に就かせることは、差し支えない。」
 *
 * 制度の時点:
 * - 2026年7月29日時点の労働基準法第65条(e-Gov法令検索)にもとづく。
 *
 * 前提:
 * - 産前6週間=42日、多胎妊娠の14週間=98日として数える。出産予定日(実際の出産日)当日を1日目として
 *   さかのぼるため、産前休業の開始日は「予定日の41日前(多胎は97日前)」になる。
 * - 産前休業は本人の請求によるもの。請求しなければ出産日まで就業できる。
 * - 出産日は産前休業に含める。産後休業は出産日の翌日から起算する。
 * - 産後8週間=56日。産後6週間=42日を経過した日の翌日以降は、本人の請求と医師の認定があれば就業できる。
 * - 出産が予定日より遅れた場合、予定日の翌日から実際の出産日までも産前休業として扱う。
 *
 * 丸め:
 * - すべて日単位。時刻は扱わない(日付計算はUTCで行い、タイムゾーンによるずれを避ける)。
 */
(function (global) {
  "use strict";

  var PRENATAL_DAYS = 42;          // 産前6週間
  var PRENATAL_DAYS_MULTIPLE = 98; // 多胎妊娠の産前14週間
  var POSTNATAL_DAYS = 56;         // 産後8週間(就業禁止)
  var POSTNATAL_MANDATORY = 42;    // 産後6週間(請求があっても就業させられない期間)
  var BIRTH_DIFF_LIMIT = 100;      // 予定日と実際の出産日の差の上限(日)

  var DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

  /**
   * "YYYY-MM-DD" を UTC の Date に変換する。存在しない日付は null。
   * @param {string} s 日付文字列
   * @returns {Date|null}
   */
  function parseDate(s) {
    if (typeof s !== "string") return null;
    var m = DATE_RE.exec(s);
    if (!m) return null;
    var y = parseInt(m[1], 10);
    var mo = parseInt(m[2], 10);
    var d = parseInt(m[3], 10);
    if (y < 1900 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    var dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    return dt;
  }

  /**
   * Date を "YYYY-MM-DD" にする。
   * @param {Date} dt 日付
   * @returns {string}
   */
  function format(dt) {
    var y = String(dt.getUTCFullYear());
    var m = String(dt.getUTCMonth() + 1);
    var d = String(dt.getUTCDate());
    return y + "-" + (m.length < 2 ? "0" + m : m) + "-" + (d.length < 2 ? "0" + d : d);
  }

  function addDays(dt, n) {
    return new Date(dt.getTime() + n * 86400000);
  }
  function diffDays(a, b) {
    return Math.round((a.getTime() - b.getTime()) / 86400000);
  }

  /**
   * 産前産後休業の期間を計算する。
   * @param {string} dueDate 出産予定日("YYYY-MM-DD")
   * @param {string|null} [birthDate] 実際の出産日("YYYY-MM-DD")。未確定なら null または省略
   * @param {boolean} [multiple=false] 多胎妊娠かどうか
   * @returns {{ok:true, prenatalStart:string, prenatalEnd:string, prenatalDays:number,
   *            postnatalStart:string, postnatalMandatoryEnd:string, earliestWorkDate:string,
   *            postnatalEnd:string, postnatalDays:number, returnDate:string,
   *            totalDays:number, birthConfirmed:boolean, birthDiffDays:number}
   *          |{ok:false, code:"invalid_due"|"invalid_birth"|"invalid_multiple"}}
   *   prenatalEnd は出産日(未確定なら出産予定日)。産後休業は出産日の翌日から数える。
   *   postnatalMandatoryEnd は産後6週間の最終日、earliestWorkDate はその翌日
   *   (本人の請求と医師の認定があれば就業できる最初の日)。
   *   returnDate は産後8週間が明けた翌日(原則の職場復帰可能日)。
   *   birthDiffDays は 実際の出産日 − 出産予定日(遅れがプラス)。未確定なら0。
   */
  function calculate(dueDate, birthDate, multiple) {
    var due = parseDate(dueDate);
    if (!due) return { ok: false, code: "invalid_due" };
    var isMultiple = multiple === undefined || multiple === null ? false : multiple;
    if (typeof isMultiple !== "boolean") return { ok: false, code: "invalid_multiple" };

    var birth = null;
    var confirmed = false;
    if (birthDate !== undefined && birthDate !== null && birthDate !== "") {
      birth = parseDate(birthDate);
      if (!birth) return { ok: false, code: "invalid_birth" };
      if (Math.abs(diffDays(birth, due)) > BIRTH_DIFF_LIMIT) return { ok: false, code: "invalid_birth" };
      confirmed = true;
    } else {
      birth = due;
    }

    var span = isMultiple ? PRENATAL_DAYS_MULTIPLE : PRENATAL_DAYS;
    // 予定日当日を1日目として数えるので、開始日は (span − 1) 日前
    var prenatalStart = addDays(due, -(span - 1));
    var prenatalEnd = birth;
    // 出産が予定日より早いと、産前休業は実際の出産日で終わる
    var prenatalDays = diffDays(prenatalEnd, prenatalStart) + 1;
    if (prenatalDays < 0) prenatalDays = 0;

    var postnatalStart = addDays(birth, 1);
    var mandatoryEnd = addDays(birth, POSTNATAL_MANDATORY);
    var postnatalEnd = addDays(birth, POSTNATAL_DAYS);

    return {
      ok: true,
      prenatalStart: format(prenatalStart),
      prenatalEnd: format(prenatalEnd),
      prenatalDays: prenatalDays,
      postnatalStart: format(postnatalStart),
      postnatalMandatoryEnd: format(mandatoryEnd),
      earliestWorkDate: format(addDays(birth, POSTNATAL_MANDATORY + 1)),
      postnatalEnd: format(postnatalEnd),
      postnatalDays: POSTNATAL_DAYS,
      returnDate: format(addDays(birth, POSTNATAL_DAYS + 1)),
      totalDays: prenatalDays + POSTNATAL_DAYS,
      birthConfirmed: confirmed,
      birthDiffDays: confirmed ? diffDays(birth, due) : 0
    };
  }

  /**
   * 産前休業の開始日だけを求める。
   * @param {string} dueDate 出産予定日("YYYY-MM-DD")
   * @param {boolean} [multiple=false] 多胎妊娠かどうか
   * @returns {{ok:true, date:string, days:number}|{ok:false, code:"invalid_due"}}
   *   days は産前休業の日数(単胎42日 / 多胎98日)。
   */
  function prenatalStartDate(dueDate, multiple) {
    var due = parseDate(dueDate);
    if (!due) return { ok: false, code: "invalid_due" };
    var span = multiple ? PRENATAL_DAYS_MULTIPLE : PRENATAL_DAYS;
    return { ok: true, date: format(addDays(due, -(span - 1))), days: span };
  }

  var api = {
    calculate: calculate,
    prenatalStartDate: prenatalStartDate,
    parseDate: parseDate,
    format: format
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.SanzenCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
