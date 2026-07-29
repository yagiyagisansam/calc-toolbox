/*
 * 文字サイズの単位換算(級Q・歯H・ポイントpt・ミリメートル)の計算ロジック
 *
 * 根拠(一次情報):
 * - Adobe「定規を使用したオブジェクトの整列と分布(InDesign の測定単位)」
 *   https://helpx.adobe.com/jp/indesign/using/rulers-measurement-units.html (2026年7月29日参照)
 *   ・Q(級): 1単位が 0.25 ミリメートル
 *   ・H(歯): 1単位が 0.25 ミリメートル(Qと同じ。行送りや長さに用いる)
 *   ・ポイント(PostScript): 1インチ = 72 PostScript ポイント
 *   ・アメリカ式ポイント: 1インチ = 72.27 アメリカ式ポイント(= 0.35146 ミリメートル)
 *
 * 前提:
 * - 1インチ = 25.4mm(国際インチ)として計算する。
 *   したがって 1pt = 25.4/72 = 0.3527777…mm、1Q = 0.25mm なので
 *   1Q = 0.7086614…pt、1pt = 1.4111111…Q になる。
 * - InDesign・Illustrator の既定の「ポイント」はPostScriptポイント(1/72インチ)である。
 *   古い活字やJIS由来の「アメリカ式ポイント」(1/72.27インチ)とは約0.4%ずれるので、
 *   本ツールでは別の単位として分けている。
 * - 換算結果は小数第5位で丸める(0.1級・0.1ポイント単位の指定を扱うのに十分な精度)。
 */
(function (global) {
  "use strict";

  var MM_PER_INCH = 25.4;
  var MAX_VALUE = 1000000;

  // 各単位1つあたりのミリメートル数
  var MM_PER = {
    Q: 0.25,
    H: 0.25,
    pt: MM_PER_INCH / 72,
    apt: MM_PER_INCH / 72.27,
    mm: 1,
    inch: MM_PER_INCH
  };
  var UNITS = ["Q", "H", "pt", "apt", "mm", "inch"];

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  /** 小数第d位に丸める */
  function round(v, d) {
    var f = Math.pow(10, d);
    return Math.round(v * f) / f;
  }

  function knownUnit(u) {
    return typeof u === "string" && Object.prototype.hasOwnProperty.call(MM_PER, u);
  }

  /**
   * 文字サイズの単位を換算する。いったんミリメートルに直してから変換先の単位に直す。
   * @param {number} value 変換する数値(0以上、1000000以下)
   * @param {string} from 元の単位。"Q"|"H"|"pt"(PostScriptポイント)|"apt"(アメリカ式ポイント)|"mm"|"inch"
   * @param {string} to 変換先の単位(同上)
   * @returns {{ok:true, value:number, mm:number, from:string, to:string}
   *          |{ok:false, code:"invalid_value"|"invalid_from"|"invalid_to"}}
   *   value: 変換後の数値(小数第5位で丸め)、mm: 途中のミリメートル値(小数第5位で丸め)
   */
  function convert(value, from, to) {
    if (!knownUnit(from)) return { ok: false, code: "invalid_from" };
    if (!knownUnit(to)) return { ok: false, code: "invalid_to" };
    if (!isFiniteNumber(value) || value < 0 || value > MAX_VALUE) {
      return { ok: false, code: "invalid_value" };
    }
    var mm = value * MM_PER[from];
    return {
      ok: true,
      value: round(mm / MM_PER[to], 5),
      mm: round(mm, 5),
      from: from,
      to: to
    };
  }

  /**
   * ひとつの数値を、扱えるすべての単位に換算した一覧を返す(画面の一覧表示用)。
   * @param {number} value 変換する数値(0以上、1000000以下)
   * @param {string} from 元の単位
   * @returns {{ok:true, rows:Array<{unit:string, value:number}>}
   *          |{ok:false, code:"invalid_value"|"invalid_from"}}
   */
  function convertAll(value, from) {
    if (!knownUnit(from)) return { ok: false, code: "invalid_from" };
    if (!isFiniteNumber(value) || value < 0 || value > MAX_VALUE) {
      return { ok: false, code: "invalid_value" };
    }
    var rows = [];
    for (var i = 0; i < UNITS.length; i++) {
      rows.push({ unit: UNITS[i], value: convert(value, from, UNITS[i]).value });
    }
    return { ok: true, rows: rows };
  }

  /**
   * 行送り(1行の基準線から次の基準線までの距離)を、文字サイズと倍率から求める。
   * 行送り = 文字サイズ × 倍率。行間(アキ)= 行送り − 文字サイズ。
   * 日本語組版では文字サイズの1.5〜1.75倍が読みやすいとされることが多い。
   * @param {number} size 文字サイズ(0より大きく1000000以下)
   * @param {number} ratio 文字サイズに対する行送りの倍率(1以上、5以下)
   * @param {string} [unit="Q"] size の単位("Q"|"H"|"pt"|"apt"|"mm"|"inch")
   * @returns {{ok:true, leading:number, gap:number, leadingMm:number, gapMm:number, unit:string}
   *          |{ok:false, code:"invalid_value"|"invalid_ratio"|"invalid_from"}}
   *   leading: 行送り(入力と同じ単位)、gap: 行間(同)、leadingMm/gapMm はミリメートル換算
   */
  function lineSpacing(size, ratio, unit) {
    var u = unit === undefined ? "Q" : unit;
    if (!knownUnit(u)) return { ok: false, code: "invalid_from" };
    if (!isFiniteNumber(size) || size <= 0 || size > MAX_VALUE) {
      return { ok: false, code: "invalid_value" };
    }
    if (!isFiniteNumber(ratio) || ratio < 1 || ratio > 5) {
      return { ok: false, code: "invalid_ratio" };
    }
    var leading = size * ratio;
    var gap = leading - size;
    return {
      ok: true,
      leading: round(leading, 5),
      gap: round(gap, 5),
      leadingMm: round(leading * MM_PER[u], 5),
      gapMm: round(gap * MM_PER[u], 5),
      unit: u
    };
  }

  var api = {
    convert: convert,
    convertAll: convertAll,
    lineSpacing: lineSpacing,
    UNITS: UNITS,
    MM_PER: MM_PER
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.KyusuCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
