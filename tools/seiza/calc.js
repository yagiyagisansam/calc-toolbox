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

  var api = { lookup: lookup, SIGNS: SIGNS, STONES: STONES };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { global.SeizaCalc = api; }
})(typeof window !== "undefined" ? window : globalThis);
