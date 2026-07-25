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

  /**
   * 睡眠周期の長さを80・90・100分から選んで、就寝(または起床)時刻の候補を計算する。
   * 計算方法は bedTimes / wakeTimes と同じで、周期90分固定の代わりに cycleMin を使う:
   * - 就寝候補 = 起床時刻 − (周期 × サイクル数4〜6) − 入眠時間
   * - 起床候補 = 就寝時刻 + 入眠時間 + (周期 × サイクル数4〜6)
   * 周期は個人差が大きい(70〜110分程度)ため3段階から選ぶ方式。
   * 丸め方針: 睡眠時間(時間)は小数第1位で四捨五入。
   * @param {string} direction "bed"(起床時刻から就寝候補) | "wake"(就寝時刻から起床候補)
   * @param {string} timeHM 基準の時刻 "H:MM"
   * @param {number} fallAsleepMin 入眠までの時間(分・0〜60)
   * @param {number} cycleMin 周期の長さ(分)。80・90・100のいずれか
   * @returns {{ok:true, options:Array<{cycles:number, sleepHours:number, time:string}>}
   *          |{ok:false, code:string}}
   *   code: "invalid_mode" | "invalid_time" | "invalid_fall" | "invalid_cycle"
   */
  function customOptions(direction, timeHM, fallAsleepMin, cycleMin) {
    if (direction !== "bed" && direction !== "wake") {
      return { ok: false, code: "invalid_mode" };
    }
    if (cycleMin !== 80 && cycleMin !== 90 && cycleMin !== 100) {
      return { ok: false, code: "invalid_cycle" };
    }
    var base = parseHM(timeHM);
    if (base === null) return { ok: false, code: "invalid_time" };
    if (typeof fallAsleepMin !== "number" || !isFinite(fallAsleepMin) ||
        fallAsleepMin < 0 || fallAsleepMin > 60) {
      return { ok: false, code: "invalid_fall" };
    }
    var options = [];
    if (direction === "bed") {
      for (var c = 6; c >= 4; c--) {
        options.push({
          cycles: c,
          sleepHours: Math.round(c * cycleMin / 60 * 10) / 10,
          time: fmt(base - c * cycleMin - fallAsleepMin)
        });
      }
    } else {
      for (var c2 = 4; c2 <= 6; c2++) {
        options.push({
          cycles: c2,
          sleepHours: Math.round(c2 * cycleMin / 60 * 10) / 10,
          time: fmt(base + fallAsleepMin + c2 * cycleMin)
        });
      }
    }
    return { ok: true, options: options };
  }

  var api = {
    customOptions: customOptions, bedTimes: bedTimes, wakeTimes: wakeTimes, CYCLE_MIN: CYCLE_MIN };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { global.CycleCalc = api; }
})(typeof window !== "undefined" ? window : globalThis);
