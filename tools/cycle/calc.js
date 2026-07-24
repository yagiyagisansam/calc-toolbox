/*
 * 睡眠サイクル計算ロジック
 *
 * 計算方法:
 * - 睡眠はノンレム睡眠とレム睡眠の周期(約90分)を一晩に4〜6回くり返す
 * - 就寝時刻の候補 = 起床時刻 − (90分 × サイクル数) − 入眠にかかる時間
 * - サイクル数4〜6(睡眠6〜9時間)の3候補を返す
 * - 90分は平均値で個人差が大きい(70〜110分程度)ことをページに明記
 */
(function (global) {
  "use strict";

  var CYCLE_MIN = 90;

  function parseHM(s) {
    if (typeof s !== "string") return null;
    var m = /^(\d{1,2}):([0-5]\d)$/.exec(s.trim());
    if (!m) return null;
    var h = parseInt(m[1], 10);
    if (h > 23) return null;
    return h * 60 + parseInt(m[2], 10);
  }
  function fmt(min) {
    min = ((min % 1440) + 1440) % 1440;
    var h = Math.floor(min / 60);
    var mm = min % 60;
    return h + ":" + (mm < 10 ? "0" : "") + mm;
  }

  /**
   * 起床時刻から就寝時刻の候補を計算する。
   * @param {string} wakeHM 起床時刻 "H:MM"
   * @param {number} fallAsleepMin 入眠までの時間(分・0〜60。目安15分)
   * @returns {{ok: true, options: Array<{cycles: number, sleepHours: number, bedTime: string}>}
   *          |{ok: false, code: string}}  code: "invalid_time" | "invalid_fall"
   */
  function bedTimes(wakeHM, fallAsleepMin) {
    var wake = parseHM(wakeHM);
    if (wake === null) return { ok: false, code: "invalid_time" };
    if (typeof fallAsleepMin !== "number" || !isFinite(fallAsleepMin) || fallAsleepMin < 0 || fallAsleepMin > 60) {
      return { ok: false, code: "invalid_fall" };
    }
    var options = [];
    for (var c = 6; c >= 4; c--) {
      options.push({
        cycles: c,
        sleepHours: c * CYCLE_MIN / 60,
        bedTime: fmt(wake - c * CYCLE_MIN - fallAsleepMin)
      });
    }
    return { ok: true, options: options };
  }

  /**
   * 就寝時刻から起床時刻の候補を計算する。
   */
  function wakeTimes(bedHM, fallAsleepMin) {
    var bed = parseHM(bedHM);
    if (bed === null) return { ok: false, code: "invalid_time" };
    if (typeof fallAsleepMin !== "number" || !isFinite(fallAsleepMin) || fallAsleepMin < 0 || fallAsleepMin > 60) {
      return { ok: false, code: "invalid_fall" };
    }
    var options = [];
    for (var c = 4; c <= 6; c++) {
      options.push({
        cycles: c,
        sleepHours: c * CYCLE_MIN / 60,
        wakeTime: fmt(bed + fallAsleepMin + c * CYCLE_MIN)
      });
    }
    return { ok: true, options: options };
  }

  var api = { bedTimes: bedTimes, wakeTimes: wakeTimes, CYCLE_MIN: CYCLE_MIN };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { global.CycleCalc = api; }
})(typeof window !== "undefined" ? window : globalThis);
