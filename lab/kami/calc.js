/*
 * 紙のサイズ(A判・B判)変換ロジック
 *
 * 根拠(一次情報):
 * - 日本産業規格 JIS P 0138:1998「紙加工仕上寸法」
 *   日本規格協会 JSA Group Webdesk の書誌
 *   https://webdesk.jsa.or.jp/books/W11M0090/index/?bunsyo_id=JIS+P+0138:1998 (2026年7月29日参照)
 *   規格本文の寸法表(A列 A0〜A10 / B列 B0〜B10)は下記で確認した。
 *   https://kikakurui.com/p/P0138-1998-01.html (2026年7月29日参照)
 * - JIS規格の検索は日本産業標準調査会(JISC)から行える。
 *   https://www.jisc.go.jp/app/jis/general/GnrJISSearch.html (2026年7月29日参照)
 *
 * 制度・基準の時点:
 * - 寸法は JIS P 0138:1998 による。A列はISO 216のAシリーズと同じ、
 *   B列は日本独自のJIS-Bシリーズ(ISO-Bシリーズとは異なる)。2026年7月29日時点で有効。
 *
 * 前提:
 * - 表の値は仕上がり寸法(mm)。短辺×長辺の順で保持する。
 * - ピクセル数は px = mm ÷ 25.4 × dpi(1インチ=25.4mm)で計算し、1px単位で四捨五入する。
 * - 塗り足し(裁ち落とし)は規格ではなく印刷所ごとの指定。既定値は置かず利用者が入力する。
 */
(function (global) {
  "use strict";

  var MM_PER_INCH = 25.4;
  var MAX_DPI = 4800;
  var MAX_BLEED_MM = 50;

  // JIS P 0138:1998 の寸法表(mm)。[短辺, 長辺]
  var SIZES = {
    A: [
      [841, 1189], [594, 841], [420, 594], [297, 420], [210, 297],
      [148, 210], [105, 148], [74, 105], [52, 74], [37, 52], [26, 37]
    ],
    B: [
      [1030, 1456], [728, 1030], [515, 728], [364, 515], [257, 364],
      [182, 257], [128, 182], [91, 128], [64, 91], [45, 64], [32, 45]
    ]
  };

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  /**
   * A判・B判の仕上がり寸法(mm)を返す。
   * @param {"A"|"B"} series 用紙規格(A列またはB列)
   * @param {number} n サイズ番号(0〜10の整数。A4なら4)
   * @returns {{ok:true, name:string, shortMm:number, longMm:number, areaMm2:number}
   *          |{ok:false, code:"invalid_series"|"invalid_number"}}
   *   name は "A4" のような表記。areaMm2 は短辺×長辺(mm2)。
   */
  function size(series, n) {
    var table = Object.prototype.hasOwnProperty.call(SIZES, series) ? SIZES[series] : null;
    if (!table) return { ok: false, code: "invalid_series" };
    if (!isFiniteNumber(n) || n < 0 || n >= table.length || Math.floor(n) !== n) {
      return { ok: false, code: "invalid_number" };
    }
    var s = table[n];
    return { ok: true, name: series + n, shortMm: s[0], longMm: s[1], areaMm2: s[0] * s[1] };
  }

  /**
   * 指定した解像度でのピクセル数と、インチ表記の寸法を返す。
   * @param {"A"|"B"} series 用紙規格
   * @param {number} n サイズ番号(0〜10の整数)
   * @param {number} dpi 解像度(dpi。0より大きく4800以下)
   * @returns {{ok:true, name:string, shortMm:number, longMm:number,
   *            shortPx:number, longPx:number, shortInch:number, longInch:number}
   *          |{ok:false, code:"invalid_series"|"invalid_number"|"invalid_dpi"}}
   *   ピクセル数は1px単位で四捨五入、インチは小数第2位で四捨五入。
   */
  function pixels(series, n, dpi) {
    var s = size(series, n);
    if (!s.ok) return s;
    if (!isFiniteNumber(dpi) || dpi <= 0 || dpi > MAX_DPI) return { ok: false, code: "invalid_dpi" };
    return {
      ok: true,
      name: s.name,
      shortMm: s.shortMm,
      longMm: s.longMm,
      shortPx: Math.round(s.shortMm / MM_PER_INCH * dpi),
      longPx: Math.round(s.longMm / MM_PER_INCH * dpi),
      shortInch: Math.round(s.shortMm / MM_PER_INCH * 100) / 100,
      longInch: Math.round(s.longMm / MM_PER_INCH * 100) / 100
    };
  }

  /**
   * 塗り足し(裁ち落とし)を四辺に足したときの寸法とピクセル数を返す。
   * @param {"A"|"B"} series 用紙規格
   * @param {number} n サイズ番号(0〜10の整数)
   * @param {number} dpi 解像度(dpi。0より大きく4800以下)
   * @param {number} bleedMm 一辺あたりの塗り足し(mm。0以上50以下。四辺に足すので合計は2倍)
   * @returns {{ok:true, name:string, shortMm:number, longMm:number, shortPx:number, longPx:number}
   *          |{ok:false, code:"invalid_series"|"invalid_number"|"invalid_dpi"|"invalid_bleed"}}
   */
  function withBleed(series, n, dpi, bleedMm) {
    var p = pixels(series, n, dpi);
    if (!p.ok) return p;
    if (!isFiniteNumber(bleedMm) || bleedMm < 0 || bleedMm > MAX_BLEED_MM) {
      return { ok: false, code: "invalid_bleed" };
    }
    var sm = p.shortMm + bleedMm * 2;
    var lm = p.longMm + bleedMm * 2;
    return {
      ok: true,
      name: p.name,
      shortMm: Math.round(sm * 100) / 100,
      longMm: Math.round(lm * 100) / 100,
      shortPx: Math.round(sm / MM_PER_INCH * dpi),
      longPx: Math.round(lm / MM_PER_INCH * dpi)
    };
  }

  /**
   * 2つの用紙サイズの面積比を求める。
   * @param {"A"|"B"} seriesA 比べる側の規格
   * @param {number} nA 比べる側のサイズ番号(0〜10)
   * @param {"A"|"B"} seriesB 基準にする規格
   * @param {number} nB 基準にするサイズ番号(0〜10)
   * @returns {{ok:true, ratio:number, percent:number}
   *          |{ok:false, code:"invalid_series"|"invalid_number"}}
   *   ratio は A の面積 ÷ B の面積(小数第3位で四捨五入)、percent は百分率(小数第1位で四捨五入)。
   */
  function areaRatio(seriesA, nA, seriesB, nB) {
    var a = size(seriesA, nA);
    if (!a.ok) return a;
    var b = size(seriesB, nB);
    if (!b.ok) return b;
    var r = a.areaMm2 / b.areaMm2;
    return { ok: true, ratio: Math.round(r * 1000) / 1000, percent: Math.round(r * 1000) / 10 };
  }

  var api = {
    size: size,
    pixels: pixels,
    withBleed: withBleed,
    areaRatio: areaRatio
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.KamiCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
