/*
 * ケーキ型のサイズ換算(材料の分量倍率)ロジック
 *
 * 根拠:
 * - cotta「持ってる型でお菓子を焼きたい！型に合わせたレシピの計算方法」
 *   https://www.cotta.jp/special/article/?p=31531 (2026年7月29日参照)
 *   丸型どうし: (使いたい型の半径)^2 ÷(レシピの型の半径)^2 = 倍率
 *     例) 18cm→15cm: 7.5^2 ÷ 9^2 = 56.25 ÷ 81 = 0.694(約0.7)
 *   スクエア型どうし: (使いたい型の底面積)÷(レシピの型の底面積)= 倍率
 *     例) 18cm→15cm: (15×15)÷(18×18)= 225 ÷ 324 = 0.694(約0.7)
 *   形が違う場合も底面積で比べる。同じ一辺の長さなら
 *     スクエア型 → 丸型: 材料 × 0.785(約0.8)
 *     丸型 → スクエア型: 材料 × 1.27(約1.3)
 *   その他の型(パウンド型・シフォン型など)は容積で比べる。
 *   容積は水を入れて重さを量る方法でも求められる(水1g = 1cm3)。
 *
 * 前提:
 * - 高さを考えない場合は底面積の比、高さも合わせたい場合は容積の比で倍率を出す。
 * - 丸型の底面積 = 円周率 ×(直径 ÷ 2)^2、角型・パウンド型の底面積 = 縦 × 横。
 * - シフォン型の中央の筒、底が広がっている型などの実際の形状差は反映しない。
 * - 焼き時間・温度は倍率では決まらない。生地の厚みが変わるため様子を見て調整すること。
 */
(function (global) {
  "use strict";

  var MAX_CM = 200;
  var MAX_AMOUNT = 1000000;

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  /**
   * 型の底面積を求める。
   * @param {"round"|"square"} shape "round"=丸型(直径で指定) / "square"=角型・パウンド型(縦×横)
   * @param {number} a 丸型なら直径(cm)、角型なら縦(cm)。0より大きく200以下
   * @param {number} [b] 角型のときの横(cm)。省略すると a と同じ(正方形)とみなす
   * @returns {{ok:true, areaCm2:number}|{ok:false, code:"invalid_shape"|"invalid_size"}}
   *   areaCm2 は丸めない生の値。
   */
  function area(shape, a, b) {
    if (shape !== "round" && shape !== "square") return { ok: false, code: "invalid_shape" };
    if (!isFiniteNumber(a) || a <= 0 || a > MAX_CM) return { ok: false, code: "invalid_size" };
    if (shape === "round") {
      return { ok: true, areaCm2: Math.PI * Math.pow(a / 2, 2) };
    }
    var w = b === undefined || b === null ? a : b;
    if (!isFiniteNumber(w) || w <= 0 || w > MAX_CM) return { ok: false, code: "invalid_size" };
    return { ok: true, areaCm2: a * w };
  }

  /**
   * 底面積の比から材料の倍率を求める。
   * @param {"round"|"square"} fromShape レシピの型の形
   * @param {number} fromA レシピの型の直径または縦(cm)
   * @param {number|null} fromB レシピの型の横(cm。丸型や正方形なら null)
   * @param {"round"|"square"} toShape 手持ちの型の形
   * @param {number} toA 手持ちの型の直径または縦(cm)
   * @param {number|null} [toB] 手持ちの型の横(cm。丸型や正方形なら null)
   * @returns {{ok:true, ratio:number, fromAreaCm2:number, toAreaCm2:number}
   *          |{ok:false, code:"invalid_from_shape"|"invalid_from_size"|"invalid_to_shape"|"invalid_to_size"}}
   *   ratio = 手持ちの型の底面積 ÷ レシピの型の底面積(小数第3位で四捨五入)。
   *   面積は小数第2位で四捨五入。
   */
  function ratioByArea(fromShape, fromA, fromB, toShape, toA, toB) {
    var f = area(fromShape, fromA, fromB);
    if (!f.ok) return { ok: false, code: f.code === "invalid_shape" ? "invalid_from_shape" : "invalid_from_size" };
    var t = area(toShape, toA, toB);
    if (!t.ok) return { ok: false, code: t.code === "invalid_shape" ? "invalid_to_shape" : "invalid_to_size" };
    return {
      ok: true,
      ratio: Math.round(t.areaCm2 / f.areaCm2 * 1000) / 1000,
      fromAreaCm2: Math.round(f.areaCm2 * 100) / 100,
      toAreaCm2: Math.round(t.areaCm2 * 100) / 100
    };
  }

  /**
   * 容積(底面積×高さ)の比から材料の倍率を求める。
   * @param {"round"|"square"} fromShape レシピの型の形
   * @param {number} fromA レシピの型の直径または縦(cm)
   * @param {number|null} fromB レシピの型の横(cm。丸型や正方形なら null)
   * @param {number} fromH レシピの型の高さ(cm。0より大きく200以下)
   * @param {"round"|"square"} toShape 手持ちの型の形
   * @param {number} toA 手持ちの型の直径または縦(cm)
   * @param {number|null} toB 手持ちの型の横(cm。丸型や正方形なら null)
   * @param {number} toH 手持ちの型の高さ(cm。0より大きく200以下)
   * @returns {{ok:true, ratio:number, fromVolumeCm3:number, toVolumeCm3:number}
   *          |{ok:false, code:string}}
   *   ratio は小数第3位、容積は小数第1位で四捨五入。
   */
  function ratioByVolume(fromShape, fromA, fromB, fromH, toShape, toA, toB, toH) {
    var r = ratioByArea(fromShape, fromA, fromB, toShape, toA, toB);
    if (!r.ok) return r;
    if (!isFiniteNumber(fromH) || fromH <= 0 || fromH > MAX_CM) return { ok: false, code: "invalid_from_height" };
    if (!isFiniteNumber(toH) || toH <= 0 || toH > MAX_CM) return { ok: false, code: "invalid_to_height" };
    var fv = r.fromAreaCm2 * fromH;
    var tv = r.toAreaCm2 * toH;
    return {
      ok: true,
      ratio: Math.round(tv / fv * 1000) / 1000,
      fromVolumeCm3: Math.round(fv * 10) / 10,
      toVolumeCm3: Math.round(tv * 10) / 10
    };
  }

  /**
   * 材料の分量に倍率をかける。
   * @param {number} amount レシピの分量(g・ml・個数など。0以上100万以下)
   * @param {number} ratio 倍率(0より大きく1000以下)
   * @returns {{ok:true, value:number}|{ok:false, code:"invalid_amount"|"invalid_ratio"}}
   *   value は小数第1位で四捨五入。
   */
  function scale(amount, ratio) {
    if (!isFiniteNumber(amount) || amount < 0 || amount > MAX_AMOUNT) {
      return { ok: false, code: "invalid_amount" };
    }
    if (!isFiniteNumber(ratio) || ratio <= 0 || ratio > 1000) {
      return { ok: false, code: "invalid_ratio" };
    }
    return { ok: true, value: Math.round(amount * ratio * 10) / 10 };
  }

  var api = {
    area: area,
    ratioByArea: ratioByArea,
    ratioByVolume: ratioByVolume,
    scale: scale
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.CakeTinCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
