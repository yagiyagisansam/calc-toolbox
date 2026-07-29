/*
 * 六曜(大安・仏滅など)の判定ロジック
 *
 * 根拠:
 * - 国立国会図書館「日本の暦」六曜 — 六曜は先勝・友引・先負・仏滅・大安・赤口の順に配当し、
 *   「1月、7月(旧暦)の1日(朔日)に先勝を当て、以後順に配当していきます」
 *   https://www.ndl.go.jp/koyomi/chapter3/s3.html (2026年7月29日参照)
 *   → 旧暦の月と日から (月 + 日) を6で割った余りで決まる。
 * - 国立天文台「『旧暦』ってなに?」— 旧暦(天保暦)は、朔(新月)の日を月の1日とし、
 *   中気(太陽黄経が30度の倍数になる瞬間)を含まない月を閏月とする太陰太陽暦
 *   https://www.nao.ac.jp/faq/a0304.html (2026年7月29日参照)
 * - 国立天文台 暦計算室「暦Wiki」(暦の用語と計算の考え方)
 *   https://eco.mtk.nao.ac.jp/koyomi/wiki/ (2026年7月29日参照)
 *
 * 計算に使った天文計算の出典:
 * - Jean Meeus "Astronomical Algorithms" 2nd ed.
 *   第25章(太陽の位置。見かけの黄経、精度およそ0.01度)
 *   第49章(朔・弦・望の時刻。ΔTを補正すれば数秒の精度)
 * - ΔT(TT − UT)は Espenak & Meeus の多項式近似(1900年〜2150年)
 *
 * 基準の時点:
 * - 六曜の配当規則は2026年7月29日時点の上記ページの記載内容にもとづく。
 *
 * 前提:
 * - 現在の日本の旧暦(天保暦の考え方を引き継いだもの)は国が定めた暦ではない。
 *   本ツールは上記の規則を天文計算で再現したもので、市販の暦とまれに1日ずれることがある。
 * - 朔・中気の時刻は日本標準時(JST = UT+9時間)で判定する。
 * - 対応範囲は西暦1900年〜2099年。
 *
 * 丸め:
 * - 旧暦の日付は「朔の瞬間が属する日(JST)」を1日として数える。時刻の丸めは行わず、
 *   JSTの0時を境に日付を区切る。
 */
(function (global) {
  "use strict";

  var ROKUYO = ["大安", "赤口", "先勝", "友引", "先負", "仏滅"]; // (旧暦月 + 旧暦日) mod 6
  var YEAR_MIN = 1900;
  var YEAR_MAX = 2099;
  var RAD = Math.PI / 180;

  function isInt(v) {
    return typeof v === "number" && isFinite(v) && Math.floor(v) === v;
  }
  function sinDeg(d) { return Math.sin(d * RAD); }
  function norm360(d) {
    var v = d % 360;
    return v < 0 ? v + 360 : v;
  }

  /* ---------- 暦日(グレゴリオ暦)とユリウス通日 ---------- */

  /**
   * グレゴリオ暦の年月日をユリウス通日(整数)に変換する。
   * @param {number} y 年 @param {number} m 月(1-12) @param {number} d 日
   * @returns {number} ユリウス通日(JDN)
   */
  function toJDN(y, m, d) {
    var a = Math.floor((14 - m) / 12);
    var y2 = y + 4800 - a;
    var m2 = m + 12 * a - 3;
    return d + Math.floor((153 * m2 + 2) / 5) + 365 * y2 +
      Math.floor(y2 / 4) - Math.floor(y2 / 100) + Math.floor(y2 / 400) - 32045;
  }

  /**
   * ユリウス通日(整数)をグレゴリオ暦の年月日に変換する。
   * @param {number} jdn ユリウス通日
   * @returns {{year:number, month:number, day:number}}
   */
  function fromJDN(jdn) {
    var a = jdn + 32044;
    var b = Math.floor((4 * a + 3) / 146097);
    var c = a - Math.floor(146097 * b / 4);
    var d2 = Math.floor((4 * c + 3) / 1461);
    var e = c - Math.floor(1461 * d2 / 4);
    var m2 = Math.floor((5 * e + 2) / 153);
    return {
      year: 100 * b + d2 - 4800 + Math.floor(m2 / 10),
      month: m2 + 3 - 12 * Math.floor(m2 / 10),
      day: e - Math.floor((153 * m2 + 2) / 5) + 1
    };
  }

  /** 実在する日付かどうか。 */
  function isRealDate(y, m, d) {
    if (!isInt(y) || !isInt(m) || !isInt(d)) return false;
    if (m < 1 || m > 12 || d < 1 || d > 31) return false;
    var r = fromJDN(toJDN(y, m, d));
    return r.year === y && r.month === m && r.day === d;
  }

  /* ---------- 天文計算 ---------- */

  /**
   * ΔT(地球時TT − 世界時UT)の近似値(秒)。Espenak & Meeus の多項式。
   * @param {number} year 小数年
   * @returns {number} 秒
   */
  function deltaT(year) {
    var t;
    if (year < 1920) { t = year - 1900; return -2.79 + 1.494119 * t - 0.0598939 * t * t + 0.0061966 * t * t * t - 0.000197 * t * t * t * t; }
    if (year < 1941) { t = year - 1920; return 21.20 + 0.84493 * t - 0.076100 * t * t + 0.0020936 * t * t * t; }
    if (year < 1961) { t = year - 1950; return 29.07 + 0.407 * t - t * t / 233 + t * t * t / 2547; }
    if (year < 1986) { t = year - 1975; return 45.45 + 1.067 * t - t * t / 260 - t * t * t / 718; }
    if (year < 2005) { t = year - 2000; return 63.86 + 0.3345 * t - 0.060374 * t * t + 0.0017275 * t * t * t + 0.000651814 * t * t * t * t + 0.00002373599 * t * t * t * t * t; }
    if (year < 2050) { t = year - 2000; return 62.92 + 0.32217 * t + 0.005589 * t * t; }
    var u = (year - 1820) / 100;
    return -20 + 32 * u * u - 0.5628 * (2150 - year);
  }

  /** ユリウス日(UT)からおおよその小数年を求める(ΔTの計算用)。 */
  function jdToYear(jd) {
    return 2000 + (jd - 2451545.0) / 365.25;
  }

  /**
   * 太陽の見かけの黄経(度)。Meeus 第25章(精度およそ0.01度)。
   * @param {number} jde ユリウス日(地球時TT)
   * @returns {number} 0〜360度
   */
  function sunLongitude(jde) {
    var T = (jde - 2451545.0) / 36525;
    var L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
    var M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
    var C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * sinDeg(M) +
      (0.019993 - 0.000101 * T) * sinDeg(2 * M) +
      0.000289 * sinDeg(3 * M);
    var omega = 125.04 - 1934.136 * T;
    return norm360(L0 + C - 0.00569 - 0.00478 * sinDeg(omega));
  }

  /**
   * k番目の朔(新月)の時刻。Meeus 第49章。
   * @param {number} k 朔の通し番号(2000年1月6日の朔が0)
   * @returns {number} ユリウス日(地球時TT)
   */
  function newMoonJDE(k) {
    var T = k / 1236.85;
    var T2 = T * T, T3 = T2 * T, T4 = T3 * T;
    var jde = 2451550.09766 + 29.530588861 * k + 0.00015437 * T2 - 0.000000150 * T3 + 0.00000000073 * T4;
    var E = 1 - 0.002516 * T - 0.0000074 * T2;
    var M = 2.5534 + 29.10535670 * k - 0.0000014 * T2 - 0.00000011 * T3;
    var Mp = 201.5643 + 385.81693528 * k + 0.0107582 * T2 + 0.00001238 * T3 - 0.000000058 * T4;
    var F = 160.7108 + 390.67050284 * k - 0.0016118 * T2 - 0.00000227 * T3 + 0.000000011 * T4;
    var O = 124.7746 - 1.56375588 * k + 0.0020672 * T2 + 0.00000215 * T3;

    jde += -0.40720 * sinDeg(Mp)
      + 0.17241 * E * sinDeg(M)
      + 0.01608 * sinDeg(2 * Mp)
      + 0.01039 * sinDeg(2 * F)
      + 0.00739 * E * sinDeg(Mp - M)
      - 0.00514 * E * sinDeg(Mp + M)
      + 0.00208 * E * E * sinDeg(2 * M)
      - 0.00111 * sinDeg(Mp - 2 * F)
      - 0.00057 * sinDeg(Mp + 2 * F)
      + 0.00056 * E * sinDeg(2 * Mp + M)
      - 0.00042 * sinDeg(3 * Mp)
      + 0.00042 * E * sinDeg(M + 2 * F)
      + 0.00038 * E * sinDeg(M - 2 * F)
      - 0.00024 * E * sinDeg(2 * Mp - M)
      - 0.00017 * sinDeg(O)
      - 0.00007 * sinDeg(Mp + 2 * M)
      + 0.00004 * sinDeg(2 * Mp - 2 * F)
      + 0.00004 * sinDeg(3 * M)
      + 0.00003 * sinDeg(Mp + M - 2 * F)
      + 0.00003 * sinDeg(2 * Mp + 2 * F)
      - 0.00003 * sinDeg(Mp + M + 2 * F)
      + 0.00003 * sinDeg(Mp - M + 2 * F)
      - 0.00002 * sinDeg(Mp - M - 2 * F)
      - 0.00002 * sinDeg(3 * Mp + M)
      + 0.00002 * sinDeg(4 * Mp);

    var A = [
      [0.000325, 299.77 + 0.107408 * k - 0.009173 * T2],
      [0.000165, 251.88 + 0.016321 * k],
      [0.000164, 251.83 + 26.651886 * k],
      [0.000126, 349.42 + 36.412478 * k],
      [0.000110, 84.66 + 18.206239 * k],
      [0.000062, 141.74 + 53.303771 * k],
      [0.000060, 207.14 + 2.453732 * k],
      [0.000056, 154.84 + 7.306860 * k],
      [0.000047, 34.52 + 27.261239 * k],
      [0.000042, 207.19 + 0.121824 * k],
      [0.000040, 291.34 + 1.844379 * k],
      [0.000037, 161.72 + 24.198154 * k],
      [0.000035, 239.56 + 25.513099 * k],
      [0.000023, 331.55 + 3.592518 * k]
    ];
    for (var i = 0; i < A.length; i++) jde += A[i][0] * sinDeg(A[i][1]);
    return jde;
  }

  /** 地球時のユリウス日を、日本標準時の暦日(JDN)に変換する。 */
  function jdeToJstJDN(jde) {
    var jdUT = jde - deltaT(jdToYear(jde)) / 86400;
    return Math.floor(jdUT + 9 / 24 + 0.5);
  }

  /** JSTの暦日(JDN)の0時における地球時のユリウス日。 */
  function jstMidnightJDE(jdn) {
    var jdUT = jdn - 0.875; // JST 0:00 = UT 前日15:00
    return jdUT + deltaT(jdToYear(jdUT)) / 86400;
  }

  /** k番目の朔が属するJSTの暦日(JDN)。 */
  function newMoonJDN(k) {
    return jdeToJstJDN(newMoonJDE(k));
  }

  /**
   * 指定したJSTの暦日以前で最も新しい朔の日(JDN)と、その通し番号kを返す。
   * @param {number} jdn JSTの暦日(JDN)
   * @returns {{jdn:number, k:number}}
   */
  function newMoonOnOrBefore(jdn) {
    var k = Math.round((jdn - 2451550.09766) / 29.530588861) + 2;
    while (newMoonJDN(k) > jdn) k--;
    return { jdn: newMoonJDN(k), k: k };
  }

  /**
   * その年の冬至(太陽黄経270度)のJSTの暦日(JDN)。
   * @param {number} year 西暦年
   * @returns {number} JDN
   */
  function winterSolsticeJDN(year) {
    var jde = toJDN(year, 12, 21) - 0.5;
    for (var i = 0; i < 8; i++) {
      var diff = norm360(sunLongitude(jde) - 270 + 180) - 180;
      jde -= diff / 0.9856; // 太陽は1日あたり約0.9856度進む
    }
    return jdeToJstJDN(jde);
  }

  /** JSTの暦日の0時における中気の番号(太陽黄経を30度ごとに区切った番号 0〜11)。 */
  function majorTermIndex(jdn) {
    return Math.floor(sunLongitude(jstMidnightJDE(jdn)) / 30);
  }

  /* ---------- 旧暦 ---------- */

  /**
   * グレゴリオ暦の日付に対応する旧暦(天保暦の規則による)の月・日・閏を求める。
   * @param {number} y 西暦年(1900〜2099)
   * @param {number} m 月(1〜12)
   * @param {number} d 日
   * @returns {{ok:true, month:number, day:number, leap:boolean, newMoonJDN:number}
   *          |{ok:false, code:"invalid_date"|"out_of_range"}}
   *   month は旧暦の月(1〜12)、day は旧暦の日(1〜30)、leap は閏月かどうか。
   */
  function kyureki(y, m, d) {
    if (!isRealDate(y, m, d)) return { ok: false, code: "invalid_date" };
    if (y < YEAR_MIN || y > YEAR_MAX) return { ok: false, code: "out_of_range" };
    var jdn = toJDN(y, m, d);

    // 直近の「冬至を含む月(=旧暦11月)」の朔日を探す
    var base = null;
    for (var back = 0; back <= 2; back++) {
      var ws = winterSolsticeJDN(y - back);
      var nm = newMoonOnOrBefore(ws);
      if (nm.jdn <= jdn) { base = { ws: ws, wsYear: y - back, m11: nm }; break; }
    }
    if (!base) return { ok: false, code: "out_of_range" };

    // 次の冬至を含む月(=次の旧暦11月)の朔日
    var nextWs = winterSolsticeJDN(base.wsYear + 1);
    var nextM11 = newMoonOnOrBefore(nextWs);
    var count = nextM11.k - base.m11.k; // この11月から次の11月までの月数(12か13)

    // 閏月: 中気を含まない最初の月(11月そのものと次の11月は除く)
    var leapIndex = -1;
    if (count === 13) {
      for (var i = 1; i < count; i++) {
        var s = newMoonJDN(base.m11.k + i);
        var e = newMoonJDN(base.m11.k + i + 1);
        if (majorTermIndex(s) === majorTermIndex(e)) { leapIndex = i; break; }
      }
    }

    // 月番号の割り当て
    var num = 11;
    var lastNum = 11;
    var target = newMoonOnOrBefore(jdn);
    var offset = target.k - base.m11.k;
    if (offset < 0 || offset >= count) return { ok: false, code: "out_of_range" };
    var monthNum = 11;
    var isLeap = false;
    for (var j = 0; j <= offset; j++) {
      if (j === leapIndex) {
        monthNum = lastNum;
        isLeap = true;
      } else {
        monthNum = num;
        isLeap = false;
        lastNum = num;
        num = num === 12 ? 1 : num + 1;
      }
    }
    return {
      ok: true,
      month: monthNum,
      day: jdn - target.jdn + 1,
      leap: isLeap,
      newMoonJDN: target.jdn
    };
  }

  /**
   * 指定日の六曜を判定する。
   * @param {number} y 西暦年(1900〜2099)
   * @param {number} m 月(1〜12)
   * @param {number} d 日
   * @returns {{ok:true, name:string, index:number, kyurekiMonth:number, kyurekiDay:number, leap:boolean}
   *          |{ok:false, code:"invalid_date"|"out_of_range"}}
   *   index は (旧暦月 + 旧暦日) を6で割った余り。0=大安 1=赤口 2=先勝 3=友引 4=先負 5=仏滅。
   */
  function rokuyo(y, m, d) {
    var k = kyureki(y, m, d);
    if (!k.ok) return k;
    var idx = (k.month + k.day) % 6;
    return {
      ok: true,
      name: ROKUYO[idx],
      index: idx,
      kyurekiMonth: k.month,
      kyurekiDay: k.day,
      leap: k.leap
    };
  }

  /**
   * 指定日から指定日数ぶんの六曜を並べて返す。
   * @param {number} y 開始日の西暦年
   * @param {number} m 開始日の月
   * @param {number} d 開始日の日
   * @param {number} days 日数(1〜400)
   * @returns {{ok:true, rows:Array<{year:number, month:number, day:number, name:string,
   *            kyurekiMonth:number, kyurekiDay:number, leap:boolean}>}
   *          |{ok:false, code:"invalid_date"|"out_of_range"|"invalid_days"}}
   */
  function range(y, m, d, days) {
    if (!isRealDate(y, m, d)) return { ok: false, code: "invalid_date" };
    if (!isInt(days) || days < 1 || days > 400) return { ok: false, code: "invalid_days" };
    var start = toJDN(y, m, d);
    var rows = [];
    for (var i = 0; i < days; i++) {
      var g = fromJDN(start + i);
      var r = rokuyo(g.year, g.month, g.day);
      if (!r.ok) return r;
      rows.push({
        year: g.year, month: g.month, day: g.day,
        name: r.name, kyurekiMonth: r.kyurekiMonth, kyurekiDay: r.kyurekiDay, leap: r.leap
      });
    }
    return { ok: true, rows: rows };
  }

  /**
   * 指定日以降で、指定した六曜にあたる日を探す。
   * @param {number} y 開始日の西暦年 @param {number} m 開始日の月 @param {number} d 開始日の日
   * @param {string} name 六曜の名前("大安"など)
   * @param {number} [count=5] 何件返すか(1〜30)
   * @param {number} [limitDays=400] 何日先まで探すか(1〜400)
   * @returns {{ok:true, rows:Array<object>}|{ok:false, code:string}}
   */
  function findNext(y, m, d, name, count, limitDays) {
    if (ROKUYO.indexOf(name) < 0) return { ok: false, code: "invalid_rokuyo" };
    var n = count === undefined || count === null ? 5 : count;
    if (!isInt(n) || n < 1 || n > 30) return { ok: false, code: "invalid_count" };
    var lim = limitDays === undefined || limitDays === null ? 400 : limitDays;
    var all = range(y, m, d, lim);
    if (!all.ok) return all;
    var rows = [];
    for (var i = 0; i < all.rows.length && rows.length < n; i++) {
      if (all.rows[i].name === name) rows.push(all.rows[i]);
    }
    return { ok: true, rows: rows };
  }

  var api = {
    rokuyo: rokuyo,
    kyureki: kyureki,
    range: range,
    findNext: findNext,
    toJDN: toJDN,
    fromJDN: fromJDN,
    names: function () { return ROKUYO.slice(); }
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.RokuyoCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
