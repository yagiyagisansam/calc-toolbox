/*
 * 星見レベルの配色。
 *
 * 「最高〜不可」は順序のある段階(順序尺度)なので、明度が順位そのものを表す
 * ように作る。明るさで順序が読めれば、色の見え方が異なる人にも通じる。
 *
 * 地図は常に暗色スタイル(OpenFreeMap dark / 背景 #0c0c0c)を使う。
 * 星見のサイトとして夜の画面が自然であること、そして明るい地図の上では
 * 6段階を半透明で重ねると階調が潰れて見分けられなくなるため。
 * ページの枠(凡例・パネル)は端末のライト/ダーク設定に従う。
 *
 * 明度を単調に下げつつ、色相も一緒に回す(黄→橙→珊瑚→桃紅→紫紅→青紫)。
 * 雨雲レーダーと同じで「色が変われば段が変わった」と分かるようにするため。
 *
 * 経緯: 最初は1色相(青)、次に1色相(黄)にしたが、どちらも
 * 「分かりづらい」との指摘を受けた(2026-08-13 Hiroさん)。
 * 実際、隣り合う段の色差は1色相の黄で ΔE 6.9、青で 8.4 しかなく、
 * 明度差だけで6段を読み分けるのは無理があった。色相も動かすと 10.8 まで開く。
 * 順序が読めなくなるのを防ぐため、明度は最後まで単調に下げてある
 * (色の見え方が異なる人は明度で順序を追える)。
 *
 * 作り方: 「地図に重ねた後」の明度が等間隔(0.80→0.435、1段あたり0.073)に
 * 並ぶよう、合成後の実測明度を見ながら各段の素の色を決めている。
 * 彩度を上げると明度が引っ張られるので、素の色から設計すると等間隔にならない。
 *
 * 不透明度 0.85 で #0c0c0c に重ねた状態で検証済み:
 *   ・明度が単調に変化する
 *   ・隣り合う段の明度差 ΔL ≧ 0.06(段の違いが分かる)
 *   ・最も暗い段でも地図に対して 2.28:1 のコントラストがある
 * 段を足す・色を変えるときは、必ず同じ検証をやり直すこと。
 * 検証: dataviz スキルの scripts/validate_palette.js に
 *       合成後の6色を渡し --ordinal --mode dark --surface "#0c0c0c" で実行する。
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
    "#f1e300", // 最高      黄
    "#ffaf43", // 良い      橙
    "#ff7a66", // まずまず   珊瑚
    "#e94695", // いまひとつ 桃紅
    "#b535af", // 悪い      紫紅
    "#5a3ccc" // 不可      青紫
  ];

  // 上の色を #0c0c0c に不透明度 0.85 で重ねたときの実際の見え方。
  // 凡例のチップを地図と同じ色にするために使う。
  var BAND_COLORS_ON_MAP = ["#cfc302", "#db973b", "#db6a59", "#c83d80", "#9c2f97", "#4e35af"];

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
