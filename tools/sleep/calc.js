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

  var api = { calculate: calculate };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.SleepCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
