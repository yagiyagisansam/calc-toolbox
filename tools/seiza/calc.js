/*
 * 星座・誕生石判定ロジック
 *
 * 判定方法:
 * - 12星座は一般的に使われる日付区分(例: おひつじ座 3/21〜4/19)で判定
 *   ※境界日は年により1日前後することがある(ページに明記)
 * - 誕生石は月ごとの代表的な宝石(全国宝石卸商協同組合の選定を参考にした主要石)
 */
(function (global) {
  "use strict";

  // [開始月, 開始日, 星座名, 英語名] 開始日順
  var SIGNS = [
    [1, 20, "みずがめ座", "Aquarius"],
    [2, 19, "うお座", "Pisces"],
    [3, 21, "おひつじ座", "Aries"],
    [4, 20, "おうし座", "Taurus"],
    [5, 21, "ふたご座", "Gemini"],
    [6, 22, "かに座", "Cancer"],
    [7, 23, "しし座", "Leo"],
    [8, 23, "おとめ座", "Virgo"],
    [9, 23, "てんびん座", "Libra"],
    [10, 24, "さそり座", "Scorpio"],
    [11, 23, "いて座", "Sagittarius"],
    [12, 22, "やぎ座", "Capricorn"]
  ];
  var STONES = ["ガーネット", "アメシスト", "アクアマリン", "ダイヤモンド", "エメラルド", "パール(真珠)",
    "ルビー", "ペリドット", "サファイア", "オパール", "トパーズ", "ターコイズ(トルコ石)"];
  var DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  /**
   * 誕生日から星座と誕生石を判定する。
   * @param {number} month 月(1〜12)
   * @param {number} day 日
   * @returns {{ok: true, sign: string, signEn: string, stone: string}
   *          |{ok: false, code: string}}  code: "invalid_date"
   */
  function lookup(month, day) {
    if (typeof month !== "number" || month !== Math.floor(month) || month < 1 || month > 12) {
      return { ok: false, code: "invalid_date" };
    }
    if (typeof day !== "number" || day !== Math.floor(day) || day < 1 || day > DAYS_IN_MONTH[month - 1]) {
      return { ok: false, code: "invalid_date" };
    }
    // 該当する開始日以降で最後のものを選ぶ(1/1〜1/19 は前年12/22開始のやぎ座)
    var sign = SIGNS[SIGNS.length - 1];
    for (var i = 0; i < SIGNS.length; i++) {
      if (month > SIGNS[i][0] || (month === SIGNS[i][0] && day >= SIGNS[i][1])) sign = SIGNS[i];
    }
    return { ok: true, sign: sign[2], signEn: sign[3], stone: STONES[month - 1] };
  }

  /**
   * 生まれ年も入れた誕生日の詳細判定。
   * - 曜日はツェラーの公式(グレゴリオ暦)で計算:
   *   h = (q + floor(13(m+1)/5) + K + floor(K/4) + floor(J/4) + 5J) mod 7
   *   (1・2月は前年の13・14月として扱う。h=0が土曜)
   * - 星座は lookup と同じ日付区分。境界日(カスプ)の前後1日以内なら、
   *   生まれ年・時刻により隣の星座になる可能性がある旨を cusp で返す。
   * - うるう年判定(2/29の実在チェック)も行う。
   * @param {number} year 生まれ年(西暦1600〜2200)
   * @param {number} month 月(1〜12)
   * @param {number} day 日
   * @returns {{ok:true, youbi:string, dow:number, sign:string, signEn:string, stone:string,
   *            cusp:(null|{otherSign:string, otherSignEn:string, boundaryM:number, boundaryD:number})}
   *          |{ok:false, code:string}}
   *   dow: 0=日曜〜6=土曜 / code: "invalid_date"
   */
  function detail(year, month, day) {
    if (typeof year !== "number" || year !== Math.floor(year) || year < 1600 || year > 2200) {
      return { ok: false, code: "invalid_date" };
    }
    var base = lookup(month, day);
    if (!base.ok) return base;
    var leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    if (month === 2 && day === 29 && !leap) {
      return { ok: false, code: "invalid_date" };
    }
    // ツェラーの公式
    var q = day;
    var m = month;
    var y = year;
    if (m <= 2) { m += 12; y -= 1; }
    var K = y % 100;
    var J = Math.floor(y / 100);
    var h = (q + Math.floor(13 * (m + 1) / 5) + K + Math.floor(K / 4) + Math.floor(J / 4) + 5 * J) % 7;
    var dow = (h + 6) % 7; // 0=日曜
    var NAMES = ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"];
    // カスプ判定: 境界日(各星座の開始日)の前後1日以内
    var cusp = null;
    for (var i = 0; i < SIGNS.length; i++) {
      var sM = SIGNS[i][0];
      var sD = SIGNS[i][1];
      if (month === sM && Math.abs(day - sD) <= 1) {
        var prev = SIGNS[(i + SIGNS.length - 1) % SIGNS.length];
        var next = SIGNS[i];
        var other = day < sD ? next : prev; // 境界の反対側の星座
        cusp = { otherSign: other[2], otherSignEn: other[3], boundaryM: sM, boundaryD: sD };
        break;
      }
    }
    return {
      ok: true,
      youbi: NAMES[dow],
      dow: dow,
      sign: base.sign,
      signEn: base.signEn,
      stone: base.stone,
      cusp: cusp
    };
  }

  var api = {
    detail: detail, lookup: lookup, SIGNS: SIGNS, STONES: STONES };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { global.SeizaCalc = api; }
})(typeof window !== "undefined" ? window : globalThis);
