/*
 * LEDの電流制限抵抗の計算ロジック
 *
 * 根拠(一次情報):
 * - 大塚商会「LEDの抵抗値計算・電流制限抵抗の求め方」(オームの法則)
 *   https://www.otsuka-shokai.co.jp/products/led/howto/resistance.html (2026年7月29日参照)
 *   ・抵抗値 = 電圧 ÷ 電流
 *   ・電力(W)= 電圧(V)× 電流(A)
 *   ・余裕を持たせた定格の抵抗器を選ぶこと
 * - E12・E24系列(標準数)は IEC 60063(日本では JIS C 5063)で定められた
 *   抵抗の標準抵抗値。E24は1桁ごとに24個の値をとる。
 *
 * 前提:
 * - LEDを直列につなぎ、そこに1本の抵抗を直列に入れる、もっとも基本的な回路を想定する。
 *   並列接続(LEDごとに抵抗を分ける／分けない)は扱わない。
 * - 抵抗にかかる電圧 = 電源電圧 −(順電圧Vf × 直列するLEDの個数)。
 *   これが0以下になる場合はこの回路構成では点灯できないためエラーを返す。
 * - LEDの順電圧Vfは電流や個体差、温度で変わる。データシートの値を使うこと。
 * - 抵抗の定格電力は実際の消費電力の2倍以上を選ぶという一般的な目安で推奨値を出す
 *  (出典は「余裕を持たせる」とだけ述べており、2倍という数値は本ツールの前提)。
 */
(function (global) {
  "use strict";

  // E24系列(1桁分)。IEC 60063 / JIS C 5063
  var E24 = [1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0,
             3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1];
  // E12系列(1桁分)
  var E12 = [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2];
  // 一般に入手しやすい抵抗器の定格電力(W)
  var POWER_RATINGS = [0.0625, 0.125, 0.25, 0.5, 1, 2, 3, 5, 10];
  var DERATING = 2; // 定格は実消費の何倍以上を選ぶか

  var V_MIN = 0.1, V_MAX = 1000;     // 電源電圧(V)
  var VF_MIN = 0.1, VF_MAX = 100;    // 順電圧(V)
  var I_MIN = 0.01, I_MAX = 10000;   // 電流(mA)
  var N_MIN = 1, N_MAX = 100;        // 直列するLEDの個数

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function round(v, d) {
    var f = Math.pow(10, d);
    return Math.round(v * f) / f;
  }

  /**
   * 系列(E24など)から、指定した抵抗値に対する標準抵抗値を選ぶ。
   * @param {number} ohm 求めた抵抗値(Ω、0より大きい)
   * @param {number[]} series 1桁分の系列(E24 または E12)
   * @returns {{nearest:number, up:number}} nearest: もっとも近い標準値、
   *   up: その抵抗値以上でもっとも小さい標準値(電流が定格を超えないので安全側)
   */
  function pickFromSeries(ohm, series) {
    var exp = Math.floor(Math.log(ohm) / Math.LN10);
    var best = null, bestDiff = Infinity, up = null;
    // 桁の切り上がり・切り下がりを拾うため前後1桁も見る
    for (var e = exp - 1; e <= exp + 1; e++) {
      for (var i = 0; i < series.length; i++) {
        var v = round(series[i] * Math.pow(10, e), 10);
        var diff = Math.abs(v - ohm);
        if (diff < bestDiff) { bestDiff = diff; best = v; }
        if (v >= ohm && (up === null || v < up)) up = v;
      }
    }
    return { nearest: best, up: up === null ? best : up };
  }

  /**
   * LEDの電流制限抵抗と、抵抗で消費される電力を計算する。
   * R(Ω)=(電源電圧 − 順電圧×個数)÷ 電流(A)、P(W)=(電源電圧 − 順電圧×個数)× 電流(A)
   * @param {number} supplyV 電源電圧(V、0.1〜1000)
   * @param {number} vf LEDの順電圧Vf(V、0.1〜100)
   * @param {number} currentMa 流したい電流If(mA、0.01〜10000)
   * @param {number} [count=1] 直列するLEDの個数(1〜100の整数)
   * @returns {{ok:true, resistorV:number, ohm:number, watt:number, milliWatt:number,
   *            recommendedWatt:number, e24:number, e24Up:number, e12:number, e12Up:number,
   *            actualCurrentMa:number}
   *          |{ok:false, code:"invalid_supply"|"invalid_vf"|"invalid_current"|
   *                            "invalid_count"|"voltage_too_low"}}
   *   resistorV:       抵抗にかかる電圧(V、小数第3位で丸め)
   *   ohm:             必要な抵抗値(Ω、小数第2位で丸め)
   *   watt/milliWatt:  抵抗の消費電力(W は小数第4位、mW は小数第2位で丸め)
   *   recommendedWatt: 消費電力の2倍以上で入手しやすい定格電力(W)。
   *                    10Wでも足りない場合は必要値(消費電力×2)を整数に切り上げた値
   *   e24/e12:         もっとも近いE24・E12の標準抵抗値(Ω)
   *   e24Up/e12Up:     必要値以上でもっとも小さい標準抵抗値(Ω。電流が増えないので安全側)
   *   actualCurrentMa: e24Up の抵抗を使ったときに実際に流れる電流(mA、小数第2位で丸め)
   */
  function calculate(supplyV, vf, currentMa, count) {
    var n = count === undefined ? 1 : count;
    if (!isFiniteNumber(supplyV) || supplyV < V_MIN || supplyV > V_MAX) {
      return { ok: false, code: "invalid_supply" };
    }
    if (!isFiniteNumber(vf) || vf < VF_MIN || vf > VF_MAX) {
      return { ok: false, code: "invalid_vf" };
    }
    if (!isFiniteNumber(currentMa) || currentMa < I_MIN || currentMa > I_MAX) {
      return { ok: false, code: "invalid_current" };
    }
    if (!isFiniteNumber(n) || n !== Math.floor(n) || n < N_MIN || n > N_MAX) {
      return { ok: false, code: "invalid_count" };
    }
    var resistorV = supplyV - vf * n;
    if (resistorV <= 0) return { ok: false, code: "voltage_too_low" };

    var amp = currentMa / 1000;
    var ohm = resistorV / amp;
    var watt = resistorV * amp;
    var need = watt * DERATING;
    var recommended = null;
    for (var i = 0; i < POWER_RATINGS.length; i++) {
      if (POWER_RATINGS[i] >= need) { recommended = POWER_RATINGS[i]; break; }
    }
    // 最大の定格(10W)でも足りないときは、必要値を整数に切り上げて示す
    if (recommended === null) recommended = Math.ceil(need);
    var a = pickFromSeries(ohm, E24);
    var b = pickFromSeries(ohm, E12);
    return {
      ok: true,
      resistorV: round(resistorV, 3),
      ohm: round(ohm, 2),
      watt: round(watt, 4),
      milliWatt: round(watt * 1000, 2),
      recommendedWatt: recommended,
      e24: a.nearest,
      e24Up: a.up,
      e12: b.nearest,
      e12Up: b.up,
      actualCurrentMa: round(resistorV / a.up * 1000, 2)
    };
  }

  /**
   * 実際に使う抵抗値を決めたときに流れる電流と、その抵抗で消費される電力を求める。
   * @param {number} supplyV 電源電圧(V、0.1〜1000)
   * @param {number} vf LEDの順電圧Vf(V、0.1〜100)
   * @param {number} ohm 使う抵抗値(Ω、0より大きく10000000以下)
   * @param {number} [count=1] 直列するLEDの個数(1〜100の整数)
   * @returns {{ok:true, currentMa:number, watt:number, milliWatt:number, recommendedWatt:number}
   *          |{ok:false, code:"invalid_supply"|"invalid_vf"|"invalid_ohm"|
   *                            "invalid_count"|"voltage_too_low"}}
   */
  function currentFromOhm(supplyV, vf, ohm, count) {
    var n = count === undefined ? 1 : count;
    if (!isFiniteNumber(supplyV) || supplyV < V_MIN || supplyV > V_MAX) {
      return { ok: false, code: "invalid_supply" };
    }
    if (!isFiniteNumber(vf) || vf < VF_MIN || vf > VF_MAX) {
      return { ok: false, code: "invalid_vf" };
    }
    if (!isFiniteNumber(ohm) || ohm <= 0 || ohm > 10000000) {
      return { ok: false, code: "invalid_ohm" };
    }
    if (!isFiniteNumber(n) || n !== Math.floor(n) || n < N_MIN || n > N_MAX) {
      return { ok: false, code: "invalid_count" };
    }
    var resistorV = supplyV - vf * n;
    if (resistorV <= 0) return { ok: false, code: "voltage_too_low" };
    var amp = resistorV / ohm;
    var watt = resistorV * amp;
    var need = watt * DERATING;
    var recommended = null;
    for (var i = 0; i < POWER_RATINGS.length; i++) {
      if (POWER_RATINGS[i] >= need) { recommended = POWER_RATINGS[i]; break; }
    }
    // 最大の定格(10W)でも足りないときは、必要値を整数に切り上げて示す
    if (recommended === null) recommended = Math.ceil(need);
    return {
      ok: true,
      currentMa: round(amp * 1000, 2),
      watt: round(watt, 4),
      milliWatt: round(watt * 1000, 2),
      recommendedWatt: recommended
    };
  }

  /**
   * 直列につなげるLEDの最大個数(抵抗にかける電圧の余裕を確保する)。
   * @param {number} supplyV 電源電圧(V、0.1〜1000)
   * @param {number} vf LEDの順電圧Vf(V、0.1〜100)
   * @returns {{ok:true, maxCount:number}|{ok:false, code:"invalid_supply"|"invalid_vf"}}
   *   maxCount: 電源電圧を超えずに直列できる個数(0なら1個も点灯できない)
   */
  function maxSeriesCount(supplyV, vf) {
    if (!isFiniteNumber(supplyV) || supplyV < V_MIN || supplyV > V_MAX) {
      return { ok: false, code: "invalid_supply" };
    }
    if (!isFiniteNumber(vf) || vf < VF_MIN || vf > VF_MAX) {
      return { ok: false, code: "invalid_vf" };
    }
    var n = Math.ceil(supplyV / vf) - 1;
    if (n < 0) n = 0;
    return { ok: true, maxCount: n };
  }

  var api = {
    calculate: calculate,
    currentFromOhm: currentFromOhm,
    maxSeriesCount: maxSeriesCount,
    E24: E24,
    E12: E12,
    DERATING: DERATING
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.LedCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
