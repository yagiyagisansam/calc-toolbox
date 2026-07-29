/*
 * 暑さ指数(WBGT)の簡易推定ロジック
 *
 * 根拠(一次情報):
 * - 日本生気象学会「日常生活における熱中症予防指針 Ver.4」(2022年5月23日)
 *   https://seikishou.jp/cms/wp-content/uploads/20220523-v4.pdf (2026年7月29日参照)
 *   ・温度基準域: 危険31℃以上 / 厳重警戒28℃以上31℃未満 / 警戒25℃以上28℃未満 / 注意25℃未満
 *   ・図3「室内を対象とした気温と相対湿度からWBGTを簡易的に推定する図(室内用のWBGT簡易推定図)」
 *     本ファイルの INDOOR_TABLE はこの図の数値(気温21〜40℃ × 相対湿度20〜100%)をそのまま持つ
 *     ※この図は「室内専用」であり、屋外や日射・発熱体のある場所には使えない
 * - 環境省 熱中症予防情報サイト「当サイトで提供する暑さ指数(WBGT)について」
 *   https://www.wbgt.env.go.jp/wbgt_detail.php (2026年7月29日参照)
 *   ・実況推定値・予測値の算出式(小野・登内の式):
 *     WBGT = 0.735×Ta + 0.0374×RH + 0.00292×Ta×RH + 7.619×SR − 4.557×SR² − 0.0572×WS − 4.064
 *     Ta=気温(℃)、RH=相対湿度(%)、SR=全天日射量(kW/m²)、WS=平均風速(m/s)
 * - 環境省 熱中症予防情報サイト「暑さ指数(WBGT)について」(日常生活に関する指針・運動に関する指針)
 *   https://www.wbgt.env.go.jp/wbgt.php (2026年7月29日参照)
 *   ・運動に関する指針(日本スポーツ協会): 31以上 運動は原則中止 / 28〜31 厳重警戒 / 25〜28 警戒 /
 *     21〜25 注意 / 21未満 ほぼ安全
 *
 * 前提:
 * - 屋内の推定は上記の「室内用のWBGT簡易推定図」の数値を線形補間したもの。図の範囲外(気温21℃未満/40℃超、
 *   相対湿度20%未満)ではエラーを返す
 * - 屋外の推定は小野・登内の式に、日射量と風速の既定値(SR=0.8kW/m²・WS=1.0m/s)を当てはめたもの。
 *   実際の日射量・風速で結果は大きく変わるため、あくまで概算
 * - いずれも実測のWBGT値ではない。正確な値はWBGT測定器または環境省の公表値を確認すること
 */
(function (global) {
  "use strict";

  var HUMIDITY_STEPS = [20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100];
  var TEMP_MIN = 21;
  var TEMP_MAX = 40;

  // 室内用のWBGT簡易推定図(日本生気象学会 熱中症予防指針Ver.4 図3)
  // 添字0が気温21℃、以降1℃ずつ40℃まで。各行は HUMIDITY_STEPS に対応する17個のWBGT値(℃)
  var INDOOR_TABLE = [
    [14, 14, 15, 15, 16, 16, 17, 17, 18, 18, 19, 19, 19, 20, 20, 21, 21], // 21℃
    [15, 15, 16, 16, 17, 17, 18, 18, 19, 19, 20, 20, 20, 21, 21, 22, 22], // 22℃
    [15, 16, 16, 17, 18, 18, 19, 19, 20, 20, 20, 21, 21, 22, 22, 23, 23], // 23℃
    [16, 17, 17, 18, 18, 19, 19, 20, 20, 21, 21, 22, 22, 23, 23, 24, 24], // 24℃
    [17, 17, 18, 19, 19, 20, 20, 21, 21, 22, 22, 23, 23, 24, 24, 25, 25], // 25℃
    [18, 18, 19, 20, 20, 21, 21, 22, 22, 23, 23, 24, 24, 25, 25, 26, 26], // 26℃
    [18, 19, 20, 20, 21, 22, 22, 23, 23, 24, 24, 25, 25, 26, 26, 27, 27], // 27℃
    [19, 20, 21, 21, 22, 22, 23, 24, 24, 25, 25, 26, 26, 27, 27, 28, 28], // 28℃
    [20, 21, 21, 22, 23, 23, 24, 24, 25, 26, 26, 27, 27, 28, 28, 29, 29], // 29℃
    [21, 21, 22, 23, 23, 24, 25, 25, 26, 26, 27, 28, 28, 29, 29, 30, 30], // 30℃
    [21, 22, 23, 24, 24, 25, 26, 26, 27, 27, 28, 29, 29, 30, 30, 31, 31], // 31℃
    [22, 23, 24, 24, 25, 26, 26, 27, 28, 28, 29, 29, 30, 31, 31, 32, 32], // 32℃
    [23, 24, 25, 25, 26, 27, 27, 28, 29, 29, 30, 30, 31, 31, 32, 33, 33], // 33℃
    [24, 25, 25, 26, 27, 28, 28, 29, 30, 30, 31, 31, 32, 32, 33, 34, 34], // 34℃
    [24, 25, 26, 27, 28, 28, 29, 30, 30, 31, 32, 32, 33, 33, 34, 34, 35], // 35℃
    [25, 26, 27, 28, 29, 29, 30, 31, 31, 32, 33, 33, 34, 34, 35, 35, 36], // 36℃
    [26, 27, 28, 29, 29, 30, 31, 32, 32, 33, 34, 34, 35, 35, 36, 36, 37], // 37℃
    [27, 28, 29, 29, 30, 31, 32, 33, 33, 34, 35, 35, 36, 36, 37, 37, 38], // 38℃
    [27, 28, 29, 30, 31, 32, 33, 33, 34, 35, 35, 36, 37, 37, 38, 38, 39], // 39℃
    [28, 29, 30, 31, 32, 33, 34, 34, 35, 36, 36, 37, 38, 38, 39, 39, 40]  // 40℃
  ];

  var DEFAULT_SOLAR = 0.8; // kW/m² 晴天の日中を想定した既定値
  var DEFAULT_WIND = 1.0; // m/s 既定値

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function round1(v) {
    return Math.round(v * 10) / 10;
  }

  /**
   * 室内用のWBGT簡易推定図(日本生気象学会)から、気温と相対湿度でWBGTを推定する。
   * 表の格子点の間は線形補間する。
   * @param {number} tempC 気温(℃)。21〜40(図の範囲)
   * @param {number} humidityPct 相対湿度(%)。20〜100(図の範囲)
   * @returns {{ok:true, wbgt:number, method:"indoor_chart"}
   *          |{ok:false, code:"invalid_temp"|"invalid_humidity"|"out_of_chart"}}
   *   wbgt は小数第1位で四捨五入した値(℃)。
   */
  function estimateIndoor(tempC, humidityPct) {
    if (!isFiniteNumber(tempC)) return { ok: false, code: "invalid_temp" };
    if (!isFiniteNumber(humidityPct)) return { ok: false, code: "invalid_humidity" };
    if (tempC < TEMP_MIN || tempC > TEMP_MAX) return { ok: false, code: "out_of_chart" };
    if (humidityPct < 20 || humidityPct > 100) return { ok: false, code: "out_of_chart" };

    var tPos = tempC - TEMP_MIN;
    var t0 = Math.floor(tPos);
    var t1 = Math.min(t0 + 1, INDOOR_TABLE.length - 1);
    var tf = tPos - t0;

    var hPos = (humidityPct - 20) / 5;
    var h0 = Math.floor(hPos);
    var h1 = Math.min(h0 + 1, HUMIDITY_STEPS.length - 1);
    var hf = hPos - h0;

    var a = INDOOR_TABLE[t0][h0] * (1 - hf) + INDOOR_TABLE[t0][h1] * hf;
    var b = INDOOR_TABLE[t1][h0] * (1 - hf) + INDOOR_TABLE[t1][h1] * hf;
    return { ok: true, wbgt: round1(a * (1 - tf) + b * tf), method: "indoor_chart" };
  }

  /**
   * 環境省が実況推定値・予測値に用いている式(小野・登内の式)でWBGTを求める。
   * @param {number} tempC 気温(℃)。-50〜60
   * @param {number} humidityPct 相対湿度(%)。0〜100
   * @param {number} solarKwm2 全天日射量(kW/m²)。0〜2
   * @param {number} windMs 平均風速(m/s)。0〜50
   * @returns {{ok:true, wbgt:number, method:"env_formula"}
   *          |{ok:false, code:"invalid_temp"|"invalid_humidity"|"invalid_solar"|"invalid_wind"}}
   *   wbgt は小数第1位で四捨五入した値(℃)。
   */
  function estimateByFormula(tempC, humidityPct, solarKwm2, windMs) {
    if (!isFiniteNumber(tempC) || tempC < -50 || tempC > 60) return { ok: false, code: "invalid_temp" };
    if (!isFiniteNumber(humidityPct) || humidityPct < 0 || humidityPct > 100) {
      return { ok: false, code: "invalid_humidity" };
    }
    if (!isFiniteNumber(solarKwm2) || solarKwm2 < 0 || solarKwm2 > 2) return { ok: false, code: "invalid_solar" };
    if (!isFiniteNumber(windMs) || windMs < 0 || windMs > 50) return { ok: false, code: "invalid_wind" };
    var w = 0.735 * tempC
      + 0.0374 * humidityPct
      + 0.00292 * tempC * humidityPct
      + 7.619 * solarKwm2
      - 4.557 * solarKwm2 * solarKwm2
      - 0.0572 * windMs
      - 4.064;
    return { ok: true, wbgt: round1(w), method: "env_formula" };
  }

  /**
   * 屋外(日なた)のWBGTを、既定の日射量・風速を当てはめて推定する。
   * @param {number} tempC 気温(℃)。-50〜60
   * @param {number} humidityPct 相対湿度(%)。0〜100
   * @returns {{ok:true, wbgt:number, method:"env_formula", solarKwm2:number, windMs:number}
   *          |{ok:false, code:string}}
   */
  function estimateOutdoor(tempC, humidityPct) {
    var r = estimateByFormula(tempC, humidityPct, DEFAULT_SOLAR, DEFAULT_WIND);
    if (!r.ok) return r;
    r.solarKwm2 = DEFAULT_SOLAR;
    r.windMs = DEFAULT_WIND;
    return r;
  }

  /**
   * 日常生活に関する指針(日本生気象学会)の温度基準域を返す。
   * @param {number} wbgt 暑さ指数(℃)。-50〜60
   * @returns {{ok:true, key:"danger"|"severe_warning"|"warning"|"caution"}
   *          |{ok:false, code:"invalid_wbgt"}}
   */
  function dailyLevel(wbgt) {
    if (!isFiniteNumber(wbgt) || wbgt < -50 || wbgt > 60) return { ok: false, code: "invalid_wbgt" };
    if (wbgt >= 31) return { ok: true, key: "danger" };
    if (wbgt >= 28) return { ok: true, key: "severe_warning" };
    if (wbgt >= 25) return { ok: true, key: "warning" };
    return { ok: true, key: "caution" };
  }

  /**
   * 運動に関する指針(日本スポーツ協会)の区分を返す。
   * @param {number} wbgt 暑さ指数(℃)。-50〜60
   * @returns {{ok:true, key:"stop"|"severe_warning"|"warning"|"caution"|"almost_safe"}
   *          |{ok:false, code:"invalid_wbgt"}}
   */
  function sportsLevel(wbgt) {
    if (!isFiniteNumber(wbgt) || wbgt < -50 || wbgt > 60) return { ok: false, code: "invalid_wbgt" };
    if (wbgt >= 31) return { ok: true, key: "stop" };
    if (wbgt >= 28) return { ok: true, key: "severe_warning" };
    if (wbgt >= 25) return { ok: true, key: "warning" };
    if (wbgt >= 21) return { ok: true, key: "caution" };
    return { ok: true, key: "almost_safe" };
  }

  /**
   * 場所を選んでWBGTを推定し、2つの指針の区分もあわせて返す。
   * @param {number} tempC 気温(℃)
   * @param {number} humidityPct 相対湿度(%)
   * @param {"indoor"|"outdoor"} place 場所。"indoor"=室内(日射なし) / "outdoor"=屋外(日なた)
   * @returns {{ok:true, wbgt:number, method:string, dailyKey:string, sportsKey:string}
   *          |{ok:false, code:string}}
   */
  function estimate(tempC, humidityPct, place) {
    if (place !== "indoor" && place !== "outdoor") return { ok: false, code: "invalid_place" };
    var r = place === "indoor" ? estimateIndoor(tempC, humidityPct) : estimateOutdoor(tempC, humidityPct);
    if (!r.ok) return r;
    var d = dailyLevel(r.wbgt);
    var s = sportsLevel(r.wbgt);
    return {
      ok: true,
      wbgt: r.wbgt,
      method: r.method,
      dailyKey: d.ok ? d.key : null,
      sportsKey: s.ok ? s.key : null
    };
  }

  var api = {
    HUMIDITY_STEPS: HUMIDITY_STEPS,
    DEFAULT_SOLAR: DEFAULT_SOLAR,
    DEFAULT_WIND: DEFAULT_WIND,
    estimateIndoor: estimateIndoor,
    estimateByFormula: estimateByFormula,
    estimateOutdoor: estimateOutdoor,
    dailyLevel: dailyLevel,
    sportsLevel: sportsLevel,
    estimate: estimate
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.WbgtCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
