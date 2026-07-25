/*
 * 時間計算ロジック(時間の合計・時刻の差)
 *
 * 計算方法:
 * - "H:MM" 形式を分に変換して計算する
 * - 合計: 各時間を分に直して加算
 * - 時刻の差: 終了 − 開始。終了が開始より前なら日をまたいだとみなして+24時間
 * - 10進数換算 = 合計分 ÷ 60(小数第2位で四捨五入。給与計算などで使う表記)
 */
(function (global) {
  "use strict";

  function parseHM(s, maxH) {
    if (typeof s !== "string") return null;
    var m = /^(\d{1,3}):([0-5]\d)$/.exec(s.trim());
    if (!m) return null;
    var h = parseInt(m[1], 10);
    if (h > maxH) return null;
    return h * 60 + parseInt(m[2], 10);
  }

  function pack(totalMin) {
    return {
      ok: true,
      totalMinutes: totalMin,
      hours: Math.floor(totalMin / 60),
      minutes: totalMin % 60,
      decimal: Math.round(totalMin / 60 * 100) / 100
    };
  }

  /**
   * 時間("H:MM")のリストを合計する。
   * @param {string[]} list 例: ["1:30", "0:45", "8:00"]
   * @returns {{ok: true, totalMinutes: number, hours: number, minutes: number, decimal: number}
   *          |{ok: false, code: string}}  code: "invalid_list" | "invalid_time"
   */
  function total(list) {
    if (!Array.isArray(list) || list.length < 1 || list.length > 100) {
      return { ok: false, code: "invalid_list" };
    }
    var sum = 0;
    for (var i = 0; i < list.length; i++) {
      var min = parseHM(list[i], 999);
      if (min === null) return { ok: false, code: "invalid_time" };
      sum += min;
    }
    return pack(sum);
  }

  /**
   * 開始〜終了時刻の経過時間を計算する(日またぎ対応)。
   * @param {string} start "HH:MM"(0〜23時台)
   * @param {string} end "HH:MM"
   * @returns 同上
   */
  function span(start, end) {
    var s = parseHM(start, 23);
    var e = parseHM(end, 23);
    if (s === null) return { ok: false, code: "invalid_start" };
    if (e === null) return { ok: false, code: "invalid_end" };
    var diff = e - s;
    if (diff < 0) diff += 24 * 60;
    return pack(diff);
  }

  /**
   * タイムカード計算: 出勤・退勤時刻と休憩から実働時間を求める(日またぎ対応)。
   * 退勤が出勤より前の時刻なら翌日とみなす(span と同じ)。実働 = 拘束時間 − 休憩。
   * nightMinutes は勤務時間帯(休憩を引く前)が深夜時間帯(22時〜翌5時)と重なる分数。
   * 時給を渡すと給与額 = 時給 × 実働分 ÷ 60(1円未満は四捨五入)。深夜・残業の割増は含まない概算。
   * @param {string} start 出勤時刻 "HH:MM"(0〜23時台)
   * @param {string} end 退勤時刻 "HH:MM"
   * @param {number} [breakMin=0] 休憩(分、0〜1440)
   * @param {number} [wage] 時給(円、0より大きく100万以下)。省略なら給与計算なし
   * @returns {{ok:true, totalMinutes:number, hours:number, minutes:number, decimal:number,
   *            grossMinutes:number, nightMinutes:number, pay:(number|null)}
   *          |{ok:false, code:string}}
   *   code: "invalid_start"|"invalid_end"|"invalid_break"|"break_too_long"|"invalid_wage"
   */
  function timecard(start, end, breakMin, wage) {
    var s = parseHM(start, 23);
    if (s === null) return { ok: false, code: "invalid_start" };
    var e = parseHM(end, 23);
    if (e === null) return { ok: false, code: "invalid_end" };
    var brk = breakMin === undefined || breakMin === null ? 0 : breakMin;
    if (typeof brk !== "number" || !isFinite(brk) || brk !== Math.floor(brk) || brk < 0 || brk > 1440) {
      return { ok: false, code: "invalid_break" };
    }
    var w = wage === undefined || wage === null ? null : wage;
    if (w !== null && (typeof w !== "number" || !isFinite(w) || w <= 0 || w > 1000000)) {
      return { ok: false, code: "invalid_wage" };
    }
    var gross = e - s;
    if (gross < 0) gross += 24 * 60;
    if (brk > gross) return { ok: false, code: "break_too_long" };
    // 深夜時間帯(22:00〜翌5:00)との重なり。出勤時刻を0〜1440分にとった2日分の窓で計算
    var windows = [[0, 300], [1320, 1740], [2760, 2880]];
    var night = 0;
    for (var i = 0; i < windows.length; i++) {
      var lo = Math.max(s, windows[i][0]);
      var hi = Math.min(s + gross, windows[i][1]);
      if (hi > lo) night += hi - lo;
    }
    var r = pack(gross - brk);
    r.grossMinutes = gross;
    r.nightMinutes = night;
    r.pay = w === null ? null : Math.round(w * r.totalMinutes / 60);
    return r;
  }

  /**
   * 10進数表記の時間(7.75時間など)を「時:分」に変換する。分は四捨五入。
   * @param {number} dec 10進数の時間(0〜999)
   * @returns {{ok:true, totalMinutes:number, hours:number, minutes:number}
   *          |{ok:false, code:string}}  code: "invalid_dec"
   */
  function dec2hm(dec) {
    if (typeof dec !== "number" || !isFinite(dec) || dec < 0 || dec > 999) {
      return { ok: false, code: "invalid_dec" };
    }
    var total = Math.round(dec * 60);
    return { ok: true, totalMinutes: total, hours: Math.floor(total / 60), minutes: total % 60 };
  }

  var api = {
    dec2hm: dec2hm,
    timecard: timecard, total: total, span: span };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { global.JikanCalc = api; }
})(typeof window !== "undefined" ? window : globalThis);
