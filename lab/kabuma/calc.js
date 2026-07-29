/*
 * 畝の長さ・株間・条間から、必要な苗・種の数を計算するロジック
 *
 * 基準の時点: 2026年7月時点。野菜ごとの畝幅・株間の目安は Honda「人気野菜の育て方」の記載による。
 *
 * 根拠(一次情報):
 * - Honda 耕うん機「つくりたい野菜の特徴を知ろう(菜園プランの立て方)」
 *   https://www.honda.co.jp/tiller/yasai/howto/planning/ (2026年7月29日参照)
 *   ・「野菜ごとに適した畝幅、株間、条間などがあるので、あらかじめ把握しておきましょう」
 *   ・「トマトやナスなどの大きく育つ果菜類、キャベツやブロッコリー、ハクサイなどの大型の葉菜類は、
 *      1株で40〜60cm四方の広さを確保したいものです。スイカやカボチャは…2m四方の面積が必要」
 * - Honda 耕うん機「人気野菜の育て方」各野菜のページ(畝幅・株間の欄)
 *   https://www.honda.co.jp/tiller/yasai/popular/ (2026年7月29日参照)
 *   ・トマト 畝幅120cm(二条植え)・株間45〜50cm / ナス 畝幅60cm・株間60cm
 *   ・キュウリ 畝幅120cm(二条植え)・株間45cm / ピーマン 畝幅120cm(二条植え)・株間50〜60cm
 *   ・キャベツ 畝幅60cm・株間40〜45cm / ブロッコリー 畝幅60〜70cm・株間40〜45cm
 *   ・ハクサイ 畝幅60〜70cm・株間40〜45cm / ダイコン 畝幅60cm・株間30cm
 *   ・ニンジン 畝幅60cm・株間10〜12cm / タマネギ 畝幅60cm・株間10〜12cm
 *   ・ジャガイモ 畝幅60〜70cm・株間30cm / ホウレンソウ 畝幅60cm(二条まき)・株間3〜4cm
 *   ・コマツナ 畝幅60cm・株間3〜4cm / ネギ 畝幅90〜100cm・株間5cm
 *   ・エダマメ 畝幅60cm・株間30cm / トウモロコシ 畝幅80〜90cm(二条まき)・株間30cm
 *   ・カブ 畝幅60cm・株間10〜12cm / サツマイモ 畝幅60〜70cm・株間30〜40cm
 *   ・カボチャ、スイカ 畝幅・株間 200cm×200cm
 *
 * 前提:
 * - 1条あたりの株数は「畝の端にも植える」数え方(いわゆる植木算)で、畝長÷株間+1 とする。
 *   端に植えない(株間だけで区切る)数え方も併せて返す。
 * - 条数は入力で指定する。畝幅から求めたい場合は rowsFromBedWidth を使う。
 * - 予備率は「発芽しない・枯れる分の余裕」で、切り上げた本数を返す。
 * - 野菜ごとの株間・条間はあくまで目安。品種・地域・仕立て方で変わる。
 */
(function (global) {
  "use strict";

  var LENGTH_MAX = 1000;   // 畝の長さ(m)の入力上限
  var SPACING_MIN = 1;     // 株間・条間(cm)の入力下限
  var SPACING_MAX = 500;   // 株間・条間(cm)の入力上限
  var ROWS_MAX = 50;       // 条数の入力上限
  var SPARE_MAX = 200;     // 予備率(%)の入力上限
  var WIDTH_MAX = 2000;    // 畝幅(cm)の入力上限

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  /**
   * 畝の長さ・株間・条数から必要な苗(種)の本数を計算する
   * @param {number} rowLengthM 畝の長さ(m)
   * @param {number} spacingCm 株間(cm)。株と株の間隔
   * @param {number} rows 条数(1つの畝に何列植えるか。1以上の整数)
   * @param {number} sparePercent 予備率(%)。0で予備なし
   * @returns {{ok:true, perRow:number, perRowNoEdge:number, total:number, needed:number, spareCount:number}
   *          |{ok:false, code:"invalid_length"|"invalid_spacing"|"invalid_rows"|"invalid_spare"}}
   *   perRow は両端に植える場合の1条あたり株数(畝長÷株間+1、小数は切り捨て)。
   *   perRowNoEdge は端に植えない場合(畝長÷株間)。total は perRow×条数。
   *   needed は予備を足して切り上げた必要本数、spareCount は needed − total
   */
  function calculate(rowLengthM, spacingCm, rows, sparePercent) {
    if (!isFiniteNumber(rowLengthM) || rowLengthM <= 0 || rowLengthM > LENGTH_MAX) {
      return { ok: false, code: "invalid_length" };
    }
    if (!isFiniteNumber(spacingCm) || spacingCm < SPACING_MIN || spacingCm > SPACING_MAX) {
      return { ok: false, code: "invalid_spacing" };
    }
    if (!isFiniteNumber(rows) || Math.floor(rows) !== rows || rows < 1 || rows > ROWS_MAX) {
      return { ok: false, code: "invalid_rows" };
    }
    if (!isFiniteNumber(sparePercent) || sparePercent < 0 || sparePercent > SPARE_MAX) {
      return { ok: false, code: "invalid_spare" };
    }

    var lengthCm = rowLengthM * 100;
    var intervals = Math.floor(lengthCm / spacingCm + 1e-9); // 浮動小数の誤差で1つ減らないようにする
    var perRow = intervals + 1;
    var total = perRow * rows;
    var needed = Math.ceil(total * (1 + sparePercent / 100));
    return {
      ok: true,
      perRow: perRow,
      perRowNoEdge: intervals,
      total: total,
      needed: needed,
      spareCount: needed - total
    };
  }

  /**
   * 畝幅と条間から条数を求める
   * @param {number} bedWidthCm 畝幅(cm)
   * @param {number} rowSpacingCm 条間(cm)。列と列の間隔
   * @param {number} edgeCm 畝の端に空けるスペース(cm、片側)。0でもよい
   * @returns {{ok:true, rows:number, usableCm:number}
   *          |{ok:false, code:"invalid_width"|"invalid_spacing"|"invalid_edge"|"out_of_range"}}
   *   rows は植えられる条数(usableCm ÷ 条間 + 1、小数は切り捨て)
   */
  function rowsFromBedWidth(bedWidthCm, rowSpacingCm, edgeCm) {
    if (!isFiniteNumber(bedWidthCm) || bedWidthCm <= 0 || bedWidthCm > WIDTH_MAX) {
      return { ok: false, code: "invalid_width" };
    }
    if (!isFiniteNumber(rowSpacingCm) || rowSpacingCm < SPACING_MIN || rowSpacingCm > SPACING_MAX) {
      return { ok: false, code: "invalid_spacing" };
    }
    if (!isFiniteNumber(edgeCm) || edgeCm < 0 || edgeCm > WIDTH_MAX) {
      return { ok: false, code: "invalid_edge" };
    }
    var usable = bedWidthCm - edgeCm * 2;
    if (usable < 0) return { ok: false, code: "out_of_range" };
    return {
      ok: true,
      rows: Math.floor(usable / rowSpacingCm + 1e-9) + 1,
      usableCm: Math.round(usable * 10) / 10
    };
  }

  /**
   * 畝の面積から1株あたりの占有面積を求める(株が込みすぎていないかの確認用)
   * @param {number} rowLengthM 畝の長さ(m)
   * @param {number} bedWidthCm 畝幅(cm)
   * @param {number} plantCount 植える株数(1以上の整数)
   * @returns {{ok:true, areaM2:number, perPlantCm2:number}
   *          |{ok:false, code:"invalid_length"|"invalid_width"|"invalid_count"}}
   *   areaM2 は畝の面積(m²、小数第2位)、perPlantCm2 は1株あたりの面積(cm²、整数に四捨五入)
   */
  function areaPerPlant(rowLengthM, bedWidthCm, plantCount) {
    if (!isFiniteNumber(rowLengthM) || rowLengthM <= 0 || rowLengthM > LENGTH_MAX) {
      return { ok: false, code: "invalid_length" };
    }
    if (!isFiniteNumber(bedWidthCm) || bedWidthCm <= 0 || bedWidthCm > WIDTH_MAX) {
      return { ok: false, code: "invalid_width" };
    }
    if (!isFiniteNumber(plantCount) || Math.floor(plantCount) !== plantCount || plantCount < 1) {
      return { ok: false, code: "invalid_count" };
    }
    var areaCm2 = rowLengthM * 100 * bedWidthCm;
    return {
      ok: true,
      areaM2: Math.round(areaCm2 / 10000 * 100) / 100,
      perPlantCm2: Math.round(areaCm2 / plantCount)
    };
  }

  var api = {
    calculate: calculate,
    rowsFromBedWidth: rowsFromBedWidth,
    areaPerPlant: areaPerPlant
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.KabumaCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
