/*
 * 二十四節気・雑節の計算ロジック
 *
 * 根拠(一次情報):
 * - 国立天文台 暦計算室「暦要項(二十四節気および雑節)」 https://eco.mtk.nao.ac.jp/koyomi/yoko/
 *   (2026年7月29日参照。2021〜2027年の暦要項の値を実装の検証に使用)
 * - 国立天文台 暦計算室「暦Wiki: 二十四節気」 https://eco.mtk.nao.ac.jp/koyomi/wiki/
 *
 * 前提:
 * - 定気法。太陽の「視黄経」が15度の倍数になる瞬間をその節気の時刻とし、
 *   日本標準時(JST = UTC+9)での日付を節気の日とする。
 * - 太陽位置は Jean Meeus "Astronomical Algorithms" 2nd ed. の
 *   VSOP87(切り詰め版・付録III)+ FK5補正 + 章動 + 光行差で計算する。
 *   視黄経の誤差はおよそ1秒角以下(時間にして約25秒)。
 * - ΔT(TT-UT1)は NASA/Espenak-Meeus の多項式近似を使う。ΔTの誤差は
 *   数十秒程度で、日付が変わるのは節気の瞬間が0時前後の場合だけ。
 * - 雑節の定義(国立天文台 暦要項に準拠):
 *     節分   = 立春の前日
 *     彼岸   = 春分・秋分を中日とする7日間(暦要項が載せるのは「入り」= 中日の3日前)
 *     社日   は本ツールでは扱わない
 *     土用   = 太陽の視黄経が 27度(春)/117度(夏)/207度(秋)/297度(冬)になる日(土用入り)
 *     八十八夜 = 立春の日を1日目として88日目
 *     二百十日 = 立春の日を1日目として210日目
 *     二百二十日 = 立春の日を1日目として220日目(暦要項には掲載がない伝統的な雑節)
 *     入梅   = 太陽の視黄経が80度になる日
 *     半夏生 = 太陽の視黄経が100度になる日
 * - 対象年は1900〜2100年。範囲外は精度を保証できないためエラーにする。
 */
(function (global) {
  "use strict";

  var YEAR_MIN = 1900;
  var YEAR_MAX = 2100;

  var DEG = Math.PI / 180;

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  // ---- VSOP87(切り詰め版) 地球の日心黄経L・黄緯B・動径R ------------------
  // Meeus "Astronomical Algorithms" 2nd ed. 付録III の係数
  // 各項は [A, B, C] で A*cos(B + C*tau) (tauはユリウス千年)
  var EARTH_L = [
    [[175347046, 0, 0], [3341656, 4.6692568, 6283.07585], [34894, 4.6261, 12566.1517],
     [3497, 2.7441, 5753.3849], [3418, 2.8289, 3.5231], [3136, 3.6277, 77713.7715],
     [2676, 4.4181, 7860.4194], [2343, 6.1352, 3930.2097], [1324, 0.7425, 11506.7698],
     [1273, 2.0371, 529.691], [1199, 1.1096, 1577.3435], [990, 5.233, 5884.927],
     [902, 2.045, 26.298], [857, 3.508, 398.149], [780, 1.179, 5223.694],
     [753, 2.533, 5507.553], [505, 4.583, 18849.228], [492, 4.205, 775.523],
     [357, 2.92, 0.067], [317, 5.849, 11790.629], [284, 1.899, 796.298],
     [271, 0.315, 10977.079], [243, 0.345, 5486.778], [206, 4.806, 2544.314],
     [205, 1.869, 5573.143], [202, 2.458, 6069.777], [156, 0.833, 213.299],
     [132, 3.411, 2942.463], [126, 1.083, 20.775], [115, 0.645, 0.98],
     [103, 0.636, 4694.003], [102, 0.976, 15720.839], [102, 4.267, 7.114],
     [99, 6.21, 2146.17], [98, 0.68, 155.42], [86, 5.98, 161000.69],
     [85, 1.3, 6275.96], [85, 3.67, 71430.7], [80, 1.81, 17260.15],
     [79, 3.04, 12036.46], [75, 1.76, 5088.63], [74, 3.5, 3154.69],
     [74, 4.68, 801.82], [70, 0.83, 9437.76], [62, 3.98, 8827.39],
     [61, 1.82, 7084.9], [57, 2.78, 6286.6], [56, 4.39, 14143.5],
     [56, 3.47, 6279.55], [52, 0.19, 12139.55], [52, 1.33, 1748.02],
     [51, 0.28, 5856.48], [49, 0.49, 1194.45], [41, 5.37, 8429.24],
     [41, 2.4, 19651.05], [39, 6.17, 10447.39], [37, 6.04, 10213.29],
     [37, 2.57, 1059.38], [36, 1.71, 2352.87], [36, 1.78, 6812.77],
     [33, 0.59, 17789.85], [30, 0.44, 83996.85], [30, 2.74, 1349.87],
     [25, 3.16, 4690.48]],
    [[628331966747, 0, 0], [206059, 2.678235, 6283.07585], [4303, 2.6351, 12566.1517],
     [425, 1.59, 3.523], [119, 5.796, 26.298], [109, 2.966, 1577.344],
     [93, 2.59, 18849.23], [72, 1.14, 529.69], [68, 1.87, 398.15],
     [67, 4.41, 5507.55], [59, 2.89, 5223.69], [56, 2.17, 155.42],
     [45, 0.4, 796.3], [36, 0.47, 775.52], [29, 2.65, 7.11],
     [21, 5.34, 0.98], [19, 1.85, 5486.78], [19, 4.97, 213.3],
     [17, 2.99, 6275.96], [16, 0.03, 2544.31], [16, 1.43, 2146.17],
     [15, 1.21, 10977.08], [12, 2.83, 1748.02], [12, 3.26, 5088.63],
     [12, 5.27, 1194.45], [12, 2.08, 4694], [11, 0.77, 553.57],
     [10, 1.3, 6286.6], [10, 4.24, 1349.87], [9, 2.7, 242.73],
     [9, 5.64, 951.72], [8, 5.3, 2352.87], [6, 2.65, 9437.76],
     [6, 4.67, 4690.48]],
    [[52919, 0, 0], [8720, 1.0721, 6283.0758], [309, 0.867, 12566.152],
     [27, 0.05, 3.52], [16, 5.19, 26.3], [16, 3.68, 155.42],
     [10, 0.76, 18849.23], [9, 2.06, 77713.77], [7, 0.83, 775.52],
     [5, 4.66, 1577.34], [4, 1.03, 7.11], [4, 3.44, 5573.14],
     [3, 5.14, 796.3], [3, 6.05, 5507.55], [3, 1.19, 242.73],
     [3, 6.12, 529.69], [3, 0.31, 398.15], [3, 2.28, 553.57],
     [2, 4.38, 5223.69], [2, 3.75, 0.98]],
    [[289, 5.844, 6283.076], [35, 0, 0], [17, 5.49, 12566.15],
     [3, 5.2, 155.42], [1, 4.72, 3.52], [1, 5.3, 18849.23], [1, 5.97, 242.73]],
    [[114, 3.142, 0], [8, 4.13, 6283.08], [1, 3.84, 12566.15]],
    [[1, 3.14, 0]]
  ];

  var EARTH_B = [
    [[280, 3.199, 84334.662], [102, 5.422, 5507.553], [80, 3.88, 5223.69],
     [44, 3.7, 2352.87], [32, 4, 1577.34]],
    [[9, 3.9, 5507.55], [6, 1.73, 5223.69]]
  ];

  var EARTH_R = [
    [[100013989, 0, 0], [1670700, 3.0984635, 6283.07585], [13956, 3.05525, 12566.1517],
     [3084, 5.1985, 77713.7715], [1628, 1.1739, 5753.3849], [1576, 2.8469, 7860.4194],
     [925, 5.453, 11506.77], [542, 4.564, 3930.21], [472, 3.661, 5884.927],
     [346, 0.964, 5507.553], [329, 5.9, 5223.694], [307, 0.299, 5573.143],
     [243, 4.273, 11790.629], [212, 5.847, 1577.344], [186, 5.022, 10977.079],
     [175, 3.012, 18849.228], [110, 5.055, 5486.778], [98, 0.89, 6069.78],
     [86, 5.69, 15720.84], [86, 1.27, 161000.69], [65, 0.27, 17260.15],
     [63, 0.92, 529.69], [57, 2.01, 83996.85], [56, 5.24, 71430.7],
     [49, 3.25, 2544.31], [47, 2.58, 775.52], [45, 5.54, 9437.76],
     [43, 6.01, 6275.96], [39, 5.36, 4694], [38, 2.39, 8827.39],
     [37, 0.83, 19651.05], [37, 4.9, 12139.55], [36, 1.67, 12036.46],
     [35, 1.84, 2942.46], [33, 0.24, 7084.9], [32, 0.18, 5088.63],
     [32, 1.78, 398.15], [28, 1.21, 6286.6], [28, 1.9, 6279.55],
     [26, 4.59, 10447.39]],
    [[103019, 1.10749, 6283.07585], [1721, 1.0644, 12566.1517], [702, 3.142, 0],
     [32, 1.02, 18849.23], [31, 2.84, 5507.55], [25, 1.32, 5223.69],
     [18, 1.42, 1577.34], [10, 5.91, 10977.08], [9, 1.42, 6275.96],
     [9, 0.27, 5486.78]],
    [[4359, 5.7846, 6283.0758], [124, 5.579, 12566.152], [12, 3.14, 0],
     [9, 3.63, 77713.77], [6, 1.87, 5573.14], [3, 5.47, 18849.23]],
    [[145, 4.273, 6283.076], [7, 3.92, 12566.15]],
    [[4, 2.56, 6283.08]]
  ];

  function vsopSum(series, tau) {
    var total = 0;
    for (var i = series.length - 1; i >= 0; i--) {
      var s = 0;
      var terms = series[i];
      for (var j = 0; j < terms.length; j++) {
        s += terms[j][0] * Math.cos(terms[j][1] + terms[j][2] * tau);
      }
      total = total * tau + s;
    }
    return total / 1e8;
  }

  function norm360(x) {
    var v = x % 360;
    return v < 0 ? v + 360 : v;
  }

  /**
   * 指定した力学時(TT)のユリウス日における太陽の視黄経を求める。
   * @param {number} jde 力学時(TT)によるユリウス日
   * @returns {number} 太陽の視黄経(度、0〜360)
   */
  function apparentSolarLongitude(jde) {
    var tau = (jde - 2451545.0) / 365250.0;
    var L = vsopSum(EARTH_L, tau);   // 地球の日心黄経(ラジアン)
    var B = vsopSum(EARTH_B, tau);   // 地球の日心黄緯(ラジアン)
    var R = vsopSum(EARTH_R, tau);   // 動径(天文単位)

    // 地心から見た太陽 = 日心から見た地球の反対側
    var theta = norm360(L / DEG + 180);
    var beta = -B / DEG;

    // VSOP87(FK5でない基準系)→FK5への補正(Meeus 25章)
    var T = tau * 10;
    var lambdaP = (theta - 1.397 * T - 0.00031 * T * T) * DEG;
    theta += -0.09033 / 3600;
    beta += (0.03916 / 3600) * (Math.cos(lambdaP) - Math.sin(lambdaP));

    // 章動(黄経章動 Δψ、Meeus 22章の簡易式・精度約0.5秒角)
    var omega = (125.04452 - 1934.136261 * T) * DEG;
    var lSun = (280.4665 + 36000.7698 * T) * DEG;
    var lMoon = (218.3165 + 481267.8813 * T) * DEG;
    var dPsi = (-17.20 * Math.sin(omega) - 1.32 * Math.sin(2 * lSun) -
                0.23 * Math.sin(2 * lMoon) + 0.21 * Math.sin(2 * omega)) / 3600;

    // 光行差(Meeus 25章の簡易式)
    var aberration = -20.4898 / 3600 / R;

    return norm360(theta + dPsi + aberration);
  }

  // 2000〜2030年の実測・予測ΔT(秒)。5年刻みで線形補間する。
  // 出典: IERS/USNO が公表する ΔT の実測値(2000〜2025)と、その後の横ばい予測。
  var DT_TABLE = [
    [2000, 63.83], [2005, 64.69], [2010, 66.07], [2015, 67.64],
    [2020, 69.36], [2025, 69.19], [2030, 69.2]
  ];

  /**
   * ΔT(TT - UT1)の近似値。
   * 2000〜2030年は実測値の表を線形補間し、それ以外は NASA/Espenak-Meeus の多項式近似を使う。
   * @param {number} year 西暦年(小数可)
   * @returns {number} ΔT(秒)
   */
  function deltaT(year) {
    var t, u, i;
    if (year >= 2000 && year <= 2030) {
      for (i = 0; i < DT_TABLE.length - 1; i++) {
        if (year <= DT_TABLE[i + 1][0]) {
          var y0 = DT_TABLE[i][0], d0 = DT_TABLE[i][1];
          var y1 = DT_TABLE[i + 1][0], d1 = DT_TABLE[i + 1][1];
          return d0 + (d1 - d0) * (year - y0) / (y1 - y0);
        }
      }
    }
    if (year >= 2005 && year < 2050) {
      t = year - 2000;
      return 62.92 + 0.32217 * t + 0.005589 * t * t;
    }
    if (year >= 1986 && year < 2005) {
      t = year - 2000;
      return 63.86 + 0.3345 * t - 0.060374 * t * t + 0.0017275 * t * t * t +
        0.000651814 * t * t * t * t + 0.00002373599 * t * t * t * t * t;
    }
    if (year >= 1961 && year < 1986) {
      t = year - 1975;
      return 45.45 + 1.067 * t - t * t / 260 - t * t * t / 718;
    }
    if (year >= 1941 && year < 1961) {
      t = year - 1950;
      return 29.07 + 0.407 * t - t * t / 233 + t * t * t / 2547;
    }
    if (year >= 1920 && year < 1941) {
      t = year - 1920;
      return 21.20 + 0.84493 * t - 0.076100 * t * t + 0.0020936 * t * t * t;
    }
    if (year >= 1900 && year < 1920) {
      t = year - 1900;
      return -2.79 + 1.494119 * t - 0.0598939 * t * t + 0.0061966 * t * t * t -
        0.000197 * t * t * t * t;
    }
    if (year >= 2050 && year < 2150) {
      u = (year - 1820) / 100;
      return -20 + 32 * u * u - 0.5628 * (2150 - year);
    }
    u = (year - 1820) / 100;
    return -20 + 32 * u * u;
  }

  // ---- ユリウス日 ⇔ 暦日(グレゴリオ暦) ---------------------------------
  function gregorianToJd(y, m, d) {
    if (m <= 2) { y -= 1; m += 12; }
    var a = Math.floor(y / 100);
    var b = 2 - a + Math.floor(a / 4);
    return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + b - 1524.5;
  }

  function jdToGregorian(jd) {
    var z = Math.floor(jd + 0.5);
    var f = jd + 0.5 - z;
    var a = z;
    if (z >= 2299161) {
      var alpha = Math.floor((z - 1867216.25) / 36524.25);
      a = z + 1 + alpha - Math.floor(alpha / 4);
    }
    var b = a + 1524;
    var c = Math.floor((b - 122.1) / 365.25);
    var d = Math.floor(365.25 * c);
    var e = Math.floor((b - d) / 30.6001);
    var day = b - d - Math.floor(30.6001 * e) + f;
    var month = e < 14 ? e - 1 : e - 13;
    var year = month > 2 ? c - 4716 : c - 4715;
    var dayInt = Math.floor(day);
    var frac = day - dayInt;
    var totalMin = Math.round(frac * 1440);
    var hour = Math.floor(totalMin / 60);
    var minute = totalMin % 60;
    if (hour >= 24) { hour -= 24; dayInt += 1; }
    return { year: year, month: month, day: dayInt, hour: hour, minute: minute };
  }

  /**
   * 太陽の視黄経が指定の角度になる瞬間を求める(定気法)。
   * @param {number} targetDeg 目標の視黄経(度、0〜360未満)
   * @param {number} guessJde 探索の初期値(TTのユリウス日)
   * @returns {number} その瞬間のTTによるユリウス日
   */
  function solveLongitude(targetDeg, guessJde) {
    var jde = guessJde;
    for (var i = 0; i < 30; i++) {
      var diff = apparentSolarLongitude(jde) - targetDeg;
      // -180〜180に正規化(0度=360度の折り返しを吸収)
      diff = ((diff + 180) % 360 + 360) % 360 - 180;
      // 太陽は1日あたり約0.9856度進む
      var step = -diff / 0.9856473;
      jde += step;
      if (Math.abs(step) < 1e-9) break;
    }
    return jde;
  }

  // 節気のTTユリウス日 → 日本標準時(JST)の年月日時分
  function ttJdToJst(jde, approxYear) {
    var jdUt = jde - deltaT(approxYear) / 86400;
    return jdToGregorian(jdUt + 9 / 24);
  }

  var SEKKI_NAMES = [
    "春分", "清明", "穀雨", "立夏", "小満", "芒種",
    "夏至", "小暑", "大暑", "立秋", "処暑", "白露",
    "秋分", "寒露", "霜降", "立冬", "小雪", "大雪",
    "冬至", "小寒", "大寒", "立春", "雨水", "啓蟄"
  ];
  var SEKKI_SEASON = [
    "春", "春", "春", "夏", "夏", "夏",
    "夏", "夏", "夏", "秋", "秋", "秋",
    "秋", "秋", "秋", "冬", "冬", "冬",
    "冬", "冬", "冬", "春", "春", "春"
  ];

  /**
   * 太陽の視黄経が指定角度になる日時(JST)を求める。
   * @param {number} year 西暦年(1900〜2100) 探索の中心に使う年
   * @param {number} lonDeg 目標の視黄経(度、0以上360未満)
   * @returns {{ok:true, year:number, month:number, day:number, hour:number, minute:number,
   *            longitude:number, iso:string}|{ok:false, code:"invalid_year"|"invalid_longitude"}}
   *   isoは "YYYY-MM-DD" 形式の日付文字列(JST)
   */
  function solarTermAt(year, lonDeg) {
    if (!isFiniteNumber(year) || year !== Math.floor(year) || year < YEAR_MIN || year > YEAR_MAX) {
      return { ok: false, code: "invalid_year" };
    }
    if (!isFiniteNumber(lonDeg) || lonDeg < 0 || lonDeg >= 360) {
      return { ok: false, code: "invalid_longitude" };
    }
    // 春分(黄経0度)がおよそ3月20日。そこから黄経1度あたり約1.0146日で初期値を作る。
    // 黄経が大きい(冬側の)角度は前年の春分を起点にすると当年の1〜2月に入るため、
    // 起点の年を前後させて「その暦年に入る解」を選ぶ。
    var g = null;
    var bases = [year, year - 1, year + 1];
    for (var bi = 0; bi < bases.length; bi++) {
      var guess = gregorianToJd(bases[bi], 3, 20.5) + lonDeg * 1.01461;
      var cand = ttJdToJst(solveLongitude(lonDeg, guess), bases[bi]);
      if (bi === 0) g = cand;
      if (cand.year === year) { g = cand; break; }
    }
    return {
      ok: true,
      year: g.year, month: g.month, day: g.day, hour: g.hour, minute: g.minute,
      longitude: lonDeg,
      iso: pad4(g.year) + "-" + pad2(g.month) + "-" + pad2(g.day)
    };
  }

  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function pad4(n) { return ("000" + n).slice(-4); }

  /**
   * その年の二十四節気をすべて求める(1月1日〜12月31日、JST)。
   * @param {number} year 西暦年(1900〜2100)
   * @returns {{ok:true, year:number, terms:Array<{name:string, season:string, longitude:number,
   *            month:number, day:number, hour:number, minute:number, iso:string}>}
   *          |{ok:false, code:"invalid_year"}}
   *   termsは日付の昇順。24件返る。
   */
  function sekkiOfYear(year) {
    if (!isFiniteNumber(year) || year !== Math.floor(year) || year < YEAR_MIN || year > YEAR_MAX) {
      return { ok: false, code: "invalid_year" };
    }
    var terms = [];
    // 前年の冬至(270度)付近から翌年頭までを走査し、その年に入るものだけ採用する
    for (var k = -6; k < 30; k++) {
      var lon = norm360(k * 15);
      var baseYear = k < 0 ? year - 1 : (k >= 24 ? year + 1 : year);
      var guess = gregorianToJd(baseYear, 3, 20.5) + lon * 1.01461;
      var jde = solveLongitude(lon, guess);
      var g = ttJdToJst(jde, baseYear);
      if (g.year !== year) continue;
      var idx = ((lon / 15) % 24 + 24) % 24;
      terms.push({
        name: SEKKI_NAMES[idx], season: SEKKI_SEASON[idx], longitude: lon,
        month: g.month, day: g.day, hour: g.hour, minute: g.minute,
        iso: pad4(g.year) + "-" + pad2(g.month) + "-" + pad2(g.day)
      });
    }
    terms.sort(function (a, b) { return a.iso < b.iso ? -1 : (a.iso > b.iso ? 1 : 0); });
    return { ok: true, year: year, terms: terms };
  }

  function addDays(iso, n) {
    var p = iso.split("-");
    var jd = gregorianToJd(parseInt(p[0], 10), parseInt(p[1], 10), parseInt(p[2], 10) + 0.5);
    var g = jdToGregorian(jd + n);
    return pad4(g.year) + "-" + pad2(g.month) + "-" + pad2(g.day);
  }

  function findTerm(terms, name) {
    for (var i = 0; i < terms.length; i++) {
      if (terms[i].name === name) return terms[i];
    }
    return null;
  }

  /**
   * その年の雑節を求める(JST)。
   * @param {number} year 西暦年(1900〜2100)
   * @returns {{ok:true, year:number, items:Array<{name:string, iso:string, month:number,
   *            day:number, note:string}>}|{ok:false, code:"invalid_year"}}
   *   itemsは日付の昇順。noteは定義の説明(日本語ではなく定義の識別子)。
   */
  function zassetsuOfYear(year) {
    var s = sekkiOfYear(year);
    if (!s.ok) return s;
    var terms = s.terms;
    var items = [];

    function push(name, iso, note, hour, minute) {
      var p = iso.split("-");
      var item = {
        name: name, iso: iso,
        month: parseInt(p[1], 10), day: parseInt(p[2], 10), note: note
      };
      if (hour !== undefined) { item.hour = hour; item.minute = minute; }
      items.push(item);
    }

    // 太陽の視黄経で決まる雑節(土用入り・入梅・半夏生)
    var byLongitude = [
      [297, "冬土用入り"], [27, "春土用入り"], [80, "入梅"],
      [100, "半夏生"], [117, "夏土用入り"], [207, "秋土用入り"]
    ];
    for (var i = 0; i < byLongitude.length; i++) {
      var r = solarTermAt(year, byLongitude[i][0]);
      if (r.ok && r.year === year) {
        push(byLongitude[i][1], r.iso, "longitude" + byLongitude[i][0], r.hour, r.minute);
      }
    }

    // 立春を基準にするもの
    var risshun = findTerm(terms, "立春");
    if (risshun) {
      push("節分", addDays(risshun.iso, -1), "risshun-1");
      push("八十八夜", addDays(risshun.iso, 87), "risshun+87");
      push("二百十日", addDays(risshun.iso, 209), "risshun+209");
      push("二百二十日", addDays(risshun.iso, 219), "risshun+219");
    }
    // 彼岸(春分・秋分の3日前が入り、中日は春分・秋分そのもの)
    var shunbun = findTerm(terms, "春分");
    if (shunbun) {
      push("春彼岸入り", addDays(shunbun.iso, -3), "shunbun-3");
      push("春彼岸明け", addDays(shunbun.iso, 3), "shunbun+3");
    }
    var shubun = findTerm(terms, "秋分");
    if (shubun) {
      push("秋彼岸入り", addDays(shubun.iso, -3), "shubun-3");
      push("秋彼岸明け", addDays(shubun.iso, 3), "shubun+3");
    }

    items.sort(function (a, b) { return a.iso < b.iso ? -1 : (a.iso > b.iso ? 1 : 0); });
    return { ok: true, year: year, items: items };
  }

  /**
   * 二十四節気と雑節をまとめて返す。
   * @param {number} year 西暦年(1900〜2100)
   * @returns {{ok:true, year:number, terms:Array, items:Array}|{ok:false, code:"invalid_year"}}
   */
  function all(year) {
    var s = sekkiOfYear(year);
    if (!s.ok) return s;
    var z = zassetsuOfYear(year);
    return { ok: true, year: year, terms: s.terms, items: z.items };
  }

  /**
   * 指定した節気の日付を1件だけ取り出す。
   * @param {number} year 西暦年(1900〜2100)
   * @param {string} name 節気名(例: "立春" "夏至")
   * @returns {{ok:true, name:string, iso:string, month:number, day:number,
   *            hour:number, minute:number}|{ok:false, code:"invalid_year"|"invalid_name"|"not_found"}}
   */
  function sekkiByName(year, name) {
    var s = sekkiOfYear(year);
    if (!s.ok) return s;
    if (typeof name !== "string" || SEKKI_NAMES.indexOf(name) === -1) {
      return { ok: false, code: "invalid_name" };
    }
    var t = findTerm(s.terms, name);
    if (!t) return { ok: false, code: "not_found" };
    return {
      ok: true, name: t.name, iso: t.iso, month: t.month, day: t.day,
      hour: t.hour, minute: t.minute
    };
  }

  /**
   * 指定した雑節の日付を1件だけ取り出す。
   * @param {number} year 西暦年(1900〜2100)
   * @param {string} name 雑節名(例: "節分" "八十八夜" "冬土用入り" "春彼岸入り")
   * @returns {{ok:true, name:string, iso:string, month:number, day:number}
   *          |{ok:false, code:"invalid_year"|"not_found"}}
   */
  function zassetsuByName(year, name) {
    var z = zassetsuOfYear(year);
    if (!z.ok) return z;
    for (var i = 0; i < z.items.length; i++) {
      if (z.items[i].name === name) {
        var it = z.items[i];
        var out = { ok: true, name: it.name, iso: it.iso, month: it.month, day: it.day };
        if (it.hour !== undefined) { out.hour = it.hour; out.minute = it.minute; }
        return out;
      }
    }
    return { ok: false, code: "not_found" };
  }

  var api = {
    solarTermAt: solarTermAt,
    zassetsuByName: zassetsuByName,
    sekkiOfYear: sekkiOfYear,
    zassetsuOfYear: zassetsuOfYear,
    sekkiByName: sekkiByName,
    all: all,
    apparentSolarLongitude: apparentSolarLongitude,
    deltaT: deltaT,
    SEKKI_NAMES: SEKKI_NAMES,
    YEAR_MIN: YEAR_MIN,
    YEAR_MAX: YEAR_MAX
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.SekkiCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
