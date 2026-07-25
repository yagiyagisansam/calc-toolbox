/*
 * 年次有給休暇の付与日数 計算ロジック
 *
 * 付与日数表の根拠(一次情報):
 * - 労働基準法 第39条 https://laws.e-gov.go.jp/law/322AC0000000049
 * - 比例付与の日数: 労働基準法施行規則 第24条の3
 *   https://laws.e-gov.go.jp/law/322M40000100023
 * - 表の数値は厚生労働省(愛媛労働局)「年次有給休暇に関するQ&A」から転記(2026-07-18参照)
 *   https://jsite.mhlw.go.jp/ehime-roudoukyoku/yokuaru_goshitsumon/shurouchu/2040202.html
 *
 * 前提(ページにも明記):
 * - 付与には「雇入れから6ヶ月継続勤務」かつ「全労働日の8割以上出勤」が必要
 * - 通常の労働者 = 週所定労働時間30時間以上、または週所定労働日数5日以上
 * - 比例付与 = 週30時間未満かつ週4日以下(年216日以下)のパート等
 */
(function (global) {
  "use strict";

  // 勤続年数の区分: [0]=6ヶ月 [1]=1年6ヶ月 ... [6]=6年6ヶ月以上
  var SERVICE_LABELS = ["6ヶ月", "1年6ヶ月", "2年6ヶ月", "3年6ヶ月", "4年6ヶ月", "5年6ヶ月", "6年6ヶ月以上"];

  var GRANT_TABLE = {
    full: [10, 11, 12, 14, 16, 18, 20],
    d4: [7, 8, 9, 10, 12, 13, 15],
    d3: [5, 6, 6, 8, 9, 10, 11],
    d2: [3, 4, 4, 5, 6, 6, 7],
    d1: [1, 2, 2, 2, 3, 3, 3]
  };

  /**
   * 有給休暇の付与日数を求める。
   * @param {string} workerType "full"(通常) | "d4" | "d3" | "d2" | "d1"(週所定労働日数)
   * @param {number} serviceStep 勤続区分(0=6ヶ月 〜 6=6年6ヶ月以上)
   * @returns {{ok: true, days: number, serviceLabel: string, obligation5days: boolean}
   *          |{ok: false, code: string}}
   *   obligation5days: 年5日の時季指定義務の対象(付与日数10日以上)か
   *   code: "invalid_worker_type" | "invalid_service"
   */
  function grantedDays(workerType, serviceStep) {
    if (!(workerType in GRANT_TABLE)) {
      return { ok: false, code: "invalid_worker_type" };
    }
    if (typeof serviceStep !== "number" || serviceStep !== Math.floor(serviceStep) ||
        serviceStep < 0 || serviceStep > 6) {
      return { ok: false, code: "invalid_service" };
    }
    var days = GRANT_TABLE[workerType][serviceStep];
    return {
      ok: true,
      days: days,
      serviceLabel: SERVICE_LABELS[serviceStep],
      obligation5days: days >= 10
    };
  }

  /**
   * 入社日から次回の有給付与日と付与日数を予測する。
   * 労働基準法第39条: 雇入れの日から6ヶ月継続勤務で最初の付与、
   * 以後は1年ごとに付与(付与日数は GRANT_TABLE の法定最低日数)。
   * 8割以上の出勤率を満たしている前提の予測。
   * 6ヶ月後・1年後の同日が存在しない場合(月末など)は月末に繰り上げる。
   * @param {string} hireIso 入社日 "YYYY-MM-DD"
   * @param {string} workerType "full" | "d4" | "d3" | "d2" | "d1"
   * @param {string} todayIso 基準日 "YYYY-MM-DD"(通常は今日)
   * @returns {{ok: true, nextDate: string, days: number, serviceLabel: string,
   *            obligation5days: boolean, history: {date: string, days: number, label: string}[]}
   *          |{ok: false, code: string}}
   *   history: 基準日までに付与済みの日付と日数(古い順)
   *   code: "invalid_worker_type" | "invalid_date" | "invalid_today"
   */
  function nextGrant(hireIso, workerType, todayIso) {
    if (!(workerType in GRANT_TABLE)) {
      return { ok: false, code: "invalid_worker_type" };
    }
    function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
    function dim(y, m) {
      return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
    }
    function parse(iso) {
      if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
      var y = parseInt(iso.slice(0, 4), 10);
      var m = parseInt(iso.slice(5, 7), 10);
      var d = parseInt(iso.slice(8, 10), 10);
      if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > dim(y, m)) return null;
      return { y: y, m: m, d: d };
    }
    function fmt(y, m, d) {
      return String(y) + "-" + (m < 10 ? "0" : "") + m + "-" + (d < 10 ? "0" : "") + d;
    }
    function addMonths(p, n) {
      var t = p.m - 1 + n;
      var y = p.y + Math.floor(t / 12);
      var m = (t % 12) + 1;
      return { y: y, m: m, d: Math.min(p.d, dim(y, m)) };
    }
    var hire = parse(hireIso);
    if (!hire) return { ok: false, code: "invalid_date" };
    var today = parse(todayIso);
    if (!today) return { ok: false, code: "invalid_today" };
    var todayStr = fmt(today.y, today.m, today.d);
    var history = [];
    var n = 0;
    var g;
    var gStr;
    while (n < 200) {
      g = addMonths(hire, 6 + 12 * n);
      gStr = fmt(g.y, g.m, g.d);
      if (gStr >= todayStr) break;
      var stepPast = Math.min(n, 6);
      history.push({
        date: gStr,
        days: GRANT_TABLE[workerType][stepPast],
        label: SERVICE_LABELS[stepPast]
      });
      n++;
    }
    var step = Math.min(n, 6);
    var days = GRANT_TABLE[workerType][step];
    return {
      ok: true,
      nextDate: gStr,
      days: days,
      serviceLabel: SERVICE_LABELS[step],
      obligation5days: days >= 10,
      history: history
    };
  }

  var api = {
    nextGrant: nextGrant,
    grantedDays: grantedDays,
    SERVICE_LABELS: SERVICE_LABELS,
    GRANT_TABLE: GRANT_TABLE
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.YukyuCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
