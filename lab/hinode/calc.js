/*
 * 日の出・日の入り時刻 計算ロジック
 *
 * 根拠(一次情報):
 * - NOAA Global Monitoring Laboratory "Solar Calculation Details"
 *   https://gml.noaa.gov/grad/solcalc/calcdetails.html (2026年7月29日参照)
 *   計算は Jean Meeus "Astronomical Algorithms" の式に基づく。
 *   日の出・日の入りは大気差 0.833°(太陽の天頂角 90.833°)を仮定する。
 * - NOAA 配布のスプレッドシート NOAA_Solar_Calculations_day.ods
 *   https://gml.noaa.gov/grad/solcalc/NOAA_Solar_Calculations_day.ods (2026年7月29日参照)
 *   本ファイルの各式(太陽の平均黄経・中心差・黄道傾斜角・均時差・日の出の時角など)は
 *   このスプレッドシートの各列の式をそのまま移したもの。
 *
 * 検算:
 * - 国立天文台 暦計算室「各地のこよみ」の値と比較して1分以内で一致することを確認した。
 *   東京(北緯35.6581°/東経139.7414°/UT+9) 2026年1月1日: 日の出6:51 南中11:44 日の入り16:38
 *   東京 2026年2月1日: 日の出6:41 南中11:55 日の入り17:08
 *   根室(北緯43.3333°/東経145.5833°/UT+9) 2026年1月1日: 日の出6:50 南中11:21 日の入り15:52
 *   https://eco.mtk.nao.ac.jp/koyomi/dni/2026/s1301.html (2026年7月29日参照)
 *
 * 前提:
 * - 標高0m・平坦な地平線を前提とする。山の上や高いビルからは日の出が早く見える。
 * - 大気の状態(気温・気圧・湿度)で実際の見え方は前後する。NOAA自身が
 *   「緯度±72°の範囲で理論上1分以内、それ以外では10分以内」としている。
 * - 経度は東経がプラス、西経がマイナス。緯度は北緯がプラス、南緯がマイナス。
 * - 標準時のずれ(時差)は東がプラス(日本は +9)。夏時間は自動では扱わない。
 * - 高緯度で太陽が一日中沈まない/昇らない日は polar フラグを返す。
 */
(function (global) {
  "use strict";

  var MIN_YEAR = 1583; // グレゴリオ暦として扱える範囲
  var MAX_YEAR = 3000;
  var ZENITH = 90.833; // 日の出・日の入りの天頂角(大気差0.833°を含む)

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }
  function isInt(v) {
    return isFiniteNumber(v) && Math.floor(v) === v;
  }
  function rad(d) { return (d * Math.PI) / 180; }
  function deg(r) { return (r * 180) / Math.PI; }

  function daysInMonth(y, m) {
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  }

  /**
   * 世界時0時のユリウス日を求める(グレゴリオ暦)
   * @param {number} year 西暦年
   * @param {number} month 月(1〜12)
   * @param {number} day 日(1〜31)
   * @returns {number} ユリウス日(その日の世界時0時)
   */
  function julianDay(year, month, day) {
    var y = year;
    var m = month;
    if (m <= 2) { y -= 1; m += 12; }
    var a = Math.floor(y / 100);
    var b = 2 - a + Math.floor(a / 4);
    return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + b - 1524.5;
  }

  /**
   * 分(1日の始まりからの分数)を "H:MM" 形式にする
   * @param {number} minutes 0以上1440未満の分。範囲外は前後の日に丸めず、そのまま24時間で正規化する
   * @returns {string} "6:51" のような時刻文字列
   */
  function toTimeString(minutes) {
    var m = Math.round(minutes);
    var wrapped = ((m % 1440) + 1440) % 1440;
    var h = Math.floor(wrapped / 60);
    var mm = wrapped % 60;
    return h + ":" + (mm < 10 ? "0" : "") + mm;
  }

  /**
   * 指定日・指定地点の太陽の位置に関する量を求める(NOAAスプレッドシートの各列)
   * @param {number} jd その日の地方正午のユリウス日
   * @returns {{declination:number, eqTime:number}}
   *   declination: 太陽赤緯(度)、eqTime: 均時差(分)
   */
  function solarValues(jd) {
    var t = (jd - 2451545) / 36525; // ユリウス世紀
    var L0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360; // 太陽の幾何平均黄経(度)
    if (L0 < 0) L0 += 360;
    var M = 357.52911 + t * (35999.05029 - 0.0001537 * t); // 太陽の幾何平均近点角(度)
    var e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t); // 地球軌道の離心率
    var C = Math.sin(rad(M)) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
      Math.sin(rad(2 * M)) * (0.019993 - 0.000101 * t) +
      Math.sin(rad(3 * M)) * 0.000289; // 中心差
    var trueLong = L0 + C;
    var appLong = trueLong - 0.00569 - 0.00478 * Math.sin(rad(125.04 - 1934.136 * t)); // 見かけの黄経
    var meanObliq = 23 + (26 + ((21.448 - t * (46.815 + t * (0.00059 - t * 0.001813)))) / 60) / 60;
    var obliqCorr = meanObliq + 0.00256 * Math.cos(rad(125.04 - 1934.136 * t)); // 黄道傾斜角(補正後)
    var declination = deg(Math.asin(Math.sin(rad(obliqCorr)) * Math.sin(rad(appLong))));
    var vary = Math.tan(rad(obliqCorr / 2)) * Math.tan(rad(obliqCorr / 2));
    var eqTime = 4 * deg(
      vary * Math.sin(2 * rad(L0)) -
      2 * e * Math.sin(rad(M)) +
      4 * e * vary * Math.sin(rad(M)) * Math.cos(2 * rad(L0)) -
      0.5 * vary * vary * Math.sin(4 * rad(L0)) -
      1.25 * e * e * Math.sin(2 * rad(M))
    );
    return { declination: declination, eqTime: eqTime };
  }

  /**
   * 緯度経度と日付から日の出・南中・日の入り時刻と昼の長さを求める
   * @param {number} year 西暦年(1583〜3000)
   * @param {number} month 月(1〜12)
   * @param {number} day 日(1〜その月の末日)
   * @param {number} latitude 緯度(度)。北緯がプラス。−90〜90
   * @param {number} longitude 経度(度)。東経がプラス。−180〜180
   * @param {number} tzHours 標準時のずれ(時間)。日本は9。−14〜14
   * @returns {{ok:true, sunrise:(string|null), sunset:(string|null), solarNoon:string,
   *            sunriseMinutes:(number|null), sunsetMinutes:(number|null), noonMinutes:number,
   *            dayLengthMinutes:number, dayLength:string, declination:number, eqTime:number,
   *            noonAltitude:number, polar:(null|"midnight_sun"|"polar_night")}
   *          |{ok:false, code:"invalid_date"|"invalid_latitude"|"invalid_longitude"|"invalid_timezone"}}
   *   sunrise/sunset: "6:51" 形式(1分未満は四捨五入)。太陽が沈まない/昇らない日は null
   *   dayLengthMinutes: 昼の長さ(分、小数第1位で四捨五入)
   *   declination: 太陽赤緯(度、小数第3位で四捨五入)
   *   eqTime: 均時差(分、小数第3位で四捨五入)
   *   noonAltitude: 南中高度(度、小数第2位で四捨五入)。90 − |緯度 − 太陽赤緯| の幾何学的な値で、
   *                 大気差や地心視差を含まないため国立天文台の値と0.1度ほど差が出ることがある
   *   polar: 白夜なら "midnight_sun"、極夜なら "polar_night"、それ以外は null
   */
  function calculate(year, month, day, latitude, longitude, tzHours) {
    if (!isInt(year) || year < MIN_YEAR || year > MAX_YEAR) return { ok: false, code: "invalid_date" };
    if (!isInt(month) || month < 1 || month > 12) return { ok: false, code: "invalid_date" };
    if (!isInt(day) || day < 1 || day > daysInMonth(year, month)) return { ok: false, code: "invalid_date" };
    if (!isFiniteNumber(latitude) || latitude < -90 || latitude > 90) {
      return { ok: false, code: "invalid_latitude" };
    }
    if (!isFiniteNumber(longitude) || longitude < -180 || longitude > 180) {
      return { ok: false, code: "invalid_longitude" };
    }
    if (!isFiniteNumber(tzHours) || tzHours < -14 || tzHours > 14) {
      return { ok: false, code: "invalid_timezone" };
    }

    // 地方正午(現地12時)のユリウス日で太陽の位置を求める
    var jd = julianDay(year, month, day) + 0.5 - tzHours / 24;
    var s = solarValues(jd);
    var noonMinutes = 720 - 4 * longitude - s.eqTime + tzHours * 60;

    var cosH = Math.cos(rad(ZENITH)) / (Math.cos(rad(latitude)) * Math.cos(rad(s.declination))) -
      Math.tan(rad(latitude)) * Math.tan(rad(s.declination));
    var polar = null;
    var haSunrise = null;
    if (cosH > 1) polar = "polar_night"; // 太陽が地平線より上に出ない
    else if (cosH < -1) polar = "midnight_sun"; // 太陽が沈まない
    else haSunrise = deg(Math.acos(cosH));

    var sunriseMinutes = haSunrise === null ? null : noonMinutes - haSunrise * 4;
    var sunsetMinutes = haSunrise === null ? null : noonMinutes + haSunrise * 4;
    var dayLength = haSunrise === null ? (polar === "midnight_sun" ? 1440 : 0) : 8 * haSunrise;
    var noonAltitude = 90 - Math.abs(latitude - s.declination);

    return {
      ok: true,
      sunrise: sunriseMinutes === null ? null : toTimeString(sunriseMinutes),
      sunset: sunsetMinutes === null ? null : toTimeString(sunsetMinutes),
      solarNoon: toTimeString(noonMinutes),
      sunriseMinutes: sunriseMinutes === null ? null : Math.round(sunriseMinutes * 100) / 100,
      sunsetMinutes: sunsetMinutes === null ? null : Math.round(sunsetMinutes * 100) / 100,
      noonMinutes: Math.round(noonMinutes * 100) / 100,
      dayLengthMinutes: Math.round(dayLength * 10) / 10,
      dayLength: Math.floor(Math.round(dayLength) / 60) + "時間" + (Math.round(dayLength) % 60) + "分",
      declination: Math.round(s.declination * 1000) / 1000,
      eqTime: Math.round(s.eqTime * 1000) / 1000,
      noonAltitude: Math.round(noonAltitude * 100) / 100,
      polar: polar
    };
  }

  /**
   * 同じ地点の2つの日付の日の出・日の入りを比べる
   * @param {number} y1 1つ目の西暦年
   * @param {number} m1 1つ目の月(1〜12)
   * @param {number} d1 1つ目の日
   * @param {number} y2 2つ目の西暦年
   * @param {number} m2 2つ目の月(1〜12)
   * @param {number} d2 2つ目の日
   * @param {number} latitude 緯度(度)。北緯がプラス
   * @param {number} longitude 経度(度)。東経がプラス
   * @param {number} tzHours 標準時のずれ(時間)
   * @returns {{ok:true, sunriseDiffMinutes:(number|null), sunsetDiffMinutes:(number|null),
   *            dayLengthDiffMinutes:number}
   *          |{ok:false, code:string}}
   *   各値は「2つ目 − 1つ目」の差(分、小数第1位で四捨五入)。プラスなら2つ目のほうが遅い/長い
   */
  function compare(y1, m1, d1, y2, m2, d2, latitude, longitude, tzHours) {
    var a = calculate(y1, m1, d1, latitude, longitude, tzHours);
    if (!a.ok) return a;
    var b = calculate(y2, m2, d2, latitude, longitude, tzHours);
    if (!b.ok) return b;
    return {
      ok: true,
      sunriseDiffMinutes: a.sunriseMinutes === null || b.sunriseMinutes === null
        ? null : Math.round((b.sunriseMinutes - a.sunriseMinutes) * 10) / 10,
      sunsetDiffMinutes: a.sunsetMinutes === null || b.sunsetMinutes === null
        ? null : Math.round((b.sunsetMinutes - a.sunsetMinutes) * 10) / 10,
      dayLengthDiffMinutes: Math.round((b.dayLengthMinutes - a.dayLengthMinutes) * 10) / 10
    };
  }

  var api = {
    calculate: calculate,
    compare: compare,
    julianDay: julianDay
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.HinodeCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
