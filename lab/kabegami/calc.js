/*
 * 壁紙クロスの必要メーター数の計算ロジック
 *
 * 根拠(一次情報):
 * - リリカラ(壁紙メーカー)「壁紙クロスの必要メーター数の計算方法を徹底解説!」
 *   ・張りたい面の横幅を壁紙の幅(約90cm)で割り、切り上げて必要巾数を出す
 *   ・無地は「天井高 + 最低10cm」を1巾の長さとする
 *   ・柄物は 天井高 ÷ 縦リピート寸法 を繰り上げ、さらに柄合わせのため1巾ごとに縦リピート1つ分を足す
 *   ・例: 横幅340cm・天井高240cm・リピート64cm → 4巾 / 240÷64=3.75→4 / (4+1)×64=320cm / 320×4=1,280cm=13m
 *   https://shop.lilycolor.co.jp/blogs/how-to/wallpaper-measure (2026年7月29日参照)
 * - DIYショップRESTA「壁紙クロスの必要サイズ(数量)の測り方」
 *   ・壁紙の幅は約90cmで計算する / 高さは切りしろ分として+10cmする
 *   https://www.diy-shop.jp/info/diy_sz.html (2026年7月29日参照)
 *
 * 前提:
 * - クロス幅の既定値は上記出典にならい90cm。国内で流通するクロスの実巾は92cm前後の製品が多いため、
 *   実際の商品仕様に合わせて入力で変えられるようにしている
 * - 窓・ドアなどの開口部は差し引かない(巾数は壁の横幅で決まるため)。開口部の面積は参考表示のみ
 * - 発注量は1m単位で切り上げる(クロスはメートル単位で販売・カットされるため)
 * - 初めて施工する場合の予備として1割増しの推奨量も返す
 * - 天井・入隅出隅の回り込み・下地処理は考慮しない
 */
(function (global) {
  "use strict";

  var WIDTH_MIN = 10;
  var WIDTH_MAX = 5000; // 壁の横幅(cm)
  var HEIGHT_MIN = 10;
  var HEIGHT_MAX = 1000; // 天井高(cm)
  var ROLL_MIN = 30;
  var ROLL_MAX = 300; // クロス幅(cm)
  var REPEAT_MAX = 500; // 縦リピート寸法(cm)
  var MARGIN_CM = 10; // 無地の切りしろ(上下合わせて10cm)

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function round(v, digits) {
    var f = Math.pow(10, digits);
    return Math.round(v * f) / f;
  }

  /**
   * 壁の寸法から壁紙の必要巾数・必要メーター数を計算する。
   * @param {number} wallWidthCm 壁の横幅(cm。10〜5000)。複数面ある場合は合計
   * @param {number} ceilingHeightCm 天井高(cm。10〜1000)
   * @param {number} rollWidthCm クロス幅(cm。30〜300)。省略時は90(出典の計算方法に合わせた値)
   * @param {number} repeatCm 柄の縦リピート寸法(cm。0〜500)。0または省略で無地として計算
   * @param {number} openingsM2 窓・ドアなど開口部の合計面積(m²。0以上)。省略時は0。実張り面積の表示にのみ使う
   * @returns {{ok:true, panels:number, panelLengthCm:number, totalCm:number, totalM:number,
   *            orderM:number, recommendedM:number, patterned:boolean, repeatCount:number,
   *            wallAreaM2:number, netAreaM2:number}
   *          |{ok:false, code:"invalid_wall_width"|"invalid_height"|"invalid_roll_width"|"invalid_repeat"|"invalid_openings"}}
   *   panels は必要巾数(切り上げ)、panelLengthCm は1巾あたりの必要な長さ、
   *   totalM は必要メーター数、orderM は1m単位に切り上げた発注量、
   *   recommendedM は1割増しの推奨量(1m単位に切り上げ)、repeatCount は1巾に含める柄の数(無地は0)。
   */
  function calculate(wallWidthCm, ceilingHeightCm, rollWidthCm, repeatCm, openingsM2) {
    if (!isFiniteNumber(wallWidthCm) || wallWidthCm < WIDTH_MIN || wallWidthCm > WIDTH_MAX) {
      return { ok: false, code: "invalid_wall_width" };
    }
    if (!isFiniteNumber(ceilingHeightCm) || ceilingHeightCm < HEIGHT_MIN || ceilingHeightCm > HEIGHT_MAX) {
      return { ok: false, code: "invalid_height" };
    }
    if (rollWidthCm === undefined) rollWidthCm = 90;
    if (!isFiniteNumber(rollWidthCm) || rollWidthCm < ROLL_MIN || rollWidthCm > ROLL_MAX) {
      return { ok: false, code: "invalid_roll_width" };
    }
    if (repeatCm === undefined) repeatCm = 0;
    if (!isFiniteNumber(repeatCm) || repeatCm < 0 || repeatCm > REPEAT_MAX) {
      return { ok: false, code: "invalid_repeat" };
    }
    if (openingsM2 === undefined) openingsM2 = 0;
    if (!isFiniteNumber(openingsM2) || openingsM2 < 0 || openingsM2 > 10000) {
      return { ok: false, code: "invalid_openings" };
    }

    var panels = Math.ceil(wallWidthCm / rollWidthCm);
    var patterned = repeatCm > 0;
    var repeatCount = 0;
    var panelLengthCm;
    if (patterned) {
      // 天井高をリピート寸法で割って繰り上げ、柄合わせのため1巾ごとにリピート1つ分を足す
      repeatCount = Math.ceil(ceilingHeightCm / repeatCm) + 1;
      panelLengthCm = round(repeatCm * repeatCount, 4);
    } else {
      panelLengthCm = ceilingHeightCm + MARGIN_CM;
    }
    var totalCm = round(panelLengthCm * panels, 4);
    var totalM = round(totalCm / 100, 2);

    var wallAreaM2 = round(wallWidthCm * ceilingHeightCm / 10000, 2);
    return {
      ok: true,
      panels: panels,
      panelLengthCm: panelLengthCm,
      totalCm: totalCm,
      totalM: totalM,
      orderM: Math.ceil(totalCm / 100),
      recommendedM: Math.ceil(totalCm / 100 * 1.1),
      patterned: patterned,
      repeatCount: repeatCount,
      wallAreaM2: wallAreaM2,
      netAreaM2: round(Math.max(0, wallAreaM2 - openingsM2), 2)
    };
  }

  /**
   * 部屋の間口・奥行き・天井高から、四方の壁の合計横幅を求める。
   * @param {number} roomWidthCm 部屋の間口(cm。10〜5000)
   * @param {number} roomDepthCm 部屋の奥行き(cm。10〜5000)
   * @returns {{ok:true, wallWidthCm:number}|{ok:false, code:"invalid_room_width"|"invalid_room_depth"}}
   *   wallWidthCm は (間口 + 奥行き) × 2。
   */
  function perimeter(roomWidthCm, roomDepthCm) {
    if (!isFiniteNumber(roomWidthCm) || roomWidthCm < WIDTH_MIN || roomWidthCm > WIDTH_MAX) {
      return { ok: false, code: "invalid_room_width" };
    }
    if (!isFiniteNumber(roomDepthCm) || roomDepthCm < WIDTH_MIN || roomDepthCm > WIDTH_MAX) {
      return { ok: false, code: "invalid_room_depth" };
    }
    return { ok: true, wallWidthCm: round((roomWidthCm + roomDepthCm) * 2, 4) };
  }

  var api = {
    calculate: calculate,
    perimeter: perimeter
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.KabegamiCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
