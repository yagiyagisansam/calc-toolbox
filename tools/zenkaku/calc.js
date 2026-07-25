/*
 * 全角⇔半角変換ロジック(英数字・記号・スペース)
 *
 * 変換方法:
 * - 全角英数字・記号(U+FF01〜FF5E)は対応する半角(U+0021〜007E)とコードポイントが
 *   0xFEE0 ずれている(Unicodeの対応関係)ため、その差分で相互変換する
 * - 全角スペース(U+3000)⇔ 半角スペース(U+0020)も変換する
 * - ひらがな・カタカナ・漢字は変換しない(半角カナは対象外)
 */
(function (global) {
  "use strict";

  var MAX = 100000;

  /**
   * 全角英数字・記号・スペースを半角に変換する。
   * @param {string} text 対象テキスト
   * @returns {{ok: true, text: string, changed: number}|{ok: false, code: string}}
   *   changed: 変換した文字数 / code: "invalid_text" | "too_long"
   */
  function toHankaku(text) {
    if (typeof text !== "string") return { ok: false, code: "invalid_text" };
    if (text.length > MAX) return { ok: false, code: "too_long" };
    var changed = 0;
    var out = text.replace(/[\uFF01-\uFF5E\u3000]/g, function (ch) {
      changed++;
      if (ch === "\u3000") return " ";
      return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
    });
    return { ok: true, text: out, changed: changed };
  }

  /**
   * 半角英数字・記号・スペースを全角に変換する。
   */
  function toZenkaku(text) {
    if (typeof text !== "string") return { ok: false, code: "invalid_text" };
    if (text.length > MAX) return { ok: false, code: "too_long" };
    var changed = 0;
    var out = text.replace(/[!-~ ]/g, function (ch) {
      changed++;
      if (ch === " ") return "\u3000";
      return String.fromCharCode(ch.charCodeAt(0) + 0xFEE0);
    });
    return { ok: true, text: out, changed: changed };
  }

  // 半角カナ(U+FF66〜FF9D)と全角カタカナの対応表(JIS X 0201 / Unicodeの対応関係)
  var KANA_H = "\uFF66\uFF67\uFF68\uFF69\uFF6A\uFF6B\uFF6C\uFF6D\uFF6E\uFF6F\uFF70\uFF71\uFF72\uFF73\uFF74\uFF75\uFF76\uFF77\uFF78\uFF79\uFF7A\uFF7B\uFF7C\uFF7D\uFF7E\uFF7F\uFF80\uFF81\uFF82\uFF83\uFF84\uFF85\uFF86\uFF87\uFF88\uFF89\uFF8A\uFF8B\uFF8C\uFF8D\uFF8E\uFF8F\uFF90\uFF91\uFF92\uFF93\uFF94\uFF95\uFF96\uFF97\uFF98\uFF99\uFF9A\uFF9B\uFF9C\uFF9D";
  var KANA_Z = "ヲァィゥェォャュョッーアイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン";
  var DAKU_BASE = "カキクケコサシスセソタチツテトハヒフヘホウ";
  var DAKU_CONV = "ガギグゲゴザジズゼゾダヂヅデドバビブベボヴ";
  var HANDAKU_BASE = "ハヒフヘホ";
  var HANDAKU_CONV = "パピプペポ";
  var PUNC_Z = "。「」、・";
  var PUNC_H = "\uFF61\uFF62\uFF63\uFF64\uFF65";

  /**
   * 変換対象(英数字/カタカナ/記号/スペース)を選んで全角⇔半角変換する。
   *
   * 対象の区分:
   * - 英数字: 0-9 A-Z a-z とその全角形
   * - 記号: ASCIIの記号(!〜/ :〜@ [〜` {〜~)とその全角形、および 。「」、・ ⇔ ｡｢｣､･
   * - カタカナ: 全角カタカナ ⇔ 半角カナ。濁点・半濁点は「ガ⇔ｶﾞ」のように合成/分解する
   *   (対応はUnicodeのHalfwidth and Fullwidth Forms / JIS X 0201に基づく)
   * - スペース: 全角スペース(U+3000)⇔ 半角スペース(U+0020)
   * 対応表にない文字(ヮヵヶなど)は変換せずそのまま残す。
   *
   * @param {string} text 対象テキスト
   * @param {string} mode "toHankaku"(全角→半角) | "toZenkaku"(半角→全角)
   * @param {{alnum:boolean, kana:boolean, symbol:boolean, space:boolean}} targets 変換対象
   * @returns {{ok:true, text:string, changed:number}|{ok:false, code:string}}
   *   changed: 変換した文字数(元のテキスト基準) / code: "invalid_text"|"too_long"|"invalid_mode"
   */
  function convertSelective(text, mode, targets) {
    if (typeof text !== "string") return { ok: false, code: "invalid_text" };
    if (text.length > MAX) return { ok: false, code: "too_long" };
    if (mode !== "toHankaku" && mode !== "toZenkaku") return { ok: false, code: "invalid_mode" };
    targets = targets || {};
    var s = text;
    var counter = { n: 0 };
    function sub(str, re, fn) {
      return str.replace(re, function (ch) { counter.n++; return fn(ch); });
    }
    if (mode === "toHankaku") {
      if (targets.alnum) {
        s = sub(s, /[\uFF10-\uFF19\uFF21-\uFF3A\uFF41-\uFF5A]/g, function (ch) {
          return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
        });
      }
      if (targets.symbol) {
        s = sub(s, /[\uFF01-\uFF0F\uFF1A-\uFF20\uFF3B-\uFF40\uFF5B-\uFF5E]/g, function (ch) {
          return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
        });
        s = sub(s, /[。「」、・]/g, function (ch) {
          return PUNC_H[PUNC_Z.indexOf(ch)];
        });
      }
      if (targets.kana) {
        s = s.replace(/[ァ-ヴー]/g, function (ch) {
          var di = DAKU_CONV.indexOf(ch);
          if (di !== -1) { counter.n++; return KANA_H[KANA_Z.indexOf(DAKU_BASE[di])] + "\uFF9E"; }
          var pi = HANDAKU_CONV.indexOf(ch);
          if (pi !== -1) { counter.n++; return KANA_H[KANA_Z.indexOf(HANDAKU_BASE[pi])] + "\uFF9F"; }
          var i = KANA_Z.indexOf(ch);
          if (i !== -1) { counter.n++; return KANA_H[i]; }
          return ch;
        });
      }
      if (targets.space) {
        s = sub(s, /\u3000/g, function () { return " "; });
      }
    } else {
      if (targets.alnum) {
        s = sub(s, /[0-9A-Za-z]/g, function (ch) {
          return String.fromCharCode(ch.charCodeAt(0) + 0xFEE0);
        });
      }
      if (targets.symbol) {
        s = sub(s, /[!-\u002F:-@\u005B-\u0060\u007B-\u007E]/g, function (ch) {
          return String.fromCharCode(ch.charCodeAt(0) + 0xFEE0);
        });
        s = sub(s, /[\uFF61-\uFF65]/g, function (ch) {
          return PUNC_Z[PUNC_H.indexOf(ch)];
        });
      }
      if (targets.kana) {
        var out = "";
        for (var i = 0; i < s.length; i++) {
          var ch = s[i];
          var idx = KANA_H.indexOf(ch);
          if (idx === -1) { out += ch; continue; }
          var base = KANA_Z[idx];
          var next = s[i + 1];
          if (next === "\uFF9E" && DAKU_BASE.indexOf(base) !== -1) {
            out += DAKU_CONV[DAKU_BASE.indexOf(base)];
            counter.n += 2; i++; continue;
          }
          if (next === "\uFF9F" && HANDAKU_BASE.indexOf(base) !== -1) {
            out += HANDAKU_CONV[HANDAKU_BASE.indexOf(base)];
            counter.n += 2; i++; continue;
          }
          out += base;
          counter.n++;
        }
        s = out;
      }
      if (targets.space) {
        s = sub(s, / /g, function () { return "\u3000"; });
      }
    }
    return { ok: true, text: s, changed: counter.n };
  }

  /**
   * テキストに混ざっている全角英数字・全角記号・全角スペース・半角カナを探す。
   * フォームで「全角文字は使えません」等と言われたとき、どこに混ざっているかを
   * 特定するための検査用。
   * @param {string} text 対象テキスト
   * @returns {{ok:true, total:number,
   *            counts:{zen_alnum:number, zen_symbol:number, zen_space:number, han_kana:number},
   *            items:Array<{ch:string, index:number, type:string}>}
   *          |{ok:false, code:string}}
   *   items は先頭から最大50件。index は0始まりの文字位置。
   */
  function findMixed(text) {
    if (typeof text !== "string") return { ok: false, code: "invalid_text" };
    if (text.length > MAX) return { ok: false, code: "too_long" };
    var counts = { zen_alnum: 0, zen_symbol: 0, zen_space: 0, han_kana: 0 };
    var items = [];
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      var type = null;
      if ((c >= 0xFF10 && c <= 0xFF19) || (c >= 0xFF21 && c <= 0xFF3A) || (c >= 0xFF41 && c <= 0xFF5A)) {
        type = "zen_alnum";
      } else if (c >= 0xFF01 && c <= 0xFF5E) {
        type = "zen_symbol";
      } else if (c === 0x3000) {
        type = "zen_space";
      } else if (c >= 0xFF61 && c <= 0xFF9F) {
        type = "han_kana";
      }
      if (type) {
        counts[type]++;
        if (items.length < 50) items.push({ ch: text[i], index: i, type: type });
      }
    }
    return {
      ok: true,
      total: counts.zen_alnum + counts.zen_symbol + counts.zen_space + counts.han_kana,
      counts: counts,
      items: items
    };
  }

  var api = {
    findMixed: findMixed,
    convertSelective: convertSelective, toHankaku: toHankaku, toZenkaku: toZenkaku, MAX: MAX };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { global.ZenkakuCalc = api; }
})(typeof window !== "undefined" ? window : globalThis);
