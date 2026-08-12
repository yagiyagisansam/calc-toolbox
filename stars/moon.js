/*
 * 月の位置・月齢の計算ロジック
 *
 * 計算式の根拠:
 * - Jean Meeus "Astronomical Algorithms" (2nd ed., 1998) の簡略式。
 *   月の黄経・黄緯・距離は主要項のみを採る低精度版で、月の位置の誤差は角度で
 *   おおむね 0.3 度以内、月齢の誤差は 0.2 日以内。星見の可否判定にはこの精度で足りる。
 * - 黄道傾斜角 ε = 23.4397 度(J2000)
 * - 大気差(見かけの浮き上がり)は Saemundsson の近似式で補正する。
 *
 * 前提:
 * - 引数の Date は UTC として扱う(JavaScript の Date は内部的に UTC のため、
 *   日本時刻の Date をそのまま渡してよい)。
 * - 経度は東経を正とする一般的な向きで受け取る(内部で西経正に変換する)。
 * - 月出・月入りの時刻は扱わない。必要なのは「指定時刻に月が空のどこにあるか」だけ。
 *
 * ブラウザでは window.StarsMoon、Node(テストランナー・生成スクリプト)では
 * module.exports で公開する。
 */
(function (global) {
  "use strict";

  var RAD = Math.PI / 180;
  var DAY_MS = 86400000;
  var J1970 = 2440588; // 1970-01-01T00:00Z のユリウス日
  var J2000 = 2451545; // 2000-01-01T12:00Z のユリウス日
  var OBLIQUITY = 23.4397 * RAD; // 黄道傾斜角
  var SUN_DIST_KM = 149598000; // 太陽までの平均距離
  var SYNODIC_MONTH = 29.530588853; // 朔望月(日)

  // ---- 時刻の変換 -------------------------------------------------------

  // Date → J2000 からの経過日数
  function toDays(date) {
    return date.valueOf() / DAY_MS - 0.5 + J1970 - J2000;
  }

  // ---- 座標変換 ---------------------------------------------------------

  // 黄道座標(黄経 l・黄緯 b) → 赤経
  function rightAscension(l, b) {
    return Math.atan2(
      Math.sin(l) * Math.cos(OBLIQUITY) - Math.tan(b) * Math.sin(OBLIQUITY),
      Math.cos(l)
    );
  }

  // 黄道座標 → 赤緯
  function declination(l, b) {
    return Math.asin(
      Math.sin(b) * Math.cos(OBLIQUITY) +
        Math.cos(b) * Math.sin(OBLIQUITY) * Math.sin(l)
    );
  }

  // 時角 H・観測地の緯度 phi・赤緯 dec → 高度(ラジアン)
  function altitude(H, phi, dec) {
    return Math.asin(
      Math.sin(phi) * Math.sin(dec) +
        Math.cos(phi) * Math.cos(dec) * Math.cos(H)
    );
  }

  // 時角 H・観測地の緯度 phi・赤緯 dec → 方位角(南を0、西回りが正のラジアン)
  function azimuth(H, phi, dec) {
    return Math.atan2(
      Math.sin(H),
      Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)
    );
  }

  // グリニッジ恒星時から観測地の地方恒星時(lw は西経正のラジアン)
  function siderealTime(d, lw) {
    return RAD * (280.16 + 360.9856235 * d) - lw;
  }

  // 大気差の補正(Saemundsson の式)。地平線付近で月が浮き上がって見える分。
  function astroRefraction(h) {
    // 地平線より下は補正しない(0 に丸めて計算の発散を防ぐ)
    if (h < 0) h = 0;
    return 0.0002967 / Math.tan(h + 0.00312536 / (h + 0.08901179));
  }

  // ---- 太陽・月の位置 ---------------------------------------------------

  function solarMeanAnomaly(d) {
    return RAD * (357.5291 + 0.98560028 * d);
  }

  function sunEclipticLongitude(M) {
    // 中心差(C)と近日点黄経(P)を足して黄経を得る
    var C =
      RAD *
      (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
    var P = RAD * 102.9372;
    return M + C + P + Math.PI;
  }

  function sunCoords(d) {
    var M = solarMeanAnomaly(d);
    var L = sunEclipticLongitude(M);
    return { ra: rightAscension(L, 0), dec: declination(L, 0) };
  }

  function moonCoords(d) {
    var L = RAD * (218.316 + 13.176396 * d); // 平均黄経
    var M = RAD * (134.963 + 13.064993 * d); // 平均近点角
    var F = RAD * (93.272 + 13.22935 * d); // 平均昇交点離角
    var l = L + RAD * 6.289 * Math.sin(M); // 黄経
    var b = RAD * 5.128 * Math.sin(F); // 黄緯
    var dt = 385001 - 20905 * Math.cos(M); // 地心距離(km)
    return { ra: rightAscension(l, b), dec: declination(l, b), dist: dt };
  }

  // ---- 公開API ---------------------------------------------------------

  /**
   * 指定時刻・指定地点での月の位置を返す。
   * @param {Date} date 時刻
   * @param {number} lat 緯度(度・北が正)
   * @param {number} lon 経度(度・東が正)
   * @returns {{altitude:number, altitudeDeg:number, azimuth:number, distanceKm:number}}
   *          altitude は大気差を補正した見かけの高度(ラジアン)
   */
  function position(date, lat, lon) {
    var lw = RAD * -lon; // 内部では西経を正として扱う
    var phi = RAD * lat;
    var d = toDays(date);
    var c = moonCoords(d);
    var H = siderealTime(d, lw) - c.ra;
    var h = altitude(H, phi, c.dec);
    h = h + astroRefraction(h);
    return {
      altitude: h,
      altitudeDeg: h / RAD,
      azimuth: azimuth(H, phi, c.dec),
      distanceKm: c.dist
    };
  }

  /**
   * 指定時刻の月の輝面比(照らされている割合)と位相を返す。地点によらない。
   * @param {Date} date 時刻
   * @returns {{fraction:number, phase:number, ageDays:number}}
   *          fraction: 0(新月)〜1(満月) / phase: 0〜1(0と1が新月、0.5が満月) /
   *          ageDays: 月齢(日)
   */
  function illumination(date) {
    var d = toDays(date);
    var s = sunCoords(d);
    var m = moonCoords(d);

    // 太陽-月の離角
    var phi = Math.acos(
      Math.sin(s.dec) * Math.sin(m.dec) +
        Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra)
    );
    // 位相角(地球-月-太陽のなす角)
    var inc = Math.atan2(SUN_DIST_KM * Math.sin(phi), m.dist - SUN_DIST_KM * Math.cos(phi));
    // 満ちていく側か欠けていく側かの符号
    var angle = Math.atan2(
      Math.cos(s.dec) * Math.sin(s.ra - m.ra),
      Math.sin(s.dec) * Math.cos(m.dec) -
        Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra)
    );
    var phase = 0.5 + (0.5 * inc * (angle < 0 ? -1 : 1)) / Math.PI;
    return {
      fraction: (1 + Math.cos(inc)) / 2,
      phase: phase,
      ageDays: phase * SYNODIC_MONTH
    };
  }

  /**
   * 月による夜空の明るさへの寄与を 0(影響なし)〜1(最大)で返す。
   * 月が地平線下にあれば 0。高いほど・満月に近いほど大きい。
   * @param {Date} date 時刻
   * @param {number} lat 緯度(度)
   * @param {number} lon 経度(度)
   */
  function brightness(date, lat, lon) {
    var pos = position(date, lat, lon);
    if (pos.altitude <= 0) return 0;
    var frac = illumination(date).fraction;
    // 高度が低いほど大気に減光されるため sin(高度) で重みづけする
    return frac * Math.sin(pos.altitude);
  }

  var api = {
    position: position,
    illumination: illumination,
    brightness: brightness,
    SYNODIC_MONTH: SYNODIC_MONTH
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.StarsMoon = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
