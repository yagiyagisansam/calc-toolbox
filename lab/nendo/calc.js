/*
 * 年度・四半期 判定 の計算ロジック
 *
 * 根拠(一次情報):
 * - 財政法(昭和22年法律第34号)第11条
 *   「国の会計年度は、毎年四月一日に始まり、翌年三月三十一日に終るものとする。」
 *   https://laws.e-gov.go.jp/law/322AC0000000034 (2026年7月29日参照。条文は e-Gov 法令API で確認)
 * - 地方自治法(昭和22年法律第67号)第208条第1項も同じく普通地方公共団体の会計年度を
 *   4月1日から翌年3月31日までと定める。
 *   https://laws.e-gov.go.jp/law/322AC0000000067 (2026年7月29日参照)
 *
 * 前提:
 * - 年度の開始月は既定で4月(国・地方公共団体・多くの日本企業)。1月・7月・10月なども選べる。
 * - 年度の呼び名は「開始する年」で表す(2026年4月1日〜2027年3月31日は2026年度)。
 * - 四半期は年度の開始月から3か月ずつ数える(開始月が4月なら4〜6月が第1四半期)。
 * - 「残りの平日」は土曜・日曜を除いた日数。祝日・年末年始・会社の休日は含めていない。
 * - 学校の学年や税務の課税期間など、年度と呼ぶものでも区切りが違う制度がある。
 */
(function (global) {
  "use strict";

  var MIN_YEAR = 1583; // グレゴリオ暦が使える範囲の下限
  var MAX_YEAR = 3000;
  var MS_PER_DAY = 86400000;

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }
  function isInt(v) {
    return isFiniteNumber(v) && Math.floor(v) === v;
  }

  /**
   * その年月の日数を返す
   * @param {number} year 西暦年
   * @param {number} month 月(1〜12)
   * @returns {number} 日数(28〜31)
   */
  function daysInMonth(year, month) {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
  }

  function validDate(y, m, d) {
    if (!isInt(y) || y < MIN_YEAR || y > MAX_YEAR) return false;
    if (!isInt(m) || m < 1 || m > 12) return false;
    if (!isInt(d) || d < 1 || d > daysInMonth(y, m)) return false;
    return true;
  }

  function utc(y, m, d) {
    return Date.UTC(y, m - 1, d);
  }

  function ymd(y, m, d) {
    return y + "-" + (m < 10 ? "0" : "") + m + "-" + (d < 10 ? "0" : "") + d;
  }

  /**
   * 基準日が属する年度・四半期と、年度末までの残り日数を求める
   * @param {number} year 基準日の西暦年(1583〜3000)
   * @param {number} month 基準日の月(1〜12)
   * @param {number} day 基準日の日(1〜その月の末日)
   * @param {number} startMonth 年度の開始月(1〜12)。省略時は4
   * @returns {{ok:true, fiscalYear:number, label:string, quarter:number, quarterLabel:string,
   *            startYmd:string, endYmd:string, quarterStartYmd:string, quarterEndYmd:string,
   *            daysToEnd:number, weekdaysToEnd:number, elapsedDays:number, totalDays:number,
   *            progressPercent:number}
   *          |{ok:false, code:"invalid_date"|"invalid_start_month"}}
   *   fiscalYear: 年度(その年度が始まる西暦年)
   *   daysToEnd: 基準日から年度末までの残り日数(基準日当日は含めない。年度末当日なら0)
   *   weekdaysToEnd: そのうち土日を除いた日数(祝日は含めていない)
   *   elapsedDays: 年度開始日から基準日までの経過日数(開始日当日は1)
   *   progressPercent: 年度の進み具合(%、小数第1位で四捨五入)
   */
  function fiscalYear(year, month, day, startMonth) {
    if (startMonth === undefined) startMonth = 4;
    if (!isInt(startMonth) || startMonth < 1 || startMonth > 12) {
      return { ok: false, code: "invalid_start_month" };
    }
    if (!validDate(year, month, day)) return { ok: false, code: "invalid_date" };

    var fy = month >= startMonth ? year : year - 1;
    var startY = fy;
    var endY = startMonth === 1 ? fy : fy + 1;
    var endMonth = startMonth === 1 ? 12 : startMonth - 1;
    var endDay = daysInMonth(endY, endMonth);

    var offset = (month - startMonth + 12) % 12;
    var quarter = Math.floor(offset / 3) + 1;
    var qStartOffset = (quarter - 1) * 3;
    var qStartMonthRaw = startMonth + qStartOffset;
    var qStartY = startY + Math.floor((qStartMonthRaw - 1) / 12);
    var qStartM = ((qStartMonthRaw - 1) % 12) + 1;
    var qEndMonthRaw = qStartMonthRaw + 2;
    var qEndY = startY + Math.floor((qEndMonthRaw - 1) / 12);
    var qEndM = ((qEndMonthRaw - 1) % 12) + 1;

    var base = utc(year, month, day);
    var startMs = utc(startY, startMonth, 1);
    var endMs = utc(endY, endMonth, endDay);
    var daysToEnd = Math.round((endMs - base) / MS_PER_DAY);
    var totalDays = Math.round((endMs - startMs) / MS_PER_DAY) + 1;
    var elapsedDays = Math.round((base - startMs) / MS_PER_DAY) + 1;

    var weekdays = 0;
    for (var t = base + MS_PER_DAY; t <= endMs; t += MS_PER_DAY) {
      var w = new Date(t).getUTCDay();
      if (w !== 0 && w !== 6) weekdays++;
    }

    return {
      ok: true,
      fiscalYear: fy,
      label: fy + "年度",
      quarter: quarter,
      quarterLabel: "第" + quarter + "四半期",
      startYmd: ymd(startY, startMonth, 1),
      endYmd: ymd(endY, endMonth, endDay),
      quarterStartYmd: ymd(qStartY, qStartM, 1),
      quarterEndYmd: ymd(qEndY, qEndM, daysInMonth(qEndY, qEndM)),
      daysToEnd: daysToEnd,
      weekdaysToEnd: weekdays,
      elapsedDays: elapsedDays,
      totalDays: totalDays,
      progressPercent: Math.round((elapsedDays / totalDays) * 1000) / 10
    };
  }

  /**
   * 年度と四半期の番号から、その四半期の期間を返す
   * @param {number} fy 年度(その年度が始まる西暦年)
   * @param {number} quarter 四半期の番号(1〜4)
   * @param {number} startMonth 年度の開始月(1〜12)。省略時は4
   * @returns {{ok:true, startYmd:string, endYmd:string, days:number}
   *          |{ok:false, code:"invalid_fiscal_year"|"invalid_quarter"|"invalid_start_month"}}
   *   days: その四半期の日数
   */
  function quarterRange(fy, quarter, startMonth) {
    if (startMonth === undefined) startMonth = 4;
    if (!isInt(startMonth) || startMonth < 1 || startMonth > 12) {
      return { ok: false, code: "invalid_start_month" };
    }
    if (!isInt(fy) || fy < MIN_YEAR || fy > MAX_YEAR) {
      return { ok: false, code: "invalid_fiscal_year" };
    }
    if (!isInt(quarter) || quarter < 1 || quarter > 4) {
      return { ok: false, code: "invalid_quarter" };
    }
    var sRaw = startMonth + (quarter - 1) * 3;
    var sY = fy + Math.floor((sRaw - 1) / 12);
    var sM = ((sRaw - 1) % 12) + 1;
    var eRaw = sRaw + 2;
    var eY = fy + Math.floor((eRaw - 1) / 12);
    var eM = ((eRaw - 1) % 12) + 1;
    var eD = daysInMonth(eY, eM);
    return {
      ok: true,
      startYmd: ymd(sY, sM, 1),
      endYmd: ymd(eY, eM, eD),
      days: Math.round((utc(eY, eM, eD) - utc(sY, sM, 1)) / MS_PER_DAY) + 1
    };
  }

  /**
   * 年度を西暦の期間の文字列にする
   * @param {number} fy 年度(その年度が始まる西暦年)
   * @param {number} startMonth 年度の開始月(1〜12)。省略時は4
   * @returns {{ok:true, startYmd:string, endYmd:string, days:number}
   *          |{ok:false, code:"invalid_fiscal_year"|"invalid_start_month"}}
   *   days: その年度の日数(うるう年なら366)
   */
  function fiscalYearRange(fy, startMonth) {
    if (startMonth === undefined) startMonth = 4;
    if (!isInt(startMonth) || startMonth < 1 || startMonth > 12) {
      return { ok: false, code: "invalid_start_month" };
    }
    if (!isInt(fy) || fy < MIN_YEAR || fy > MAX_YEAR) {
      return { ok: false, code: "invalid_fiscal_year" };
    }
    var endY = startMonth === 1 ? fy : fy + 1;
    var endM = startMonth === 1 ? 12 : startMonth - 1;
    var endD = daysInMonth(endY, endM);
    return {
      ok: true,
      startYmd: ymd(fy, startMonth, 1),
      endYmd: ymd(endY, endM, endD),
      days: Math.round((utc(endY, endM, endD) - utc(fy, startMonth, 1)) / MS_PER_DAY) + 1
    };
  }

  var api = {
    fiscalYear: fiscalYear,
    quarterRange: quarterRange,
    fiscalYearRange: fiscalYearRange,
    daysInMonth: daysInMonth
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.NendoCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
