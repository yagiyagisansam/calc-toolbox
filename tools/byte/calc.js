/*
 * データ容量換算ロジック
 *
 * 計算方法:
 * - 2進接頭辞(1KB=1024B): OSのファイルサイズ表示などで使われる方式
 * - 10進接頭辞(1KB=1000B): ストレージ製品の容量表記(国際単位系のSI接頭辞)
 * - 指定した基数(1024または1000)でB/KB/MB/GB/TBをすべて計算する
 * - 表示は小数第4位で四捨五入
 */
(function (global) {
  "use strict";

  var UNITS = ["b", "kb", "mb", "gb", "tb"];

  function round4(x) { return Math.round(x * 10000) / 10000; }

  /**
   * データ容量を全単位に換算する。
   * @param {number} value 数値
   * @param {string} unit 入力の単位 "b"|"kb"|"mb"|"gb"|"tb"
   * @param {number} base 基数 1024 または 1000
   * @returns {{ok: true, b: number, kb: number, mb: number, gb: number, tb: number}
   *          |{ok: false, code: string}}  code: "invalid_value" | "invalid_unit" | "invalid_base"
   */
  function convert(value, unit, base) {
    if (typeof value !== "number" || !isFinite(value) || value <= 0 || value > 1e15) {
      return { ok: false, code: "invalid_value" };
    }
    var idx = UNITS.indexOf(unit);
    if (idx === -1) return { ok: false, code: "invalid_unit" };
    if (base !== 1024 && base !== 1000) return { ok: false, code: "invalid_base" };
    var bytes = value * Math.pow(base, idx);
    var out = { ok: true };
    for (var i = 0; i < UNITS.length; i++) {
      out[UNITS[i]] = round4(bytes / Math.pow(base, i));
    }
    return out;
  }

  var api = { convert: convert, UNITS: UNITS };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { global.ByteCalc = api; }
})(typeof window !== "undefined" ? window : globalThis);
