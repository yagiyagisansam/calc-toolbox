/*
 * 画像の印刷可能サイズ(dpi)計算ロジック
 *
 * 根拠(一次情報):
 * - 印刷通販グラフィック「印刷に最適な解像度(画像解像度)とは?」
 *   1インチ = 25.4mm、フルカラー印刷は350dpi、グレースケール600dpi、モノクロ2階調1,200dpi、
 *   大型ポスターは200dpi程度。A4(210×297mm)を350dpiで印刷するには2,894×4,093px 必要
 *   https://www.graphic.jp/feature/print_resolution (2026年7月29日参照)
 *
 * 前提:
 * - dpi(1インチあたりのドット数)と ppi(1インチあたりの画素数)を同じものとして扱う
 * - 印刷サイズ(mm) = ピクセル数 ÷ dpi × 25.4 という定義式のみを使う
 * - 必要ピクセル数は切り上げる(足りないと解像度不足になるため)
 * - 塗り足し(裁ち落とし)は含まない。入稿時は各印刷所の指定に従うこと
 * - 画像を後から拡大しても実際の精細さは上がらない
 */
(function (global) {
  "use strict";

  var MM_PER_INCH = 25.4;
  var MAX_PX = 1000000;
  var MAX_MM = 100000;
  var DPI_MIN = 1;
  var DPI_MAX = 10000;

  // よく使う用紙サイズ(mm)
  var PAPERS = {
    a3: [297, 420],
    a4: [210, 297],
    a5: [148, 210],
    b4: [257, 364],
    b5: [182, 257],
    postcard: [100, 148],
    business_card: [91, 55],
    l: [89, 127]
  };

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function round(v, digits) {
    var f = Math.pow(10, digits);
    return Math.round(v * f) / f;
  }

  function checkPx(v) {
    return isFiniteNumber(v) && v > 0 && v <= MAX_PX;
  }
  function checkDpi(v) {
    return isFiniteNumber(v) && v >= DPI_MIN && v <= DPI_MAX;
  }

  /**
   * ピクセル数と目標解像度から、印刷できる実寸を求める。
   * @param {number} pxWidth 画像の横ピクセル数(1〜1,000,000)
   * @param {number} pxHeight 画像の縦ピクセル数(1〜1,000,000)
   * @param {number} dpi 目標解像度(dpi。1〜10,000)
   * @returns {{ok:true, widthMm:number, heightMm:number, widthCm:number, heightCm:number}
   *          |{ok:false, code:"invalid_px_width"|"invalid_px_height"|"invalid_dpi"}}
   *   mm は小数第1位、cm は小数第2位で四捨五入する。
   */
  function printSize(pxWidth, pxHeight, dpi) {
    if (!checkPx(pxWidth)) return { ok: false, code: "invalid_px_width" };
    if (!checkPx(pxHeight)) return { ok: false, code: "invalid_px_height" };
    if (!checkDpi(dpi)) return { ok: false, code: "invalid_dpi" };
    var w = pxWidth / dpi * MM_PER_INCH;
    var h = pxHeight / dpi * MM_PER_INCH;
    return {
      ok: true,
      widthMm: round(w, 1),
      heightMm: round(h, 1),
      widthCm: round(w / 10, 2),
      heightCm: round(h / 10, 2)
    };
  }

  /**
   * 印刷したい実寸と目標解像度から、必要なピクセル数を求める。
   * @param {number} widthMm 印刷したい横幅(mm。0より大きく100,000以下)
   * @param {number} heightMm 印刷したい縦幅(mm。0より大きく100,000以下)
   * @param {number} dpi 目標解像度(dpi。1〜10,000)
   * @returns {{ok:true, pxWidth:number, pxHeight:number}
   *          |{ok:false, code:"invalid_width"|"invalid_height"|"invalid_dpi"}}
   *   足りないと解像度不足になるため、ピクセル数は切り上げる。
   */
  function requiredPixels(widthMm, heightMm, dpi) {
    if (!isFiniteNumber(widthMm) || widthMm <= 0 || widthMm > MAX_MM) {
      return { ok: false, code: "invalid_width" };
    }
    if (!isFiniteNumber(heightMm) || heightMm <= 0 || heightMm > MAX_MM) {
      return { ok: false, code: "invalid_height" };
    }
    if (!checkDpi(dpi)) return { ok: false, code: "invalid_dpi" };
    return {
      ok: true,
      pxWidth: Math.ceil(widthMm / MM_PER_INCH * dpi),
      pxHeight: Math.ceil(heightMm / MM_PER_INCH * dpi)
    };
  }

  /**
   * ピクセル数と印刷したい実寸から、実際に得られる解像度(実効dpi)を求める。
   * @param {number} px ピクセル数(1〜1,000,000)
   * @param {number} mm 印刷したい長さ(mm。0より大きく100,000以下)
   * @returns {{ok:true, dpi:number}|{ok:false, code:"invalid_px_width"|"invalid_width"}}
   *   dpi は小数第1位で四捨五入する。
   */
  function effectiveDpi(px, mm) {
    if (!checkPx(px)) return { ok: false, code: "invalid_px_width" };
    if (!isFiniteNumber(mm) || mm <= 0 || mm > MAX_MM) return { ok: false, code: "invalid_width" };
    return { ok: true, dpi: round(px / (mm / MM_PER_INCH), 1) };
  }

  /**
   * 画像が指定した用紙サイズの印刷に耐えるかを判定する。
   * 用紙の縦横比に合わせて、画像を縦向き・横向きの有利な方で当てはめる。
   * @param {number} pxWidth 画像の横ピクセル数(1〜1,000,000)
   * @param {number} pxHeight 画像の縦ピクセル数(1〜1,000,000)
   * @param {string} paper 用紙。"a3"|"a4"|"a5"|"b4"|"b5"|"postcard"|"business_card"|"l"
   * @param {number} dpi 必要とする解像度(dpi。1〜10,000)。省略時は350
   * @returns {{ok:true, fits:boolean, effectiveDpi:number, neededPxWidth:number, neededPxHeight:number,
   *            paperWidthMm:number, paperHeightMm:number}
   *          |{ok:false, code:"invalid_px_width"|"invalid_px_height"|"invalid_paper"|"invalid_dpi"}}
   *   effectiveDpi は用紙いっぱいに印刷したときに実際に得られる解像度(短い方の辺で決まる・小数第1位)。
   */
  function checkPaper(pxWidth, pxHeight, paper, dpi) {
    if (!checkPx(pxWidth)) return { ok: false, code: "invalid_px_width" };
    if (!checkPx(pxHeight)) return { ok: false, code: "invalid_px_height" };
    var size = PAPERS[paper];
    if (!size) return { ok: false, code: "invalid_paper" };
    if (dpi === undefined) dpi = 350;
    if (!checkDpi(dpi)) return { ok: false, code: "invalid_dpi" };

    // 画像・用紙とも「短辺・長辺」に揃えて比較する(向きの回転を許す)
    var imgShort = Math.min(pxWidth, pxHeight);
    var imgLong = Math.max(pxWidth, pxHeight);
    var paperShort = Math.min(size[0], size[1]);
    var paperLong = Math.max(size[0], size[1]);

    var needShort = Math.ceil(paperShort / MM_PER_INCH * dpi);
    var needLong = Math.ceil(paperLong / MM_PER_INCH * dpi);
    var eff = Math.min(imgShort / (paperShort / MM_PER_INCH), imgLong / (paperLong / MM_PER_INCH));

    return {
      ok: true,
      fits: imgShort >= needShort && imgLong >= needLong,
      effectiveDpi: round(eff, 1),
      neededPxWidth: needShort,
      neededPxHeight: needLong,
      paperWidthMm: paperShort,
      paperHeightMm: paperLong
    };
  }

  var api = {
    printSize: printSize,
    requiredPixels: requiredPixels,
    effectiveDpi: effectiveDpi,
    checkPaper: checkPaper
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.DpiCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
