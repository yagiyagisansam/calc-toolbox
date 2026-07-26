// アンケート作成・集計ツールのロジック
// - validatePoll: 質問と選択肢の検証(質問1〜120文字・選択肢2〜10個・各1〜60文字・重複禁止)
// - results: 選択肢ごとの票数から割合(%)と最多選択肢を計算(割合 = 票数÷全票数×100、小数第1位)
// - makeId / isValidId: 投票ページURL用のID(英小文字+数字の10桁)
(function (global) {
  "use strict";

  // 表示・出力する文言は i18n.js の T() を通す。
  // Node(テスト実行)では i18n.js を読み込まないため、その場合はキーをそのまま返す。
  function T(key, vars) {
    if (typeof global.T === "function") return global.T(key, vars);
    return String(key).replace(/\{(\w+)\}/g, function (whole, name) {
      return (vars && Object.prototype.hasOwnProperty.call(vars, name)) ? String(vars[name]) : whole;
    });
  }

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
   * @param {number} [voters] 回答者数。複数選択のとき指定する(割合の分母になる)。
   *                          省略時は票数の合計を分母にする(単一選択)。
   * @returns {{ok:true, total:number, rows:{label:string,count:number,pct:number}[], top:number[]}|{ok:false, code:string}}
   */
  function results(options, counts, voters) {
    if (!Array.isArray(options) || !Array.isArray(counts) || options.length !== counts.length ||
        options.length < MIN_OPTIONS || options.length > MAX_OPTIONS) {
      return { ok: false, code: "invalid_counts" };
    }
    var sum = 0;
    var max = 0;
    for (var i = 0; i < counts.length; i++) {
      var c = counts[i];
      if (typeof c !== "number" || !isFinite(c) || c < 0 || Math.floor(c) !== c) {
        return { ok: false, code: "invalid_counts" };
      }
      sum += c;
      if (c > max) max = c;
    }
    var total;
    if (voters === undefined || voters === null) {
      total = sum;
    } else {
      if (typeof voters !== "number" || !isFinite(voters) || voters < 0 || Math.floor(voters) !== voters || voters < max) {
        return { ok: false, code: "invalid_counts" };
      }
      total = voters;
    }
    var rows = [];
    for (var j = 0; j < counts.length; j++) {
      var pct = total === 0 ? 0 : Math.round((counts[j] / total) * 1000) / 10;
      rows.push({ label: options[j], count: counts[j], pct: pct });
    }
    var top = [];
    if (sum > 0) {
      for (var k = 0; k < counts.length; k++) if (counts[k] === max) top.push(k);
    }
    return { ok: true, total: total, rows: rows, top: top };
  }

  /**
   * 集計結果をCSV文字列にする(カンマ・引用符・改行を含むセルは引用符で囲む)。
   * @param {string} question 質問
   * @param {string[]} options 選択肢
   * @param {number[]} counts 票数
   * @param {number} [voters] 回答者数(複数選択のとき)
   * @returns {{ok:true, csv:string}|{ok:false, code:string}}
   */
  function toCsv(question, options, counts, voters) {
    var r = results(options, counts, voters);
    if (!r.ok) return r;
    if (typeof question !== "string") return { ok: false, code: "invalid_question" };
    function esc(v) {
      var s = String(v);
      if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    }
    var lines = [];
    lines.push(T("質問") + "," + esc(question));
    lines.push(T("回答者数") + "," + r.total);
    lines.push(T("選択肢,票数,割合(%)"));
    for (var i = 0; i < r.rows.length; i++) {
      lines.push(esc(r.rows[i].label) + "," + r.rows[i].count + "," + r.rows[i].pct);
    }
    return { ok: true, csv: lines.join("\n") + "\n" };
  }

  /**
   * 表示用の並び順(票数の多い順・同数は元の並び)を返す。
   * @param {number[]} counts 選択肢ごとの票数
   * @returns {{ok:true, order:number[]}|{ok:false, code:string}}
   */
  function displayOrder(counts) {
    if (!Array.isArray(counts)) return { ok: false, code: "invalid_counts" };
    var idx = [];
    for (var i = 0; i < counts.length; i++) {
      var c = counts[i];
      if (typeof c !== "number" || !isFinite(c) || c < 0) return { ok: false, code: "invalid_counts" };
      idx.push(i);
    }
    idx.sort(function (a, b) { return counts[b] - counts[a] || a - b; });
    return { ok: true, order: idx };
  }

  /**
   * 円グラフ(ドーナツ)用に、各選択肢の割合を累積の区間(0〜1)で返す。
   * @param {number[]} counts 選択肢ごとの票数
   * @returns {{ok:true, arcs:{from:number,to:number}[]}|{ok:false, code:string}}
   */
  function arcs(counts) {
    if (!Array.isArray(counts)) return { ok: false, code: "invalid_counts" };
    var total = 0;
    for (var i = 0; i < counts.length; i++) {
      var c = counts[i];
      if (typeof c !== "number" || !isFinite(c) || c < 0) return { ok: false, code: "invalid_counts" };
      total += c;
    }
    var res = [];
    var acc = 0;
    for (var j = 0; j < counts.length; j++) {
      var f = total === 0 ? 0 : counts[j] / total;
      res.push({ from: acc, to: acc + f });
      acc += f;
    }
    return { ok: true, arcs: res };
  }

  /**
   * 0〜n-1 の並びを Fisher–Yates 法でシャッフルした順序を返す。
   * randFn が一様乱数なら、すべての並び方が等確率になる(偏りなし)。
   * @param {number} n 要素数(1以上の整数)
   * @param {function(number):number} randFn 0以上max未満の一様な整数乱数を返す関数
   * @returns {{ok:true, order:number[]}|{ok:false, code:string}}
   */
  function shuffleOrder(n, randFn) {
    if (typeof n !== "number" || !isFinite(n) || n < 1 || Math.floor(n) !== n) {
      return { ok: false, code: "invalid_counts" };
    }
    if (typeof randFn !== "function") return { ok: false, code: "invalid_rand" };
    var order = [];
    for (var i = 0; i < n; i++) order.push(i);
    for (var k = n - 1; k > 0; k--) {
      var j = randFn(k + 1);
      if (typeof j !== "number" || !isFinite(j) || j < 0 || j > k || Math.floor(j) !== j) {
        return { ok: false, code: "invalid_rand" };
      }
      var tmp = order[k];
      order[k] = order[j];
      order[j] = tmp;
    }
    return { ok: true, order: order };
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

  var api = { validatePoll: validatePoll, results: results, toCsv: toCsv, displayOrder: displayOrder, arcs: arcs, shuffleOrder: shuffleOrder, makeId: makeId, isValidId: isValidId, MAX_OPTIONS: MAX_OPTIONS };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { global.PollCalc = api; }
})(typeof window !== "undefined" ? window : globalThis);
