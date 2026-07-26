/*
 * みんなの投票の表示文言(多言語)
 *
 * 仕組み:
 * - 各ページは「言語辞書(i18n/<言語>.js)」→「このファイル」→「共通ロジック」の順に読み込む
 * - 共通ロジック(home.js / create.js / vote.js / calc.js)は日本語を直接書かず、必ず T() を通す
 * - **キーは日本語の文言そのもの**。辞書に無ければキーをそのまま表示するため、
 *   日本語版は辞書が空でも今までどおり動く(翻訳漏れがあっても壊れず日本語で出る)
 * - 語順が言語で変わる連結文は、キーに {name} 形式の差し込み口を持たせる
 *   例: T("あと{n}票", {n: 3})
 *
 * 新しい言語を足すとき: i18n/<言語>.js に POLL_T を定義し、各HTMLの読み込みを差し替えるだけ
 */
(function (global) {
  "use strict";

  function T(key, vars) {
    var dict = global.POLL_T;
    var s = (dict && Object.prototype.hasOwnProperty.call(dict, key)) ? dict[key] : key;
    if (vars) {
      s = String(s).replace(/\{(\w+)\}/g, function (whole, name) {
        return Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole;
      });
    }
    return s;
  }

  // このページの言語(html lang)。日付の書式など言語ごとの整形に使う
  function lang() {
    var l = document.documentElement.getAttribute("lang") || "ja";
    return l;
  }

  global.T = T;
  global.pollLang = lang;
})(typeof window !== "undefined" ? window : globalThis);
