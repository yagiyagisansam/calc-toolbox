/*
 * 星見レベルの配色。
 *
 * 「最高〜不可」は順序のある段階(順序尺度)なので、色相をいくつも使わず
 * 1色相の明度の階段にする。明るさそのものが順位を表すため、色の見え方が
 * 異なる人でも順序が読める(色覚多様性への対応)。虹色のスケールは使わない。
 *
 * 地図は常に暗色スタイル(OpenFreeMap dark / 背景 #0c0c0c)を使う。
 * 星見のサイトとして夜の画面が自然であること、そして明るい地図の上では
 * 6段階を半透明で重ねると階調が潰れて見分けられなくなるため。
 * ページの枠(凡例・パネル)は端末のライト/ダーク設定に従う。
 *
 * 色相は黄色(OKLCH の色相 85度)。当初は青にしていたが、暗色地図の上では
 * 地図そのものの青(海・水域)と紛らわしく、段の違いも読み取りにくかった
 * (2026-08-13 Hiroさん指摘)。黄色は暗い背景で最も明度を稼げる色相なので、
 * 段の間隔を広く取れて「どこが良いか」がひと目で分かる。
 *
 * 値は OKLCH で明度 0.88 から 0.48 まで 0.08 ずつ下げ、各明度で出せる彩度の
 * 95%(上限 0.19)を取ったもの。不透明度 0.85 で #0c0c0c に重ねた状態を
 * 検証済み:
 *   ・明度が単調に変化する
 *   ・隣り合う段の明度差 ΔL ≧ 0.06(段の違いが分かる)
 *   ・最も暗い段でも地図に対して 2.45:1 のコントラストがある
 *   ・色相の振れ幅 1度(1色相のランプになっている)
 * 段を足す・色を変えるときは、必ず同じ検証をやり直すこと。
 *
 * window.StarsPalette で公開する。
 */
(function (global) {
  "use strict";

  // 地図の背景(OpenFreeMap dark の background-color)。合成後の色を出すのに使う。
  var MAP_SURFACE = "#0c0c0c";

  // ラスタを地図に重ねるときの不透明度
  var OVERLAY_ALPHA = 0.85;

  /*
   * StarsScore.BANDS と同じ並び(最高 → 不可)。
   * 明るいほど良い = 「行くべき場所が光って見える」ようにしている。
   */
  var BAND_COLORS = [
    "#fdd171", // 最高
    "#ebb424", // 良い
    "#cd9c1d", // まずまず
    "#af8517", // いまひとつ
    "#926e10", // 悪い
    "#76590a" // 不可
  ];

  // 上の色を #0c0c0c に不透明度 0.85 で重ねたときの実際の見え方。
  // 凡例のチップを地図と同じ色にするために使う。
  var BAND_COLORS_ON_MAP = ["#d9b362", "#ca9b20", "#b0861a", "#977315", "#7e5f0f", "#664d0a"];

  function hexToRgb(hex) {
    return [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16)
    ];
  }

  // ラスタ描画のホットパスで使うので、数値の配列にほどいておく
  var BAND_RGB = BAND_COLORS.map(hexToRgb);

  var api = {
    MAP_SURFACE: MAP_SURFACE,
    OVERLAY_ALPHA: OVERLAY_ALPHA,
    BAND_COLORS: BAND_COLORS,
    BAND_COLORS_ON_MAP: BAND_COLORS_ON_MAP,
    BAND_RGB: BAND_RGB,
    hexToRgb: hexToRgb
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.StarsPalette = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
