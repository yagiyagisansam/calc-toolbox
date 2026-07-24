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

  var api = { total: total, span: span };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { global.JikanCalc = api; }
})(typeof window !== "undefined" ? window : globalThis);
