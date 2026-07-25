// アンケート作成・集計ツールのロジック
// - validatePoll: 質問と選択肢の検証(質問1〜120文字・選択肢2〜10個・各1〜60文字・重複禁止)
// - results: 選択肢ごとの票数から割合(%)と最多選択肢を計算(割合 = 票数÷全票数×100、小数第1位)
// - makeId / isValidId: 投票ページURL用のID(英小文字+数字の10桁)
(function (global) {
  "use strict";

  var ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
  var ID_LEN = 10;
  var MIN_OPTIONS = 2;
  var MAX_OPTIONS = 10;
  var MAX_QUESTION = 120;
  var MAX_OPTION = 60;

  /**
   * 質問と選択肢を検証し、前後の空白と空の選択肢を取り除いて返す。
   * @param {string} question 質問文
   * @param {string[]} options 選択肢(空文字は無視される)
   * @returns {{ok:true, question:string, options:string[]}|{ok:false, code:string}}
   */
  function validatePoll(question, options) {
    if (typeof question !== "string") return { ok: false, code: "invalid_question" };
    var q = question.trim();
    if (q.length === 0) return { ok: false, code: "invalid_question" };
    if (q.length > MAX_QUESTION) return { ok: false, code: "question_too_long" };
    if (!Array.isArray(options)) return { ok: false, code: "too_few_options" };
    var cleaned = [];
    for (var i = 0; i < options.length; i++) {
      if (typeof options[i] !== "string") continue;
      var o = options[i].trim();
      if (o.length === 0) continue;
      if (o.length > MAX_OPTION) return { ok: false, code: "option_too_long" };
      if (cleaned.indexOf(o) !== -1) return { ok: false, code: "duplicate_options" };
      cleaned.push(o);
    }
    if (cleaned.length < MIN_OPTIONS) return { ok: false, code: "too_few_options" };
    if (cleaned.length > MAX_OPTIONS) return { ok: false, code: "too_many_options" };
    return { ok: true, question: q, options: cleaned };
  }

  /**
   * 選択肢ごとの票数から集計結果を計算する。
   * @param {string[]} options 選択肢
   * @param {number[]} counts 選択肢ごとの票数(optionsと同じ長さ・0以上の整数)
   * @returns {{ok:true, total:number, rows:{label:string,count:number,pct:number}[], top:number[]}|{ok:false, code:string}}
   */
  function results(options, counts) {
    if (!Array.isArray(options) || !Array.isArray(counts) || options.length !== counts.length ||
        options.length < MIN_OPTIONS || options.length > MAX_OPTIONS) {
      return { ok: false, code: "invalid_counts" };
    }
    var total = 0;
    for (var i = 0; i < counts.length; i++) {
      var c = counts[i];
      if (typeof c !== "number" || !isFinite(c) || c < 0 || Math.floor(c) !== c) {
        return { ok: false, code: "invalid_counts" };
      }
      total += c;
    }
    var max = 0;
    var rows = [];
    for (var j = 0; j < counts.length; j++) {
      var pct = total === 0 ? 0 : Math.round((counts[j] / total) * 1000) / 10;
      rows.push({ label: options[j], count: counts[j], pct: pct });
      if (counts[j] > max) max = counts[j];
    }
    var top = [];
    if (total > 0) {
      for (var k = 0; k < counts.length; k++) if (counts[k] === max) top.push(k);
    }
    return { ok: true, total: total, rows: rows, top: top };
  }

  /**
   * 乱数バイト列から投票ページ用のIDを作る(英小文字+数字の10桁)。
   * @param {number[]|Uint8Array} bytes 0以上の整数を10個以上
   * @returns {{ok:true, id:string}|{ok:false, code:string}}
   */
  function makeId(bytes) {
    if (!bytes || typeof bytes.length !== "number" || bytes.length < ID_LEN) {
      return { ok: false, code: "invalid_bytes" };
    }
    var id = "";
    for (var i = 0; i < ID_LEN; i++) {
      var b = bytes[i];
      if (typeof b !== "number" || !isFinite(b) || b < 0) return { ok: false, code: "invalid_bytes" };
      id += ID_CHARS.charAt(Math.floor(b) % ID_CHARS.length);
    }
    return { ok: true, id: id };
  }

  /**
   * 投票ページURLのID形式(英小文字+数字の10桁)かどうかを返す。
   * @param {string} s
   * @returns {boolean}
   */
  function isValidId(s) {
    return typeof s === "string" && /^[a-z0-9]{10}$/.test(s);
  }

  var api = { validatePoll: validatePoll, results: results, makeId: makeId, isValidId: isValidId, MAX_OPTIONS: MAX_OPTIONS };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { global.PollCalc = api; }
})(typeof window !== "undefined" ? window : globalThis);
