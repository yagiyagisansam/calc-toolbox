/*
 * 空の計算(太陽と月の位置・月齢)
 *
 * 星見の判断に必要なのは「いつ空が暗くなるか(太陽)」と
 * 「月がどれだけ空を明るくするか(月)」の2つ。月の満ち欠けは太陽との
 * 位置関係で決まるので、どちらもこのモジュールにまとめてある。
 *
 * 計算式の根拠:
 * - Jean Meeus "Astronomical Algorithms" (2nd ed., 1998)。
 *   月の位置は第47章の周期項を全部使う(表は stars/moon-terms.js)。
 *   さらに観測地点から見た向き(地心視差の補正)まで行う。
 *   月は近いので、視差を無視すると地平線付近で約1度ずれる。
 *   朔の時刻は第49章。月齢はそこからの経過時間として求める。
 *
 *   以前は主要項1つだけの簡略版で、視差の補正も無かった。
 *   JPL Horizons と135点で比べると平均1.55度・最大2.52度ずれており、
 *   「0.3度以内」と書いていた注記は誤りだった(2026-08-14 の独立検証で判明)。
 *   期待値を自分の実装で作っていたためテストでは気づけなかった。
 *   いまは scripts/stars/fixtures/moon-horizons.json(JPL の値)と突き合わせている。
 * - 黄道傾斜角 ε = 23.4397 度(J2000)
 * - 大気差(見かけの浮き上がり)は Saemundsson の近似式で補正する。
 *
 * 前提:
 * - 引数の Date は UTC として扱う(JavaScript の Date は内部的に UTC のため、
 *   日本時刻の Date をそのまま渡してよい)。
 * - 経度は東経を正とする一般的な向きで受け取る(内部で西経正に変換する)。
 * - 月の出入りは粗い走査で区間を挟んでから二分法で1分未満まで詰める。
 *   境目の定義は国立天文台と同じ「月の上端が地平線に接する(大気差込み)」。
 *
 * ブラウザでは window.StarsSky、Node(テストランナー・生成スクリプト)では
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

  // 月の周期項の表(stars/moon-terms.js)。ブラウザでは先に読み込んでおくこと。
  var MoonTerms =
    (typeof module !== "undefined" && module.exports)
      ? require("./moon-terms.js")
      : global.StarsMoonTerms;

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

  /*
   * 月の地心位置(Meeus 第47章)。
   * 周期項の表は stars/moon-terms.js に丸ごと置いてある。
   * 返すのは見かけの黄経・黄緯(章動を含む)と地心距離。
   */
  function moonEcliptic(T) {
    var terms = MoonTerms;

    // 平均要素(度)
    var Lp = norm360(218.3164477 + 481267.88123421 * T - 0.0015786 * T * T
      + T * T * T / 538841 - T * T * T * T / 65194000);
    var D = norm360(297.8501921 + 445267.1114034 * T - 0.0018819 * T * T
      + T * T * T / 545868 - T * T * T * T / 113065000);
    var M = norm360(357.5291092 + 35999.0502909 * T - 0.0001536 * T * T
      + T * T * T / 24490000);
    var Mp = norm360(134.9633964 + 477198.8675055 * T + 0.0087414 * T * T
      + T * T * T / 69699 - T * T * T * T / 14712000);
    var F = norm360(93.2720950 + 483202.0175233 * T - 0.0036539 * T * T
      - T * T * T / 3526000 + T * T * T * T / 863310000);

    // 金星・木星などの影響をまとめた補正項
    var A1 = norm360(119.75 + 131.849 * T);
    var A2 = norm360(53.09 + 479264.290 * T);
    var A3 = norm360(313.45 + 481266.484 * T);

    // 地球の軌道離心率の変化。太陽の平均近点角を含む項に掛ける
    var E = 1 - 0.002516 * T - 0.0000074 * T * T;

    var sumL = 0;
    var sumR = 0;
    var sumB = 0;

    function ePow(mCoef) {
      var a = Math.abs(mCoef);
      return a === 1 ? E : a === 2 ? E * E : 1;
    }

    var i;
    for (i = 0; i < terms.LON_DIST.length; i++) {
      var t = terms.LON_DIST[i];
      var arg = RAD * (t[0] * D + t[1] * M + t[2] * Mp + t[3] * F);
      var e = ePow(t[1]);
      sumL += t[4] * e * Math.sin(arg);
      sumR += t[5] * e * Math.cos(arg);
    }
    for (i = 0; i < terms.LAT.length; i++) {
      var b = terms.LAT[i];
      var argB = RAD * (b[0] * D + b[1] * M + b[2] * Mp + b[3] * F);
      sumB += b[4] * ePow(b[1]) * Math.sin(argB);
    }

    // 表に入らない付加項
    sumL += 3958 * Math.sin(RAD * A1)
      + 1962 * Math.sin(RAD * (Lp - F))
      + 318 * Math.sin(RAD * A2);
    sumB += -2235 * Math.sin(RAD * Lp)
      + 382 * Math.sin(RAD * A3)
      + 175 * Math.sin(RAD * (A1 - F))
      + 175 * Math.sin(RAD * (A1 + F))
      + 127 * Math.sin(RAD * (Lp - Mp))
      - 115 * Math.sin(RAD * (Lp + Mp));

    var lambda = Lp + sumL / 1000000; // 黄経(度)
    var beta = sumB / 1000000; // 黄緯(度)
    var dist = 385000.56 + sumR / 1000; // 地心距離(km)

    var nut = nutation(T);
    return {
      lambda: lambda + nut.dPsi, // 見かけの黄経(章動込み)
      beta: beta,
      dist: dist,
      obliquity: nut.eps
    };
  }

  /*
   * 章動と真の黄道傾斜角(Meeus 第22章の簡略版)。
   * 主要項だけで 1秒角ほどの精度があり、この用途には充分。
   */
  function nutation(T) {
    var Om = RAD * (125.04452 - 1934.136261 * T);
    var Ls = RAD * (280.4665 + 36000.7698 * T);
    var Lm = RAD * (218.3165 + 481267.8813 * T);
    var dPsi = (-17.20 * Math.sin(Om) - 1.32 * Math.sin(2 * Ls)
      - 0.23 * Math.sin(2 * Lm) + 0.21 * Math.sin(2 * Om)) / 3600;
    var dEps = (9.20 * Math.cos(Om) + 0.57 * Math.cos(2 * Ls)
      + 0.10 * Math.cos(2 * Lm) - 0.09 * Math.cos(2 * Om)) / 3600;
    var eps0 = 23 + 26 / 60 + 21.448 / 3600
      - (46.8150 * T + 0.00059 * T * T - 0.001813 * T * T * T) / 3600;
    return { dPsi: dPsi, dEps: dEps, eps: RAD * (eps0 + dEps) };
  }

  function norm360(x) {
    var v = x % 360;
    return v < 0 ? v + 360 : v;
  }

  /*
   * 地球の自転と暦の時刻のずれ(ΔT = TT - UT)。
   * 月は1秒で約0.5秒角動くので、70秒のずれは約0.01度になる。
   * 2020年代はほぼ一定なので、その近似で足りる。
   */
  function deltaTSeconds(year) {
    return 69 + 0.35 * (year - 2020);
  }

  /* 章動を含むグリニッジ視恒星時(度) */
  function apparentSiderealTimeDeg(jd, T, nut) {
    var theta = 280.46061837 + 360.98564736629 * (jd - 2451545)
      + 0.000387933 * T * T - (T * T * T) / 38710000;
    return norm360(theta + nut.dPsi * Math.cos(nut.eps));
  }

  /*
   * 観測地点から見た月の位置(Meeus 第40章の視差補正まで行う)。
   *
   * 月までの距離は地球の半径の約60倍しかないので、地球の中心から見た向きと
   * 地表から見た向きは最大で約1度ちがう(地平視差)。地平線付近では
   * 月が出ているか沈んでいるかの判定が変わるので、必ず補正する。
   */
  function moonTopocentric(date, lat, lon) {
    var ms = date.valueOf();
    var year = new Date(ms).getUTCFullYear();
    // 位置の計算は力学時(TT)で行う
    var jdUt = ms / DAY_MS + 2440587.5;
    var jdTt = jdUt + deltaTSeconds(year) / 86400;
    var T = (jdTt - 2451545) / 36525;

    var moon = moonEcliptic(T);
    var nut = nutation(T);

    var lam = RAD * moon.lambda;
    var bet = RAD * moon.beta;
    var eps = moon.obliquity;

    // 黄道座標 → 赤道座標
    var ra = Math.atan2(
      Math.sin(lam) * Math.cos(eps) - Math.tan(bet) * Math.sin(eps),
      Math.cos(lam)
    );
    var dec = Math.asin(
      Math.sin(bet) * Math.cos(eps) + Math.cos(bet) * Math.sin(eps) * Math.sin(lam)
    );

    // 地平視差
    var sinPi = 6378.14 / moon.dist;

    // 観測地点の地心座標(地球の扁平を考慮)
    var phi = RAD * lat;
    var flattening = 1 / 298.257223563;
    var u = Math.atan((1 - flattening) * Math.tan(phi));
    var rhoSin = (1 - flattening) * Math.sin(u);
    var rhoCos = Math.cos(u);

    // 地方視恒星時から時角
    var gast = apparentSiderealTimeDeg(jdUt, T, nut);
    var H = RAD * norm360(gast + lon) - ra;

    // 地心 → 測心(観測地点から見た向き)への補正
    var dRa = Math.atan2(
      -rhoCos * sinPi * Math.sin(H),
      Math.cos(dec) - rhoCos * sinPi * Math.cos(H)
    );
    var decTopo = Math.atan2(
      (Math.sin(dec) - rhoSin * sinPi) * Math.cos(dRa),
      Math.cos(dec) - rhoCos * sinPi * Math.cos(H)
    );
    var Htopo = H - dRa;

    return {
      hourAngle: Htopo,
      dec: decTopo,
      dist: moon.dist,
      parallax: Math.asin(sinPi),
      phi: phi
    };
  }

  // ---- 朔(新月)の時刻 --------------------------------------------------

  /*
   * k 番目の朔の時刻(Meeus 第49章)。
   *
   * k は 2000年1月6日の朔を 0 とする通し番号で、整数なら朔、
   * +0.25 で上弦、+0.5 で満月……となる。ここでは朔だけを使う。
   *
   * 返すのは UTC の Date。原典の式が返すのは力学時(TD)なので、
   * ΔT を引いて世界時に直している。
   */
  function newMoonAt(k) {
    var T = k / 1236.85;
    var T2 = T * T;
    var T3 = T2 * T;
    var T4 = T3 * T;

    // 平均朔の時刻(ユリウス日・力学時)
    var jde = 2451550.09766 + 29.530588861 * k
      + 0.00015437 * T2 - 0.000000150 * T3 + 0.00000000073 * T4;

    var E = 1 - 0.002516 * T - 0.0000074 * T2;
    var M = RAD * norm360(2.5534 + 29.10535670 * k
      - 0.0000014 * T2 - 0.00000011 * T3);              // 太陽の平均近点角
    var Mp = RAD * norm360(201.5643 + 385.81693528 * k
      + 0.0107582 * T2 + 0.00001238 * T3 - 0.000000058 * T4); // 月の平均近点角
    var F = RAD * norm360(160.7108 + 390.67050284 * k
      - 0.0016118 * T2 - 0.00000227 * T3 + 0.000000011 * T4); // 月の昇交点離角
    var Om = RAD * norm360(124.7746 - 1.56375588 * k
      + 0.0020672 * T2 + 0.00000215 * T3);              // 昇交点黄経

    var terms = MoonTerms.NEW_MOON;
    for (var i = 0; i < terms.length; i++) {
      var t = terms[i];
      var a = Math.abs(t[0]);
      var e = a === 1 ? E : a === 2 ? E * E : a === 3 ? E * E * E : 1;
      jde += t[4] * e * Math.sin(t[0] * M + t[1] * Mp + t[2] * F + t[3] * Om);
    }

    // 力学時 → 世界時
    var jdUt = jde - deltaTSeconds(2000 + k / 12.3685) / 86400;
    return new Date(Math.round((jdUt - 2440587.5) * DAY_MS));
  }

  /**
   * 指定時刻の直前(その時刻以前で最も新しい)の朔の時刻。
   *
   * 月齢はここからの経過日数として求める。位相角を平均朔望月に割り当てる
   * 方法とは別物で、月の公転速度が一定でないため両者は最大0.9日ずれる。
   * 国立天文台の「月齢」はこちらの定義。
   *
   * @param {Date} date 時刻
   * @returns {Date} 直前の朔の時刻(UTC)
   */
  function lastNewMoon(date) {
    var ms = date.valueOf();
    // 2000年からの経過年数 × 年あたりの朔の回数
    var years = (ms / DAY_MS - (2451545 - 2440587.5)) / 365.25;
    var k = Math.floor(years * 12.3685) + 1;

    // 求めた朔が指定時刻より後なら1つ戻す。近似の誤差は1朔以内に収まる。
    for (var i = 0; i < 4; i++) {
      var when = newMoonAt(k);
      if (when.valueOf() <= ms) return when;
      k -= 1;
    }
    return newMoonAt(k);
  }

  // ---- 公開API ---------------------------------------------------------

  /**
   * 指定時刻・指定地点での月の位置を返す。
   *
   * altitude は「観測地点から見た、大気差を含まない高度」。
   * JPL Horizons の airless apparent elevation と同じ定義なので、
   * そのまま突き合わせて検証できる(scripts/stars/fixtures/moon-horizons.json)。
   * 大気差が要るときは apparentAltitude を使う。
   *
   * @param {Date} date 時刻
   * @param {number} lat 緯度(度・北が正)
   * @param {number} lon 経度(度・東が正)
   * @returns {{altitude:number, altitudeDeg:number, azimuth:number,
   *            apparentAltitude:number, distanceKm:number}}
   */
  function position(date, lat, lon) {
    var t = moonTopocentric(date, lat, lon);
    var h = altitude(t.hourAngle, t.phi, t.dec);
    return {
      altitude: h,
      altitudeDeg: h / RAD,
      azimuth: azimuth(t.hourAngle, t.phi, t.dec),
      apparentAltitude: h + astroRefraction(h),
      distanceKm: t.dist,
      parallaxDeg: t.parallax / RAD
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

    // 輝面比は地球の中心から見た量なので、視差の補正は要らない
    var ms = date.valueOf();
    var jdTt = ms / DAY_MS + 2440587.5 + deltaTSeconds(new Date(ms).getUTCFullYear()) / 86400;
    var moon = moonEcliptic((jdTt - 2451545) / 36525);
    var lam = RAD * moon.lambda;
    var bet = RAD * moon.beta;
    var eps = moon.obliquity;
    var mRa = Math.atan2(
      Math.sin(lam) * Math.cos(eps) - Math.tan(bet) * Math.sin(eps),
      Math.cos(lam)
    );
    var mDec = Math.asin(
      Math.sin(bet) * Math.cos(eps) + Math.cos(bet) * Math.sin(eps) * Math.sin(lam)
    );

    // 太陽-月の離角
    var phi = Math.acos(
      Math.sin(s.dec) * Math.sin(mDec) +
        Math.cos(s.dec) * Math.cos(mDec) * Math.cos(s.ra - mRa)
    );
    // 位相角(地球-月-太陽のなす角)
    var inc = Math.atan2(SUN_DIST_KM * Math.sin(phi), moon.dist - SUN_DIST_KM * Math.cos(phi));
    // 満ちていく側か欠けていく側かの符号
    var angle = Math.atan2(
      Math.cos(s.dec) * Math.sin(s.ra - mRa),
      Math.sin(s.dec) * Math.cos(mDec) -
        Math.cos(s.dec) * Math.sin(mDec) * Math.cos(s.ra - mRa)
    );
    var phase = 0.5 + (0.5 * inc * (angle < 0 ? -1 : 1)) / Math.PI;
    return {
      fraction: (1 + Math.cos(inc)) / 2,
      phase: phase,
      // 月齢は「直前の朔からの経過日数」。位相角を平均朔望月で割った値とは
      // 別物で、月の公転速度が一定でないため最大0.9日ほどずれる。
      ageDays: (date.valueOf() - lastNewMoon(date).valueOf()) / DAY_MS
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

  /**
   * 指定時刻・指定地点での太陽の高度(度)。負なら地平線の下。
   * 小数第2位に丸めて返す(この用途に必要な精度をはるかに上回っており、
   * 環境ごとの三角関数の最下位ビットの差でテストが揺れるのも防げる)。
   * @param {Date|string} date 時刻
   * @param {number} lat 緯度(度)
   * @param {number} lon 経度(度)
   */
  function sunAltitudeDeg(date, lat, lon) {
    var d = toDays(date instanceof Date ? date : new Date(date));
    var c = sunCoords(d);
    var H = siderealTime(d, RAD * -lon) - c.ra;
    return Math.round((altitude(H, RAD * lat, c.dec) / RAD) * 100) / 100;
  }

  // 天文薄明の境目。太陽がこれより下にあれば空は充分に暗い。
  var ASTRONOMICAL_TWILIGHT_DEG = -18;

  /**
   * 「その日の夕方から翌朝まで」のうち、空が充分に暗い時間帯を返す。
   *
   * 太陽高度が閾値を下回る最初の時刻と、再び上回る最後の時刻を、
   * 10分刻みで走査して求める(閉じた式を解くより短く、白夜でも破綻しない)。
   * 高緯度の夏など一晩中暗くならない場合は null を返す。
   *
   * 走査の起点はその地点の南中時刻(経度から求める)にする。閲覧者の端末の
   * タイムゾーンには依存しない ── 日本国外から日本の夜を見ても正しく出る。
   *
   * @param {string|Date} day 夕方を迎える日。"YYYY-MM-DD" 文字列を推奨
   *        (Date を渡した場合は UTC での年月日を使う)
   * @param {number} lat 緯度(度)
   * @param {number} lon 経度(度)
   * @param {number} [thresholdDeg] 暗いとみなす太陽高度(既定 -18度=天文薄明)
   * @returns {{start:Date, end:Date}|null}
   */
  function nightWindow(day, lat, lon, thresholdDeg) {
    var limit = typeof thresholdDeg === "number" ? thresholdDeg : ASTRONOMICAL_TWILIGHT_DEG;
    var stepMs = 10 * 60 * 1000;

    var y, m, d;
    if (typeof day === "string") {
      var parts = day.slice(0, 10).split("-");
      y = Number(parts[0]);
      m = Number(parts[1]) - 1;
      d = Number(parts[2]);
    } else {
      y = day.getUTCFullYear();
      m = day.getUTCMonth();
      d = day.getUTCDate();
    }

    // その地点の南中(太陽が最も高くなる)時刻。経度15度で1時間ずれる。
    var solarNoonUtcMin = (12 - lon / 15) * 60;
    var from = new Date(Date.UTC(y, m, d, 0, 0, 0) + solarNoonUtcMin * 60000);
    var steps = (24 * 60) / 10;

    var start = null;
    var end = null;
    for (var i = 0; i <= steps; i++) {
      var t = new Date(from.getTime() + i * stepMs);
      if (sunAltitudeDeg(t, lat, lon) < limit) {
        if (start === null) start = t;
        end = t;
      }
    }
    if (start === null || start.getTime() === end.getTime()) return null;
    return { start: start, end: end };
  }

  /**
   * 「いまの夜」がどの日の夜かを返す。
   *
   * 夜は日付をまたぐので、単純に「今日」を使うと、深夜0時を過ぎた瞬間に
   * 見ている夜が翌日の夜に切り替わってしまう。かといって「正午より前なら前日」
   * のような時刻での線引きも誤る ── 朝5時に前夜が明けたあと正午までの間は、
   * 前夜ではなく「これから来る今夜」を見せるべきだから。
   *
   * そこで前夜の暗い時間帯が今も続いているかを実際に計算して決める。
   *
   * @param {number} lat 緯度(度)
   * @param {number} lon 経度(度)
   * @param {Date|string} [now] いまの時刻(省略時は現在)
   * @returns {string} "YYYY-MM-DD"(その日の夕方から始まる夜)
   */
  function currentNightDate(lat, lon, now) {
    var t = now ? (now instanceof Date ? now : new Date(now)) : new Date();
    // その地点の地方時での日付(閲覧者の端末のタイムゾーンには依存させない)
    var localMs = t.getTime() + (lon / 15) * 3600000;
    var today = new Date(localMs).toISOString().slice(0, 10);

    var parts = today.split("-").map(Number);
    var prev = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    prev.setUTCDate(prev.getUTCDate() - 1);
    var yesterday = prev.toISOString().slice(0, 10);

    // 前夜がまだ明けていなければ、その夜を見せる
    var w = nightWindow(yesterday, lat, lon);
    if (w && t <= w.end) return yesterday;
    return today;
  }

  /**
   * nightWindow を文字列で返す表示・テスト用の版。
   * @returns {{start:string, end:string, hours:number}|null} 時刻は ISO 文字列(UTC)
   */
  /**
   * 指定した時間帯のあいだの、月の出と月の入り。
   *
   * なぜ「その夜のあいだ」で切るか:
   *   撮影や観測で知りたいのは「今夜いつ月が邪魔になるか」であって、
   *   暦としての月の出時刻ではない。夜が明けてからの出没は関係がない。
   *   月あかりが無い時間帯を狙うのが星見なので、ここが判断の要になる。
   *
   * 境目の定義:
   *   国立天文台と同じ「月の上端が地平線に接して見える瞬間」。
   *   月の中心の高度でいうと、視半径のぶん下 + 大気差のぶん下になる。
   *   視半径は月までの距離で変わるので、その時刻の地平視差から毎回求める
   *   (視半径 = 0.2725 × 地平視差)。大気差は地平線で 34分角。
   *
   *   月の中心が地平線に一致する時刻を使うと、国立天文台の値より
   *   1時間あたり数分ずれる。定義を合わせないと比べようがないので、
   *   ここは天文台に合わせてある。
   *
   * 求め方:
   *   10分刻みで符号の変わる区間を挟み、そこを二分法で詰める。
   *   走査だけだと時刻が10分単位に量子化されてしまう(以前はそうなっていた)。
   *   繰り返しは16回で、10分 ÷ 2^16 = 約0.01秒まで縮む。
   *
   * @param {Date} from 走査の開始
   * @param {Date} to 走査の終了
   * @param {number} lat 緯度(度)
   * @param {number} lon 経度(度)
   * @returns {{rise:Date|null, set:Date|null, upAtStart:boolean}}
   *          rise/set は、その時間帯に起きなければ null
   */
  var MOON_REFRACTION_DEG = 34 / 60; // 地平線での大気差
  var MOON_LIMB_FACTOR = 0.2725; // 視半径 ÷ 地平視差

  /* 月の中心の高度が「上端が地平線」の状態からどれだけ上か(度)。正なら出ている */
  function moonAboveHorizonDeg(ms, lat, lon) {
    var p = position(new Date(ms), lat, lon);
    return p.altitudeDeg + MOON_LIMB_FACTOR * p.parallaxDeg + MOON_REFRACTION_DEG;
  }

  /* 符号が変わる区間 [a, b] を二分法で詰める(戻り値はミリ秒) */
  function bisectHorizon(a, b, lat, lon) {
    var fa = moonAboveHorizonDeg(a, lat, lon);
    for (var i = 0; i < 16; i++) {
      var mid = (a + b) / 2;
      var fm = moonAboveHorizonDeg(mid, lat, lon);
      if ((fa < 0) === (fm < 0)) {
        a = mid;
        fa = fm;
      } else {
        b = mid;
      }
    }
    return Math.round((a + b) / 2);
  }

  function moonRiseSet(from, to, lat, lon) {
    var stepMs = 10 * 60 * 1000;
    var prevMs = from.getTime();
    var prevUp = moonAboveHorizonDeg(prevMs, lat, lon) > 0;
    var upAtStart = prevUp;
    var rise = null;
    var set = null;
    var endMs = to.getTime();

    for (var t = prevMs + stepMs; ; t += stepMs) {
      // 最後の区間が10分未満でも取りこぼさないよう、終端で必ず1回評価する
      if (t > endMs) t = endMs;
      var up = moonAboveHorizonDeg(t, lat, lon) > 0;
      if (up !== prevUp) {
        var when = new Date(bisectHorizon(prevMs, t, lat, lon));
        if (up && rise === null) rise = when;
        if (!up && set === null) set = when;
      }
      prevUp = up;
      prevMs = t;
      if (t >= endMs) break;
    }
    return { rise: rise, set: set, upAtStart: upAtStart };
  }

  /** 検証しやすいよう、月の出入りを文字列に丸めたもの */
  function moonRiseSetSummary(fromIso, toIso, lat, lon) {
    var r = moonRiseSet(new Date(fromIso), new Date(toIso), lat, lon);
    return {
      rise: r.rise ? r.rise.toISOString().slice(0, 16) + "Z" : null,
      set: r.set ? r.set.toISOString().slice(0, 16) + "Z" : null,
      upAtStart: r.upAtStart
    };
  }

  function nightWindowSummary(day, lat, lon, thresholdDeg) {
    var w = nightWindow(day, lat, lon, thresholdDeg);
    if (!w) return null;
    return {
      start: w.start.toISOString().slice(0, 16) + "Z",
      end: w.end.toISOString().slice(0, 16) + "Z",
      hours: Math.round(((w.end - w.start) / 3600000) * 10) / 10
    };
  }

  /**
   * 画面表示用にまとめた値。桁を丸めてあるので、そのまま表示にもテストにも使える。
   * @param {Date|string} date 時刻(文字列なら Date に変換する)
   * @param {number} lat 緯度(度)
   * @param {number} lon 経度(度)
   * @returns {{ageDays:number, illuminationPct:number, altitudeDeg:number, brightness:number, phaseLabel:string}}
   */
  function summary(date, lat, lon) {
    var d = date instanceof Date ? date : new Date(date);
    var illum = illumination(d);
    var pos = position(d, lat, lon);
    return {
      ageDays: Math.round(illum.ageDays * 10) / 10,
      illuminationPct: Math.round(illum.fraction * 100),
      altitudeDeg: Math.round(pos.altitudeDeg * 10) / 10,
      brightness: Math.round(brightness(d, lat, lon) * 1000) / 1000,
      phaseLabel: phaseLabel(illum.phase)
    };
  }

  // 月齢の呼び名。境目は朔望月を8等分した一般的な区切りに合わせる。
  var PHASE_LABELS = [
    "新月",
    "三日月",
    "上弦",
    "十三夜",
    "満月",
    "寝待月",
    "下弦",
    "有明月"
  ];

  function phaseLabel(phase) {
    var i = Math.round(phase * 8) % 8;
    return PHASE_LABELS[i];
  }

  var api = {
    position: position,
    illumination: illumination,
    brightness: brightness,
    summary: summary,
    sunAltitudeDeg: sunAltitudeDeg,
    nightWindow: nightWindow,
    nightWindowSummary: nightWindowSummary,
    moonRiseSet: moonRiseSet,
    moonRiseSetSummary: moonRiseSetSummary,
    currentNightDate: currentNightDate,
    SYNODIC_MONTH: SYNODIC_MONTH,
    ASTRONOMICAL_TWILIGHT_DEG: ASTRONOMICAL_TWILIGHT_DEG
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.StarsSky = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
