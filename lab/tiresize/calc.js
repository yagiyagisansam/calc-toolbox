/*
 * タイヤ外径・スピードメーター誤差の計算ロジック
 *
 * 根拠(一次情報):
 * - 国土交通省「道路運送車両の保安基準の細目を定める告示」第148条(速度計等)
 *   https://www.mlit.go.jp/jidosha/kijyun/saimokukokuji/saikoku_148_00.pdf (2026年7月29日参照)
 *   ・速度計の指度は「自動車の速度を下回らず、かつ、著しい誤差のないもの」であること
 *   ・平成18年12月31日までに製作された自動車(二輪等を除く):
 *       10(V1−6)/11 ≦ V2 ≦ (100/90)V1
 *   ・平成19年1月1日以降に製作された自動車(二輪等を除く):
 *       10(V1−6)/11 ≦ V2 ≦ V1
 *     V1 = 自動車に備える速度計の指示速度(km/h)、V2 = 速度計試験機を用いて計測した速度(km/h)
 *   ※国土交通省が公開している同PDFは2003年9月26日時点の条文である。
 * - 道路運送車両の保安基準(昭和26年運輸省令第67号) 第46条(速度計等)
 *   https://laws.e-gov.go.jp/law/326M50000800067 (2026年7月29日参照)
 *
 * 基準の時点:
 * - 上記の判定式は、国土交通省が公開する細目告示第148条(2003年9月26日時点)の条文による。
 *   その後の改正で許容範囲が変わっている可能性があるため、実際の合否は運輸支局・指定工場で確認すること。
 *
 * 前提:
 * - タイヤの外径は「呼び」の寸法から計算した理論値。実際の外径は銘柄・空気圧・荷重で数mm変わる。
 * - スピードメーターはタイヤ交換前の外径で校正されているものとし、
 *   交換後の実速度 V2 = 指示速度 V1 × (交換後の外径 ÷ 交換前の外径) として計算する。
 * - 扁平率が表記されないタイヤ(例: 195R14)には対応しない。
 *
 * 丸め:
 * - 外径(mm)は小数第1位、外径差(%)と速度は小数第2位に四捨五入する(表示のための丸め)。
 * - 合否の判定は丸める前の値で行う(丸めで判定が変わらないようにするため)。
 */
(function (global) {
  "use strict";

  var MM_PER_INCH = 25.4;

  // 細目告示第148条(四輪車)の判定式
  var ERAS = {
    h18: { label: "平成18年12月31日までに製作", upper: function (v1) { return (100 / 90) * v1; } },
    h19: { label: "平成19年1月1日以降に製作", upper: function (v1) { return v1; } }
  };

  function isNum(v) {
    return typeof v === "number" && isFinite(v);
  }
  function round1(v) { return Math.round(v * 10) / 10; }
  function round2(v) { return Math.round(v * 100) / 100; }

  /**
   * タイヤの呼び(幅/扁平率/リム径)から外径を求める。
   * 外径(mm) = リム径(inch) × 25.4 + 断面幅(mm) × 扁平率(%) ÷ 100 × 2
   * @param {number} widthMm 断面幅(mm)。100〜500
   * @param {number} aspectPct 扁平率(%)。20〜100
   * @param {number} rimInch リム径(インチ)。8〜30
   * @returns {{ok:true, outerMm:number, sectionHeightMm:number}
   *          |{ok:false, code:"invalid_width"|"invalid_aspect"|"invalid_rim"}}
   *   outerMm は小数第1位。sectionHeightMm はタイヤ1本ぶんの断面高さ(小数第1位)。
   */
  function outerDiameter(widthMm, aspectPct, rimInch) {
    if (!isNum(widthMm) || widthMm < 100 || widthMm > 500) return { ok: false, code: "invalid_width" };
    if (!isNum(aspectPct) || aspectPct < 20 || aspectPct > 100) return { ok: false, code: "invalid_aspect" };
    if (!isNum(rimInch) || rimInch < 8 || rimInch > 30) return { ok: false, code: "invalid_rim" };
    var h = widthMm * aspectPct / 100;
    return { ok: true, outerMm: round1(rimInch * MM_PER_INCH + h * 2), sectionHeightMm: round1(h) };
  }

  /**
   * 変更前後のタイヤサイズを比べ、外径差とメーター40km/h時の実速度を求める。
   * @param {number} oldWidthMm 変更前の断面幅(mm)
   * @param {number} oldAspectPct 変更前の扁平率(%)
   * @param {number} oldRimInch 変更前のリム径(インチ)
   * @param {number} newWidthMm 変更後の断面幅(mm)
   * @param {number} newAspectPct 変更後の扁平率(%)
   * @param {number} newRimInch 変更後のリム径(インチ)
   * @returns {{ok:true, oldOuterMm:number, newOuterMm:number, diffMm:number, diffPct:number,
   *            actualSpeedAt40:number, speedoErrorPct:number}
   *          |{ok:false, code:string}}
   *   diffPct = (新 − 旧) ÷ 旧 × 100(小数第2位)。
   *   actualSpeedAt40 はメーターが40km/hを指しているときの実速度(km/h、小数第2位)。
   *   speedoErrorPct = (指示速度 − 実速度) ÷ 実速度 × 100。マイナスはメーターが実速度より遅く出ること。
   */
  function compare(oldWidthMm, oldAspectPct, oldRimInch, newWidthMm, newAspectPct, newRimInch) {
    var a = outerDiameter(oldWidthMm, oldAspectPct, oldRimInch);
    if (!a.ok) return a;
    var b = outerDiameter(newWidthMm, newAspectPct, newRimInch);
    if (!b.ok) return b;
    var ratio = b.outerMm / a.outerMm;
    var v2 = 40 * ratio;
    return {
      ok: true,
      oldOuterMm: a.outerMm,
      newOuterMm: b.outerMm,
      diffMm: round1(b.outerMm - a.outerMm),
      diffPct: round2((b.outerMm - a.outerMm) / a.outerMm * 100),
      actualSpeedAt40: round2(v2),
      speedoErrorPct: round2((40 - v2) / v2 * 100)
    };
  }

  /**
   * 細目告示第148条の速度計の基準に当てはめて判定する。
   * @param {number} oldOuterMm 変更前のタイヤ外径(mm)。1〜2000
   * @param {number} newOuterMm 変更後のタイヤ外径(mm)。1〜2000
   * @param {"h18"|"h19"} era 製作時期。h18=平成18年12月31日まで / h19=平成19年1月1日以降
   * @param {number} [v1=40] 速度計の指示速度(km/h)。10〜200。検査は通常40km/hで行う
   * @returns {{ok:true, v1:number, v2:number, minV2:number, maxV2:number, pass:boolean, eraLabel:string}
   *          |{ok:false, code:"invalid_diameter"|"invalid_era"|"invalid_speed"}}
   *   v2 は変更後のタイヤでメーターがV1を指しているときの実速度。
   *   pass は minV2 ≦ v2 ≦ maxV2 を満たすかどうか(丸める前の値で判定)。
   */
  function speedoJudge(oldOuterMm, newOuterMm, era, v1) {
    if (!isNum(oldOuterMm) || oldOuterMm <= 0 || oldOuterMm > 2000) return { ok: false, code: "invalid_diameter" };
    if (!isNum(newOuterMm) || newOuterMm <= 0 || newOuterMm > 2000) return { ok: false, code: "invalid_diameter" };
    var e = ERAS[era];
    if (!e) return { ok: false, code: "invalid_era" };
    var speed = v1 === undefined || v1 === null ? 40 : v1;
    if (!isNum(speed) || speed < 10 || speed > 200) return { ok: false, code: "invalid_speed" };

    var v2 = speed * (newOuterMm / oldOuterMm);
    var min = 10 * (speed - 6) / 11;
    var max = e.upper(speed);
    var eps = 1e-9;
    return {
      ok: true,
      v1: speed,
      v2: round2(v2),
      minV2: round2(min),
      maxV2: round2(max),
      pass: v2 >= min - eps && v2 <= max + eps,
      eraLabel: e.label
    };
  }

  /**
   * 外径比較と速度計の判定をまとめて行う。
   * @param {{oldWidthMm:number, oldAspectPct:number, oldRimInch:number,
   *          newWidthMm:number, newAspectPct:number, newRimInch:number,
   *          era?:string, v1?:number}} opts 入力値
   * @returns {{ok:true, size:object, judge:object}|{ok:false, code:string}}
   */
  function calculate(opts) {
    if (!opts || typeof opts !== "object") return { ok: false, code: "invalid_input" };
    var c = compare(opts.oldWidthMm, opts.oldAspectPct, opts.oldRimInch,
      opts.newWidthMm, opts.newAspectPct, opts.newRimInch);
    if (!c.ok) return c;
    var j = speedoJudge(c.oldOuterMm, c.newOuterMm, opts.era || "h19", opts.v1);
    if (!j.ok) return j;
    return { ok: true, size: c, judge: j };
  }

  var api = {
    outerDiameter: outerDiameter,
    compare: compare,
    speedoJudge: speedoJudge,
    calculate: calculate
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.TiresizeCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
