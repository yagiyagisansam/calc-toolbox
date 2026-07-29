/*
 * 月齢・月の満ち欠けの計算ロジック
 *
 * 根拠(一次情報・照合先):
 * - 国立天文台 暦計算室(朔弦望・月齢) https://eco.mtk.nao.ac.jp/koyomi/ (2026年7月29日参照)
 *   同室が公表する暦要項「朔弦望」(令和8年=2026年、全50件)と本モジュールの計算結果を
 *   照合し、すべて誤差1分以内で一致することを確認した(tests.json に代表例を収録)。
 *
 * 計算方法:
 * - Jean Meeus "Astronomical Algorithms" 第49章「Phases of the Moon」の
 *   截断三角級数を実装している。平均朔望月(29.530589日)で割る簡易法は
 *   実際の朔とのずれが最大±0.6日程度になるため採用していない。
 * - 力学時(TD)から世界時(UT)への変換には ΔT = 69秒(2020年代の実測値に近い定数)を用いる。
 *   ΔTの誤差が数秒あっても、分単位の表示にはほとんど影響しない。
 * - 時刻はすべて日本標準時(JST = UT+9時間)。
 *
 * 前提:
 * - 月齢は「直前の朔(新月)からの経過日数」。国立天文台の定義と同じ。
 * - 輝面比(照らされている割合)は、朔から次の朔までを1周期とみなした概算値。
 *   厳密な位相角の計算ではないため、数%の誤差がある。
 * - 対応範囲は西暦1900年〜2100年。
 */
(function (global) {
  "use strict";

  var YEAR_MIN = 1900;
  var YEAR_MAX = 2100;
  var DELTA_T_SEC = 69; // 力学時と世界時の差(秒)
  var JST_OFFSET_DAYS = 9 / 24;
  var RAD = Math.PI / 180;

  function sind(x) { return Math.sin(x * RAD); }
  function cosd(x) { return Math.cos(x * RAD); }
  function isFiniteNumber(v) { return typeof v === "number" && isFinite(v); }
  function isInt(v) { return isFiniteNumber(v) && Math.floor(v) === v; }

  /** 小数第n位で四捨五入する */
  function round(v, n) {
    var f = Math.pow(10, n);
    return Math.round(v * f) / f;
  }

  // Meeus 第49章 表49.A/49.B の補正項。[係数, Eの指数, 角度のキー]
  var NEW_TERMS = [
    [-0.40720, 0, "Mp"], [0.17241, 1, "M"], [0.01608, 0, "2Mp"], [0.01039, 0, "2F"],
    [0.00739, 1, "Mp-M"], [-0.00514, 1, "Mp+M"], [0.00208, 2, "2M"], [-0.00111, 0, "Mp-2F"],
    [-0.00057, 0, "Mp+2F"], [0.00056, 1, "2Mp+M"], [-0.00042, 0, "3Mp"], [0.00042, 1, "M+2F"],
    [0.00038, 1, "M-2F"], [-0.00024, 1, "2Mp-M"], [-0.00017, 0, "Om"], [-0.00007, 0, "Mp+2M"],
    [0.00004, 0, "2Mp-2F"], [0.00004, 0, "3M"], [0.00003, 0, "Mp+M-2F"], [0.00003, 0, "2Mp+2F"],
    [-0.00003, 0, "Mp+M+2F"], [0.00003, 0, "Mp-M+2F"], [-0.00002, 0, "Mp-M-2F"],
    [-0.00002, 0, "3Mp+M"], [0.00002, 0, "4Mp"]
  ];
  var FULL_TERMS = [
    [-0.40614, 0, "Mp"], [0.17302, 1, "M"], [0.01614, 0, "2Mp"], [0.01043, 0, "2F"],
    [0.00734, 1, "Mp-M"], [-0.00515, 1, "Mp+M"], [0.00209, 2, "2M"], [-0.00111, 0, "Mp-2F"],
    [-0.00057, 0, "Mp+2F"], [0.00056, 1, "2Mp+M"], [-0.00042, 0, "3Mp"], [0.00042, 1, "M+2F"],
    [0.00038, 1, "M-2F"], [-0.00024, 1, "2Mp-M"], [-0.00017, 0, "Om"], [-0.00007, 0, "Mp+2M"],
    [0.00004, 0, "2Mp-2F"], [0.00004, 0, "3M"], [0.00003, 0, "Mp+M-2F"], [0.00003, 0, "2Mp+2F"],
    [-0.00003, 0, "Mp+M+2F"], [0.00003, 0, "Mp-M+2F"], [-0.00002, 0, "Mp-M-2F"],
    [-0.00002, 0, "3Mp+M"], [0.00002, 0, "4Mp"]
  ];
  var QUARTER_TERMS = [
    [-0.62801, 0, "Mp"], [0.17172, 1, "M"], [-0.01183, 1, "Mp+M"], [0.00862, 0, "2Mp"],
    [0.00804, 0, "2F"], [0.00454, 1, "Mp-M"], [0.00204, 2, "2M"], [-0.00180, 0, "Mp-2F"],
    [-0.00070, 0, "Mp+2F"], [-0.00040, 0, "3Mp"], [-0.00034, 1, "2Mp-M"], [0.00032, 1, "M+2F"],
    [0.00032, 1, "M-2F"], [-0.00028, 2, "Mp+2M"], [0.00027, 1, "2Mp+M"], [-0.00017, 0, "Om"],
    [-0.00005, 0, "Mp-M-2F"], [0.00004, 0, "2Mp+2F"], [-0.00004, 0, "Mp+M+2F"],
    [0.00004, 0, "Mp-2M"], [0.00003, 0, "Mp+M-2F"], [0.00003, 0, "3M"], [0.00002, 0, "2Mp-2F"],
    [0.00002, 0, "Mp-M+2F"], [-0.00002, 0, "3Mp+M"]
  ];
  // 惑星による追加補正 A1〜A14。[係数, 定数項, kの係数, T^2の係数]
  var A_COEF = [
    [0.000325, 299.77, 0.107408, -0.009173], [0.000165, 251.88, 0.016321, 0],
    [0.000164, 251.83, 26.651886, 0], [0.000126, 349.42, 36.412478, 0],
    [0.000110, 84.66, 18.206239, 0], [0.000062, 141.74, 53.303771, 0],
    [0.000060, 207.14, 2.453732, 0], [0.000056, 154.84, 7.306860, 0],
    [0.000047, 34.52, 27.261239, 0], [0.000042, 207.19, 0.121824, 0],
    [0.000040, 291.34, 1.844379, 0], [0.000037, 161.72, 24.198154, 0],
    [0.000035, 239.56, 25.513099, 0], [0.000023, 331.55, 3.592518, 0]
  ];

  function angleOf(key, M, Mp, F, Om) {
    switch (key) {
      case "M": return M;
      case "Mp": return Mp;
      case "2Mp": return 2 * Mp;
      case "2F": return 2 * F;
      case "Mp-M": return Mp - M;
      case "Mp+M": return Mp + M;
      case "2M": return 2 * M;
      case "Mp-2F": return Mp - 2 * F;
      case "Mp+2F": return Mp + 2 * F;
      case "2Mp+M": return 2 * Mp + M;
      case "3Mp": return 3 * Mp;
      case "M+2F": return M + 2 * F;
      case "M-2F": return M - 2 * F;
      case "2Mp-M": return 2 * Mp - M;
      case "Om": return Om;
      case "Mp+2M": return Mp + 2 * M;
      case "2Mp-2F": return 2 * Mp - 2 * F;
      case "3M": return 3 * M;
      case "Mp+M-2F": return Mp + M - 2 * F;
      case "2Mp+2F": return 2 * Mp + 2 * F;
      case "Mp+M+2F": return Mp + M + 2 * F;
      case "Mp-M+2F": return Mp - M + 2 * F;
      case "Mp-M-2F": return Mp - M - 2 * F;
      case "3Mp+M": return 3 * Mp + M;
      case "4Mp": return 4 * Mp;
      case "Mp-2M": return Mp - 2 * M;
      default: return 0;
    }
  }

  var PHASE_INDEX = { "new": 0, first: 1, full: 2, last: 3 };
  var PHASE_LABEL = { "new": "朔(新月)", first: "上弦", full: "望(満月)", last: "下弦" };

  /**
   * k番目の朔を基準とした月相の時刻(日本標準時のユリウス日)を返す内部関数。
   * @param {number} n 朔の通し番号(2000年1月6日の朔が0)
   * @param {number} phase 0=朔 / 1=上弦 / 2=望 / 3=下弦
   * @returns {number} 日本標準時に換算したユリウス日
   */
  function phaseJd(n, phase) {
    var k = n + phase * 0.25;
    var T = k / 1236.85;
    var T2 = T * T, T3 = T2 * T, T4 = T3 * T;
    var jde = 2451550.09766 + 29.530588861 * k + 0.00015437 * T2
      - 0.000000150 * T3 + 0.00000000073 * T4;
    var E = 1 - 0.002516 * T - 0.0000074 * T2;
    var M = 2.5534 + 29.10535670 * k - 0.0000014 * T2 - 0.00000011 * T3;
    var Mp = 201.5643 + 385.81693528 * k + 0.0107582 * T2 + 0.00001238 * T3 - 0.000000058 * T4;
    var F = 160.7108 + 390.67050284 * k - 0.0016118 * T2 - 0.00000227 * T3 + 0.000000011 * T4;
    var Om = 124.7746 - 1.56375588 * k + 0.0020672 * T2 + 0.00000215 * T3;

    var terms = phase === 0 ? NEW_TERMS : phase === 2 ? FULL_TERMS : QUARTER_TERMS;
    for (var i = 0; i < terms.length; i++) {
      jde += terms[i][0] * Math.pow(E, terms[i][1]) * sind(angleOf(terms[i][2], M, Mp, F, Om));
    }
    if (phase === 1 || phase === 3) {
      var W = 0.00306 - 0.00038 * E * cosd(M) + 0.00026 * cosd(Mp)
        - 0.00002 * cosd(Mp - M) + 0.00002 * cosd(Mp + M) + 0.00002 * cosd(2 * F);
      jde += phase === 1 ? W : -W;
    }
    for (var j = 0; j < A_COEF.length; j++) {
      var a = A_COEF[j];
      jde += a[0] * sind(a[1] + a[2] * k + a[3] * T2);
    }
    return jde - DELTA_T_SEC / 86400 + JST_OFFSET_DAYS;
  }

  /** 年月日と1日のうちの割合から、日本標準時のユリウス日を求める内部関数 */
  function jdFromDate(y, m, d, fracDay) {
    var yy = y, mm = m;
    if (mm <= 2) { yy -= 1; mm += 12; }
    var A = Math.floor(yy / 100);
    var B = 2 - A + Math.floor(A / 4);
    return Math.floor(365.25 * (yy + 4716)) + Math.floor(30.6001 * (mm + 1)) + d + B - 1524.5 + fracDay;
  }

  /** 日本標準時のユリウス日から年月日時分に戻す内部関数 */
  function dateFromJd(jd) {
    var z = Math.floor(jd + 0.5);
    var f = jd + 0.5 - z;
    var a = z;
    if (z >= 2299161) {
      var al = Math.floor((z - 1867216.25) / 36524.25);
      a = z + 1 + al - Math.floor(al / 4);
    }
    var b = a + 1524;
    var c = Math.floor((b - 122.1) / 365.25);
    var dd = Math.floor(365.25 * c);
    var e = Math.floor((b - dd) / 30.6001);
    var day = b - dd - Math.floor(30.6001 * e);
    var month = e < 14 ? e - 1 : e - 13;
    var year = month > 2 ? c - 4716 : c - 4715;
    var minutes = Math.round(f * 1440);
    if (minutes >= 1440) { minutes -= 1440; day += 1; }
    return {
      year: year, month: month, day: day,
      hour: Math.floor(minutes / 60), minute: minutes % 60
    };
  }

  /** 実在する日付かどうかを判定する */
  function isRealDate(y, m, d) {
    if (!isInt(y) || !isInt(m) || !isInt(d)) return false;
    if (y < YEAR_MIN || y > YEAR_MAX) return false;
    if (m < 1 || m > 12 || d < 1 || d > 31) return false;
    var dt = new Date(y, m - 1, d);
    dt.setFullYear(y);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
  }

  /** 入力を検証してユリウス日に変換する内部関数 */
  function toJd(y, m, d, hour, minute) {
    if (!isRealDate(y, m, d)) return { ok: false, code: "invalid_date" };
    var hh = hour === undefined ? 0 : hour;
    var mi = minute === undefined ? 0 : minute;
    if (!isInt(hh) || hh < 0 || hh > 23) return { ok: false, code: "invalid_time" };
    if (!isInt(mi) || mi < 0 || mi > 59) return { ok: false, code: "invalid_time" };
    return { ok: true, jd: jdFromDate(y, m, d, (hh * 60 + mi) / 1440) };
  }

  /** 指定したユリウス日の直前の朔の通し番号を求める内部関数 */
  function newMoonIndexBefore(jd) {
    var approxYear = 2000 + (jd - 2451545.0) / 365.25;
    var n = Math.round((approxYear - 2000) * 12.3685);
    // 前後にずれることがあるので、条件を満たすまで調整する
    while (phaseJd(n, 0) > jd) n -= 1;
    while (phaseJd(n + 1, 0) <= jd) n += 1;
    return n;
  }

  /**
   * 指定した日時(日本標準時)の月齢・月相・輝面比と、前後の朔弦望を求める。
   * @param {number} year 西暦年(1900〜2100)
   * @param {number} month 月(1〜12)
   * @param {number} day 日(1〜31。実在する日付であること)
   * @param {number} [hour=0] 時(0〜23)
   * @param {number} [minute=0] 分(0〜59)
   * @returns {{ok:true, age:number, phase:string, illumination:number, cycleDays:number,
   *            lastNewMoon:object, firstQuarter:object, fullMoon:object,
   *            lastQuarter:object, nextNewMoon:object}
   *          |{ok:false, code:"invalid_date"|"invalid_time"}}
   *   age: 月齢(直前の朔からの経過日数。小数第1位で四捨五入)
   *   phase: 月相の呼び名
   *   illumination: 輝面比(%、小数第1位で四捨五入。朔〜次の朔を1周期とみなした概算)
   *   cycleDays: この周期の朔から次の朔までの日数(小数第2位で四捨五入)
   *   lastNewMoon など: {year, month, day, hour, minute} 形式の日本標準時
   */
  function moonAge(year, month, day, hour, minute) {
    var t = toJd(year, month, day, hour, minute);
    if (!t.ok) return t;
    var jd = t.jd;
    var n = newMoonIndexBefore(jd);
    var newJd = phaseJd(n, 0);
    var firstJd = phaseJd(n, 1);
    var fullJd = phaseJd(n, 2);
    var lastJd = phaseJd(n, 3);
    var nextNewJd = phaseJd(n + 1, 0);

    var age = jd - newJd;
    var cycle = nextNewJd - newJd;
    var frac = age / cycle;

    var phase;
    if (Math.abs(jd - newJd) <= 0.5 || Math.abs(jd - nextNewJd) <= 0.5) {
      phase = "新月(朔)";
    } else if (Math.abs(jd - firstJd) <= 0.5) {
      phase = "上弦の月";
    } else if (Math.abs(jd - fullJd) <= 0.5) {
      phase = "満月(望)";
    } else if (Math.abs(jd - lastJd) <= 0.5) {
      phase = "下弦の月";
    } else if (jd < firstJd) {
      phase = "新月から上弦へ(満ちていく)";
    } else if (jd < fullJd) {
      phase = "上弦から満月へ(満ちていく)";
    } else if (jd < lastJd) {
      phase = "満月から下弦へ(欠けていく)";
    } else {
      phase = "下弦から新月へ(欠けていく)";
    }

    return {
      ok: true,
      age: round(age, 1),
      phase: phase,
      illumination: round((1 - Math.cos(2 * Math.PI * frac)) / 2 * 100, 1),
      cycleDays: round(cycle, 2),
      lastNewMoon: dateFromJd(newJd),
      firstQuarter: dateFromJd(firstJd),
      fullMoon: dateFromJd(fullJd),
      lastQuarter: dateFromJd(lastJd),
      nextNewMoon: dateFromJd(nextNewJd)
    };
  }

  /**
   * 指定した日時より後に来る、最初の朔弦望の日時(日本標準時)を求める。
   * @param {number} year 西暦年(1900〜2100)
   * @param {number} month 月(1〜12)
   * @param {number} day 日(1〜31)
   * @param {number} hour 時(0〜23)
   * @param {number} minute 分(0〜59)
   * @param {string} kind "new"(朔) / "first"(上弦) / "full"(望) / "last"(下弦)
   * @returns {{ok:true, kind:string, label:string, year:number, month:number,
   *            day:number, hour:number, minute:number, daysUntil:number}
   *          |{ok:false, code:"invalid_date"|"invalid_time"|"invalid_kind"}}
   *   daysUntil: 指定日時からの日数(小数第2位で四捨五入)
   */
  function nextPhase(year, month, day, hour, minute, kind) {
    var t = toJd(year, month, day, hour, minute);
    if (!t.ok) return t;
    if (!Object.prototype.hasOwnProperty.call(PHASE_INDEX, kind)) {
      return { ok: false, code: "invalid_kind" };
    }
    var p = PHASE_INDEX[kind];
    var n = newMoonIndexBefore(t.jd);
    var jd = phaseJd(n, p);
    var guard = 0;
    while (jd <= t.jd && guard < 5) { n += 1; jd = phaseJd(n, p); guard += 1; }
    var out = dateFromJd(jd);
    return {
      ok: true,
      kind: kind,
      label: PHASE_LABEL[kind],
      year: out.year,
      month: out.month,
      day: out.day,
      hour: out.hour,
      minute: out.minute,
      daysUntil: round(jd - t.jd, 2)
    };
  }

  var api = {
    moonAge: moonAge,
    nextPhase: nextPhase
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.GetsureiCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
