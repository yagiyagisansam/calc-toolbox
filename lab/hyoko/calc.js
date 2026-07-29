/*
 * 標高から山頂の気温を求める計算ロジック
 *
 * 根拠(出典):
 * - コトバンク「気温減率」(デジタル大辞泉・世界大百科事典・百科事典マイペディアほか)
 *   https://kotobank.jp/word/%E6%B0%97%E6%B8%A9%E6%B8%9B%E7%8E%87-155657 (2026年7月29日参照)
 *   デジタル大辞泉:「高度が増すにつれて気温が低くなる割合」「100メートル増すごとに
 *   セ氏0.5〜0.6度低くなる」/ 世界大百科事典:「平均的には0.65℃/100mである」
 * - 日本気象協会 tenki.jp「登山で知っておきたい気温の知識『寒さ』編」(2025年9月11日掲載)
 *   https://tenki.jp/mountain/column/tenkijp_labo/2025/09/11/32714.html (2026年7月29日参照)
 *   「標高が1000m上がると、気温はおよそ6.5℃下がります」
 *   「風速が1m/s強くなるごとに体感温度は1℃ずつ下がると言われています」
 *
 * 前提:
 * - 気温減率は既定で0.6℃/100m(登山でよく使われる目安)。0.5(湿潤な大気)〜
 *   0.65(標準大気・日本気象協会)まで選べる。
 * - 体感温度は「風速1m/sにつき1℃低下」という簡易な目安。実際には風が強くなるほど
 *   1m/sあたりの低下量は小さくなる(非線形)ため、強風時は下がりすぎた値になる。
 * - 日射・湿度・放射冷却・気圧配置は考慮しない。逆転層があると計算どおりにならない。
 */
(function (global) {
  "use strict";

  var ALT_MIN = -500; // 標高の下限(m)
  var ALT_MAX = 9000; // 標高の上限(m)
  var TEMP_MIN = -60; // 気温の下限(℃)
  var TEMP_MAX = 60; // 気温の上限(℃)
  var LAPSE_MIN = 0.3; // 気温減率の下限(℃/100m)
  var LAPSE_MAX = 1.0; // 気温減率の上限(℃/100m。乾燥断熱減率が約1.0)
  var WIND_MAX = 60; // 風速の上限(m/s)
  var DEFAULT_LAPSE = 0.6;

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  /** 小数第n位で四捨五入する */
  function round(v, n) {
    var f = Math.pow(10, n);
    return Math.round(v * f) / f;
  }

  /**
   * 麓の気温と標高差から目的地の気温を求める。
   * @param {number} baseAltM 麓(基準地点)の標高(m、ALT_MIN〜ALT_MAX)
   * @param {number} baseTempC 麓の気温(℃、TEMP_MIN〜TEMP_MAX)
   * @param {number} targetAltM 目的地の標高(m、ALT_MIN〜ALT_MAX)
   * @param {number} [lapsePer100=0.6] 気温減率(℃/100m、LAPSE_MIN〜LAPSE_MAX)
   * @returns {{ok:true, tempC:number, diffM:number, dropC:number, lapsePer100:number}
   *          |{ok:false, code:"invalid_base_alt"|"invalid_base_temp"|"invalid_target_alt"|"invalid_lapse"}}
   *   tempC: 目的地の推定気温(℃、小数第1位で四捨五入)
   *   diffM: 標高差(m。目的地が低い場合は負)
   *   dropC: 気温の低下量(℃、小数第1位で四捨五入。目的地が低い場合は負)
   */
  function temperature(baseAltM, baseTempC, targetAltM, lapsePer100) {
    if (!isFiniteNumber(baseAltM) || baseAltM < ALT_MIN || baseAltM > ALT_MAX) {
      return { ok: false, code: "invalid_base_alt" };
    }
    if (!isFiniteNumber(baseTempC) || baseTempC < TEMP_MIN || baseTempC > TEMP_MAX) {
      return { ok: false, code: "invalid_base_temp" };
    }
    if (!isFiniteNumber(targetAltM) || targetAltM < ALT_MIN || targetAltM > ALT_MAX) {
      return { ok: false, code: "invalid_target_alt" };
    }
    var lapse = lapsePer100 === undefined ? DEFAULT_LAPSE : lapsePer100;
    if (!isFiniteNumber(lapse) || lapse < LAPSE_MIN || lapse > LAPSE_MAX) {
      return { ok: false, code: "invalid_lapse" };
    }
    var diff = targetAltM - baseAltM;
    var drop = lapse * (diff / 100);
    return {
      ok: true,
      tempC: round(baseTempC - drop, 1),
      diffM: round(diff, 1),
      dropC: round(drop, 1),
      lapsePer100: lapse
    };
  }

  /**
   * 風速を加えた体感温度を求める(風速1m/sにつき1℃低下という簡易な目安)。
   * @param {number} tempC 気温(℃、TEMP_MIN〜TEMP_MAX)
   * @param {number} windMs 風速(m/s、0以上WIND_MAX以下)
   * @returns {{ok:true, feltC:number, dropC:number}
   *          |{ok:false, code:"invalid_temp"|"invalid_wind"}}
   *   feltC: 体感温度(℃、小数第1位で四捨五入)
   *   dropC: 風による低下量(℃、風速の値と同じ)
   */
  function windChill(tempC, windMs) {
    if (!isFiniteNumber(tempC) || tempC < TEMP_MIN || tempC > TEMP_MAX) {
      return { ok: false, code: "invalid_temp" };
    }
    if (!isFiniteNumber(windMs) || windMs < 0 || windMs > WIND_MAX) {
      return { ok: false, code: "invalid_wind" };
    }
    return { ok: true, feltC: round(tempC - windMs, 1), dropC: round(windMs, 1) };
  }

  /**
   * 目的地の気温と体感温度をまとめて求める。
   * @param {number} baseAltM 麓の標高(m)
   * @param {number} baseTempC 麓の気温(℃)
   * @param {number} targetAltM 目的地の標高(m)
   * @param {number} windMs 目的地の風速(m/s)
   * @param {number} [lapsePer100=0.6] 気温減率(℃/100m)
   * @returns {{ok:true, tempC:number, feltC:number, diffM:number, dropC:number,
   *            windDropC:number, lapsePer100:number}|{ok:false, code:string}}
   */
  function calculate(baseAltM, baseTempC, targetAltM, windMs, lapsePer100) {
    var t = temperature(baseAltM, baseTempC, targetAltM, lapsePer100);
    if (!t.ok) return t;
    var w = windChill(t.tempC, windMs);
    if (!w.ok) return w;
    return {
      ok: true,
      tempC: t.tempC,
      feltC: w.feltC,
      diffM: t.diffM,
      dropC: t.dropC,
      windDropC: w.dropC,
      lapsePer100: t.lapsePer100
    };
  }

  var api = {
    DEFAULT_LAPSE: DEFAULT_LAPSE,
    temperature: temperature,
    windChill: windChill,
    calculate: calculate
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.HyokoCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
