/*
 * パスワード生成ロジック
 *
 * 方式:
 * - ブラウザでは crypto.getRandomValues による乱数を使用(テスト時はシード指定の擬似乱数)
 * - 選んだ文字種(英小文字・英大文字・数字・記号)それぞれから必ず1文字以上含める
 * - 強度の目安 = 長さ × log2(文字種の合計数)ビット(丸め)
 */
(function (global) {
  "use strict";

  var LOWER = "abcdefghijklmnopqrstuvwxyz";
  var UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  var DIGITS = "0123456789";
  var SYMBOLS = (function () {
    var s = "";
    var ranges = [[33, 47], [58, 64], [91, 96], [123, 126]];
    for (var i = 0; i < ranges.length; i++) {
      for (var c = ranges[i][0]; c <= ranges[i][1]; c++) s += String.fromCharCode(c);
    }
    return s;
  })();

  function makeRng(seed) {
    if (seed === undefined || seed === null) {
      if (typeof crypto !== "undefined" && crypto.getRandomValues) {
        return function () {
          var a = new Uint32Array(1);
          crypto.getRandomValues(a);
          return a[0] / 4294967296;
        };
      }
      seed = Date.now() % 2147483647;
    }
    var x = (seed >>> 0) || 88675123;
    return function () {
      x ^= x << 13; x >>>= 0;
      x ^= x >> 17;
      x ^= x << 5; x >>>= 0;
      return x / 4294967296;
    };
  }

  /**
   * パスワードを生成する。
   * @param {number} length 長さ(4〜64)
   * @param {{lower?: boolean, upper?: boolean, digits?: boolean, symbols?: boolean}} opts 文字種
   * @param {number} [seed] テスト用シード(省略時は暗号乱数)
   * @returns {{ok: true, password: string, length: number, poolSize: number, entropyBits: number,
   *            hasLower: boolean, hasUpper: boolean, hasDigit: boolean, hasSymbol: boolean}
   *          |{ok: false, code: string}}  code: "invalid_length" | "no_charset"
   */
  function generate(length, opts, seed) {
    if (typeof length !== "number" || !isFinite(length) || length !== Math.floor(length) ||
        length < 4 || length > 64) {
      return { ok: false, code: "invalid_length" };
    }
    opts = opts || {};
    var sets = [];
    if (opts.lower) sets.push(LOWER);
    if (opts.upper) sets.push(UPPER);
    if (opts.digits) sets.push(DIGITS);
    if (opts.symbols) sets.push(SYMBOLS);
    if (sets.length === 0 || sets.length > length) return { ok: false, code: "no_charset" };
    var pool = sets.join("");
    var rng = makeRng(seed);
    var chars = [];
    for (var i = 0; i < sets.length; i++) {
      chars.push(sets[i][Math.floor(rng() * sets[i].length)]);
    }
    while (chars.length < length) {
      chars.push(pool[Math.floor(rng() * pool.length)]);
    }
    for (var j = chars.length - 1; j > 0; j--) {
      var k = Math.floor(rng() * (j + 1));
      var tmp = chars[j]; chars[j] = chars[k]; chars[k] = tmp;
    }
    var pw = chars.join("");
    function hasAny(set) {
      for (var n = 0; n < pw.length; n++) { if (set.indexOf(pw[n]) !== -1) return true; }
      return false;
    }
    return {
      ok: true,
      password: pw,
      length: pw.length,
      poolSize: pool.length,
      entropyBits: Math.round(length * Math.log(pool.length) / Math.LN2),
      hasLower: hasAny(LOWER),
      hasUpper: hasAny(UPPER),
      hasDigit: hasAny(DIGITS),
      hasSymbol: hasAny(SYMBOLS)
    };
  }

  var api = { generate: generate };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { global.PasswordCalc = api; }
})(typeof window !== "undefined" ? window : globalThis);
