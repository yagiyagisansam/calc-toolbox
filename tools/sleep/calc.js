/*
 * 睡眠時間 計算ロジック
 *
 * 計算方法:
 * - 睡眠時間(分) = (起床時刻 − 就寝時刻) を24時間法で計算(日をまたぐ場合に対応)
 *
 * 前提(ページにも明記):
 * - 就寝時刻=眠りについた時刻としての単純な時間差。寝つくまでの時間・中途覚醒は含まない
 */
(function (global) {
  "use strict";

  function parseTime(hhmm) {
    if (typeof hhmm !== "string" || !/^\d{1,2}:\d{2}$/.test(hhmm)) return null;
    var h = parseInt(hhmm.split(":")[0], 10);
    var m = parseInt(hhmm.split(":")[1], 10);
    if (h < 0 || h > 23 || m < 0 || m > 59) return null;
    return h * 60 + m;
  }

  /**
   * 就寝時刻と起床時刻から睡眠時間を計算する。
   * @param {string} bedTime 就寝時刻 "HH:MM"
   * @param {string} wakeTime 起床時刻 "HH:MM"
   * @returns {{ok: true, totalMinutes: number, hours: number, minutes: number}
   *          |{ok: false, code: string}}
   *   code: "invalid_bed" | "invalid_wake" | "same_time"
   */
  function calculate(bedTime, wakeTime) {
    var bed = parseTime(bedTime);
    if (bed === null) return { ok: false, code: "invalid_bed" };
    var wake = parseTime(wakeTime);
    if (wake === null) return { ok: false, code: "invalid_wake" };
    if (bed === wake) return { ok: false, code: "same_time" };
    var total = ((wake - bed) % 1440 + 1440) % 1440;
    return {
      ok: true,
      totalMinutes: total,
      hours: Math.floor(total / 60),
      minutes: total % 60
    };
  }

  function round1Adv(v) { return Math.round(v * 10) / 10; }

  function fmtHhmmAdv(totalMin) {
    var m = ((Math.round(totalMin) % 1440) + 1440) % 1440;
    var h = Math.floor(m / 60);
    var mm = m % 60;
    return (h < 10 ? "0" + h : "" + h) + ":" + (mm < 10 ? "0" + mm : "" + mm);
  }

  /**
   * 直近1週間(7日分)の睡眠時間から平均・合計・理想との差を計算する。
   * 理想は1日7時間(成人に推奨されることが多い目安)とし、差 = 合計 − 49時間。
   * マイナスなら寝不足の積み重ね(いわゆる睡眠負債)の目安になる。
   * 丸め方針: いずれも小数第1位に四捨五入。
   * @param {Array<number>} hoursList 7日分の睡眠時間(時間・各0〜24)
   * @returns {{ok:true, avgHours:number, totalHours:number, diffHours:number}
   *          |{ok:false, code:string}}  code: "invalid_days" | "invalid_hours"
   */
  function weekStats(hoursList) {
    if (!Array.isArray(hoursList) || hoursList.length !== 7) {
      return { ok: false, code: "invalid_days" };
    }
    var total = 0;
    for (var i = 0; i < 7; i++) {
      var h = hoursList[i];
      if (typeof h !== "number" || !isFinite(h) || h < 0 || h > 24) {
        return { ok: false, code: "invalid_hours" };
      }
      total += h;
    }
    return {
      ok: true,
      avgHours: round1Adv(total / 7),
      totalHours: round1Adv(total),
      diffHours: round1Adv(total - 7 * 7)
    };
  }

  /**
   * 起床時刻と目標睡眠時間から、就寝すべき時刻を逆算する。
   * 寝つくまでの時間は含まない(布団に入ってすぐ眠る前提の単純な引き算)。
   * 丸め方針: 分単位に四捨五入。
   * @param {string} wakeTime 起床時刻 "HH:MM"
   * @param {number} targetHours 目標睡眠時間(時間・1〜16)
   * @returns {{ok:true, bedTime:string}|{ok:false, code:string}}
   *   code: "invalid_wake" | "invalid_target"
   */
  function bedTimeFor(wakeTime, targetHours) {
    var wake = parseTime(wakeTime);
    if (wake === null) return { ok: false, code: "invalid_wake" };
    if (typeof targetHours !== "number" || !isFinite(targetHours) || targetHours < 1 || targetHours > 16) {
      return { ok: false, code: "invalid_target" };
    }
    return { ok: true, bedTime: fmtHhmmAdv(wake - targetHours * 60) };
  }

  var api = {
    bedTimeFor: bedTimeFor,
    weekStats: weekStats, calculate: calculate };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.SleepCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
