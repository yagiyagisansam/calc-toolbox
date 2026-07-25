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

  // 見間違えやすい文字(小文字エル・大文字アイ・数字1、オー・ゼロなど)
  var SIMILAR = "lIoO01";

  /**
   * 条件を細かく指定してパスワードを複数まとめて生成する。
   * 乱数は既存の generate と同じ方式(ブラウザでは crypto.getRandomValues、
   * テスト時はシード指定の擬似乱数)。選んだ文字種から必ず1文字以上含める。
   *
   * @param {number} length 長さ(4〜64)
   * @param {{lower?:boolean, upper?:boolean, digits?:boolean, symbols?:boolean,
   *          excludeSimilar?:boolean, symbolSet?:string}} opts
   *   excludeSimilar: 似た文字(l I 1 O 0 o)を除外する
   *   symbolSet: 使う記号を限定する(空なら標準の記号すべて)。ASCII記号のみ指定可
   * @param {number} count 生成する個数(1〜10)
   * @param {number} [seed] テスト用シード
   * @returns {{ok:true, passwords:string[], count:number, length:number,
   *            poolSize:number, entropyBits:number}
   *          |{ok:false, code:string}}
   *   code: "invalid_length"|"invalid_count"|"invalid_symbols"|"no_charset"
   *   entropyBits = 長さ × log2(文字数) を四捨五入(既存 generate と同じ指標)
   */
  function generateCustom(length, opts, count, seed) {
    if (typeof length !== "number" || !isFinite(length) || length !== Math.floor(length) ||
        length < 4 || length > 64) {
      return { ok: false, code: "invalid_length" };
    }
    if (typeof count !== "number" || count !== Math.floor(count) || count < 1 || count > 10) {
      return { ok: false, code: "invalid_count" };
    }
    opts = opts || {};
    var symbolPool = SYMBOLS;
    if (opts.symbolSet !== undefined && opts.symbolSet !== null && String(opts.symbolSet).trim() !== "") {
      var uniq = "";
      var ss = String(opts.symbolSet).replace(/\s+/g, "");
      for (var si = 0; si < ss.length; si++) {
        if (SYMBOLS.indexOf(ss[si]) === -1) return { ok: false, code: "invalid_symbols" };
        if (uniq.indexOf(ss[si]) === -1) uniq += ss[si];
      }
      if (uniq === "") return { ok: false, code: "invalid_symbols" };
      symbolPool = uniq;
    }
    function strip(set) {
      if (!opts.excludeSimilar) return set;
      var out = "";
      for (var i = 0; i < set.length; i++) {
        if (SIMILAR.indexOf(set[i]) === -1) out += set[i];
      }
      return out;
    }
    var sets = [];
    if (opts.lower) sets.push(strip(LOWER));
    if (opts.upper) sets.push(strip(UPPER));
    if (opts.digits) sets.push(strip(DIGITS));
    if (opts.symbols) sets.push(symbolPool);
    if (sets.length === 0 || sets.length > length) return { ok: false, code: "no_charset" };
    var pool = sets.join("");
    var rng = makeRng(seed);
    var passwords = [];
    for (var p = 0; p < count; p++) {
      var chars = [];
      for (var i2 = 0; i2 < sets.length; i2++) {
        chars.push(sets[i2][Math.floor(rng() * sets[i2].length)]);
      }
      while (chars.length < length) {
        chars.push(pool[Math.floor(rng() * pool.length)]);
      }
      for (var j = chars.length - 1; j > 0; j--) {
        var k = Math.floor(rng() * (j + 1));
        var tmp = chars[j]; chars[j] = chars[k]; chars[k] = tmp;
      }
      passwords.push(chars.join(""));
    }
    return {
      ok: true,
      passwords: passwords,
      count: passwords.length,
      length: length,
      poolSize: pool.length,
      entropyBits: Math.round(length * Math.log(pool.length) / Math.LN2)
    };
  }

  /**
   * 手持ちのパスワードの強度(推測されにくさ)の目安を調べる。
   * 含まれる文字の種類(英小文字26・英大文字26・数字10・記号32)から文字数を見積もり、
   * 強度 = 長さ × log2(文字数) ビット(四捨五入)。ASCII以外の文字は記号と同じ
   * 32種として概算する。判定の区分は既存の生成結果と同じ
   * (100ビット以上=非常に強い / 80以上=強い / 60以上=ふつう / それ未満=弱い)。
   * 注意: 辞書にある単語や使い回しの危険は判定できない(数式上の目安のみ)。
   *
   * @param {string} pw パスワード
   * @returns {{ok:true, length:number, poolSize:number, entropyBits:number, level:string}
   *          |{ok:false, code:string}} code: "invalid_password"
   */
  function checkStrength(pw) {
    if (typeof pw !== "string" || pw.length === 0 || pw.length > 256) {
      return { ok: false, code: "invalid_password" };
    }
    var pool = 0;
    var hasOther = false;
    var flags = { lower: false, upper: false, digit: false, symbol: false };
    for (var i = 0; i < pw.length; i++) {
      var ch = pw[i];
      if (LOWER.indexOf(ch) !== -1) flags.lower = true;
      else if (UPPER.indexOf(ch) !== -1) flags.upper = true;
      else if (DIGITS.indexOf(ch) !== -1) flags.digit = true;
      else if (SYMBOLS.indexOf(ch) !== -1) flags.symbol = true;
      else hasOther = true;
    }
    if (flags.lower) pool += 26;
    if (flags.upper) pool += 26;
    if (flags.digit) pool += 10;
    if (flags.symbol) pool += 32;
    if (hasOther) pool += 32;
    var bits = Math.round(pw.length * Math.log(pool) / Math.LN2);
    var level = bits >= 100 ? "非常に強い" : bits >= 80 ? "強い" : bits >= 60 ? "ふつう" : "弱い";
    return { ok: true, length: pw.length, poolSize: pool, entropyBits: bits, level: level };
  }

  var api = {
    checkStrength: checkStrength,
    generateCustom: generateCustom, generate: generate };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { global.PasswordCalc = api; }
})(typeof window !== "undefined" ? window : globalThis);
