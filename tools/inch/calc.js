/*
 * インチ⇔cm・ポンド⇔kg 変換ロジック
 *
 * 換算値の根拠:
 * - 1インチ = 2.54cm(国際インチの定義値・誤差なし)
 * - 1ポンド = 0.45359237kg(国際ポンドの定義値・誤差なし)
 *   いずれもヤード・ポンド法の国際協定(1959年)による定義値。
 *   日本では取引・証明への使用は計量法によりメートル法が原則
 *   https://laws.e-gov.go.jp/law/404AC0000000051
 */
(function (global) {
  "use strict";

  var VALUE_MIN = 0.001;
  var VALUE_MAX = 1000000;
  var CM_PER_INCH = 2.54;
  var KG_PER_POUND = 0.45359237;

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function round2(v) {
    return Math.round(v * 100) / 100;
  }

  function validValue(v) {
    return isFiniteNumber(v) && v >= VALUE_MIN && v <= VALUE_MAX;
  }

  /**
   * 長さの変換。
   * @param {number} value 値
   * @param {string} fromUnit "in" | "cm"
   * @returns {{ok: true, inch: number, cm: number}|{ok: false, code: string}}
   *   code: "invalid_value" | "invalid_unit"
   */
  function convertLength(value, fromUnit) {
    if (!validValue(value)) return { ok: false, code: "invalid_value" };
    if (fromUnit !== "in" && fromUnit !== "cm") return { ok: false, code: "invalid_unit" };
    var cm = fromUnit === "in" ? value * CM_PER_INCH : value;
    return { ok: true, inch: round2(cm / CM_PER_INCH), cm: round2(cm) };
  }

  /**
   * 重さの変換。
   * @param {number} value 値
   * @param {string} fromUnit "lb" | "kg"
   * @returns {{ok: true, lb: number, kg: number}|{ok: false, code: string}}
   *   code: "invalid_value" | "invalid_unit"
   */
  function convertWeight(value, fromUnit) {
    if (!validValue(value)) return { ok: false, code: "invalid_value" };
    if (fromUnit !== "lb" && fromUnit !== "kg") return { ok: false, code: "invalid_unit" };
    var kg = fromUnit === "lb" ? value * KG_PER_POUND : value;
    return { ok: true, lb: round2(kg / KG_PER_POUND), kg: round2(kg) };
  }

  /**
   * テレビ・モニターの「○インチ」(対角線の長さ)から画面の幅・高さ(cm)と
   * 視聴距離の目安を計算する。
   *
   * 幅・高さ: 対角線 = インチ × 2.54cm。画面比(横:縦)= W:H のとき、
   * 幅 = 対角線 × W ÷ √(W²+H²)、高さ = 対角線 × H ÷ √(W²+H²)(三平方の定理)。
   *
   * 視聴距離の目安の根拠: フルHDは「画面の高さの約3倍」、4Kは「約1.5倍」。
   * 走査線が目立たず視野に収まる距離として放送関係(NHK等)やテレビメーカー各社が
   * 案内している一般的な目安。4Kは画素が細かいため半分の距離まで近づける。
   *
   * 丸め: cmは小数第2位で四捨五入。
   * @param {number} inches 画面サイズ(インチ、対角線)
   * @param {number} ratioW 画面比の横(例: 16)
   * @param {number} ratioH 画面比の縦(例: 9)
   * @returns {{ok:true, diagonalCm:number, widthCm:number, heightCm:number,
   *            distFullHdCm:number, dist4kCm:number}
   *          |{ok:false, code:string}} code: "invalid_value"|"invalid_ratio"
   */
  function screenSize(inches, ratioW, ratioH) {
    if (!validValue(inches)) return { ok: false, code: "invalid_value" };
    if (!isFiniteNumber(ratioW) || !isFiniteNumber(ratioH) ||
        ratioW <= 0 || ratioH <= 0 || ratioW > 100 || ratioH > 100) {
      return { ok: false, code: "invalid_ratio" };
    }
    var diag = inches * CM_PER_INCH;
    var hyp = Math.sqrt(ratioW * ratioW + ratioH * ratioH);
    var w = diag * ratioW / hyp;
    var h = diag * ratioH / hyp;
    return {
      ok: true,
      diagonalCm: round2(diag),
      widthCm: round2(w),
      heightCm: round2(h),
      distFullHdCm: round2(h * 3),
      dist4kCm: round2(h * 1.5)
    };
  }

  /**
   * 2つの画面サイズ(インチ)を同じ画面比で比較する。
   * 面積の増加率 = (B² − A²) ÷ A² × 100(相似形なので面積は対角線の2乗に比例)。
   * 丸め: cm・%は小数第2位で四捨五入。
   * @param {number} inchA 今のサイズ(インチ)
   * @param {number} inchB 検討中のサイズ(インチ)
   * @param {number} ratioW 画面比の横
   * @param {number} ratioH 画面比の縦
   * @returns {{ok:true, widthA:number, heightA:number, widthB:number, heightB:number,
   *            widthDiff:number, heightDiff:number, areaRatePct:number}
   *          |{ok:false, code:string}}
   */
  function compareScreens(inchA, inchB, ratioW, ratioH) {
    var a = screenSize(inchA, ratioW, ratioH);
    if (!a.ok) return a;
    var b = screenSize(inchB, ratioW, ratioH);
    if (!b.ok) return b;
    return {
      ok: true,
      widthA: a.widthCm, heightA: a.heightCm,
      widthB: b.widthCm, heightB: b.heightCm,
      widthDiff: round2(b.widthCm - a.widthCm),
      heightDiff: round2(b.heightCm - a.heightCm),
      areaRatePct: round2((inchB * inchB - inchA * inchA) / (inchA * inchA) * 100)
    };
  }

  var api = {
    compareScreens: compareScreens,
    screenSize: screenSize,
    convertLength: convertLength,
    convertWeight: convertWeight,
    VALUE_MIN: VALUE_MIN,
    VALUE_MAX: VALUE_MAX,
    CM_PER_INCH: CM_PER_INCH,
    KG_PER_POUND: KG_PER_POUND
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.InchCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
