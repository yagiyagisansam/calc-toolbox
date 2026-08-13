/*
 * 空の計算(太陽と月の位置・月齢)
 *
 * 星見の判断に必要なのは「いつ空が暗くなるか(太陽)」と
 * 「月がどれだけ空を明るくするか(月)」の2つ。月の満ち欠けは太陽との
 * 位置関係で決まるので、どちらもこのモジュールにまとめてある。
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
