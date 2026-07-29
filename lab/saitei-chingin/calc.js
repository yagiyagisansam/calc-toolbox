/*
 * 最低賃金チェック(月給・日給を時給換算) 計算ロジック
 *
 * 根拠(一次情報):
 * - 厚生労働省「地域別最低賃金の全国一覧」
 *   https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/koyou_roudou/roudoukijun/minimumichiran/
 *   掲載の「令和7年度 地域別最低賃金全国一覧」(PDF)
 *   https://www.mhlw.go.jp/content/11200000/001571192.pdf (2026年7月29日参照)
 *   ※本ファイルの金額は令和7年度改定額(全国加重平均1,121円)。発効日は都道府県ごとに異なり、
 *     最も遅い秋田県で令和8年3月31日発効。2026年7月時点では全都道府県で発効済み。
 * - 最低賃金法(昭和34年法律第137号) https://laws.e-gov.go.jp/law/334AC0000000137
 * - 最低賃金法施行規則 https://laws.e-gov.go.jp/law/334M50002000016
 *   第1条: 最低賃金の対象から除外する賃金(臨時に支払われる賃金、1か月を超える期間ごとに
 *   支払われる賃金、時間外・休日・深夜の割増賃金)。第1条の2で精皆勤手当・通勤手当・家族手当も除外。
 *
 * 前提:
 * - 判定するのは「地域別最低賃金」のみ。特定(産業別)最低賃金には対応しない。
 * - 月給制の時間換算は「(月給 − 除外する賃金) ÷ 1か月平均所定労働時間」。
 * - 日給制の時間換算は「(日給 − 除外する賃金) ÷ 1日の所定労働時間」。
 * - 比較は円未満を切り捨てずに行う(時間換算額が最低賃金額を1円でも下回れば未達と判定)。
 */
(function (global) {
  "use strict";

  // 令和7年度 地域別最低賃金(時間額・円)と発効日
  var PREFECTURES = [
    ["hokkaido", "北海道", 1075, "2025-10-04"],
    ["aomori", "青森", 1029, "2025-11-21"],
    ["iwate", "岩手", 1031, "2025-12-01"],
    ["miyagi", "宮城", 1038, "2025-10-04"],
    ["akita", "秋田", 1031, "2026-03-31"],
    ["yamagata", "山形", 1032, "2025-12-23"],
    ["fukushima", "福島", 1033, "2026-01-01"],
    ["ibaraki", "茨城", 1074, "2025-10-12"],
    ["tochigi", "栃木", 1068, "2025-10-01"],
    ["gunma", "群馬", 1063, "2026-03-01"],
    ["saitama", "埼玉", 1141, "2025-11-01"],
    ["chiba", "千葉", 1140, "2025-10-03"],
    ["tokyo", "東京", 1226, "2025-10-03"],
    ["kanagawa", "神奈川", 1225, "2025-10-04"],
    ["niigata", "新潟", 1050, "2025-10-02"],
    ["toyama", "富山", 1062, "2025-10-12"],
    ["ishikawa", "石川", 1054, "2025-10-08"],
    ["fukui", "福井", 1053, "2025-10-08"],
    ["yamanashi", "山梨", 1052, "2025-12-01"],
    ["nagano", "長野", 1061, "2025-10-03"],
    ["gifu", "岐阜", 1065, "2025-10-18"],
    ["shizuoka", "静岡", 1097, "2025-11-01"],
    ["aichi", "愛知", 1140, "2025-10-18"],
    ["mie", "三重", 1087, "2025-11-21"],
    ["shiga", "滋賀", 1080, "2025-10-05"],
    ["kyoto", "京都", 1122, "2025-11-21"],
    ["osaka", "大阪", 1177, "2025-10-16"],
    ["hyogo", "兵庫", 1116, "2025-10-04"],
    ["nara", "奈良", 1051, "2025-11-16"],
    ["wakayama", "和歌山", 1045, "2025-11-01"],
    ["tottori", "鳥取", 1030, "2025-10-04"],
    ["shimane", "島根", 1033, "2025-11-17"],
    ["okayama", "岡山", 1047, "2025-12-01"],
    ["hiroshima", "広島", 1085, "2025-11-01"],
    ["yamaguchi", "山口", 1043, "2025-10-16"],
    ["tokushima", "徳島", 1046, "2026-01-01"],
    ["kagawa", "香川", 1036, "2025-10-18"],
    ["ehime", "愛媛", 1033, "2025-12-01"],
    ["kochi", "高知", 1023, "2025-12-01"],
    ["fukuoka", "福岡", 1057, "2025-11-16"],
    ["saga", "佐賀", 1030, "2025-11-21"],
    ["nagasaki", "長崎", 1031, "2025-12-01"],
    ["kumamoto", "熊本", 1034, "2026-01-01"],
    ["oita", "大分", 1035, "2026-01-01"],
    ["miyazaki", "宮崎", 1023, "2025-11-16"],
    ["kagoshima", "鹿児島", 1026, "2025-11-01"],
    ["okinawa", "沖縄", 1023, "2025-12-01"]
  ];

  var FISCAL_YEAR_LABEL = "令和7年度";
  var NATIONAL_AVERAGE = 1121; // 全国加重平均額(円)

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function round2(v) {
    return Math.round(v * 100) / 100;
  }

  function findPref(code) {
    for (var i = 0; i < PREFECTURES.length; i++) {
      if (PREFECTURES[i][0] === code) return PREFECTURES[i];
    }
    return null;
  }

  /**
   * 都道府県の一覧(コード・名称・最低賃金額・発効日)を返す。
   * @returns {Array<{code:string, name:string, wage:number, effective:string}>}
   */
  function prefectures() {
    return PREFECTURES.map(function (p) {
      return { code: p[0], name: p[1], wage: p[2], effective: p[3] };
    });
  }

  /**
   * 1か月平均所定労働時間を求める。
   * 1か月平均所定労働時間 = 1日の所定労働時間 × 年間所定労働日数 ÷ 12
   * @param {number} dailyHours 1日の所定労働時間(時間、0超24以下)
   * @param {number} annualWorkDays 年間所定労働日数(日、1以上366以下)
   * @returns {{ok:true, monthlyHours:number}|{ok:false, code:"invalid_daily_hours"|"invalid_work_days"}}
   *   monthlyHoursは小数第2位で四捨五入
   */
  function averageMonthlyHours(dailyHours, annualWorkDays) {
    if (!isFiniteNumber(dailyHours) || dailyHours <= 0 || dailyHours > 24) {
      return { ok: false, code: "invalid_daily_hours" };
    }
    if (!isFiniteNumber(annualWorkDays) || annualWorkDays <= 0 || annualWorkDays > 366) {
      return { ok: false, code: "invalid_work_days" };
    }
    return { ok: true, monthlyHours: round2(dailyHours * annualWorkDays / 12) };
  }

  function judge(hourly, pref) {
    var min = pref[2];
    var diff = round2(hourly - min);
    return {
      ok: true,
      hourly: round2(hourly),
      prefectureCode: pref[0],
      prefectureName: pref[1],
      minimumWage: min,
      effective: pref[3],
      fiscalYearLabel: FISCAL_YEAR_LABEL,
      meets: hourly >= min,
      diff: diff
    };
  }

  /**
   * 月給を時給に換算し、地域別最低賃金を満たすか判定する。
   * 時間換算額 = (月給 − 除外する賃金) ÷ 1か月平均所定労働時間
   * @param {number} monthlyWage 月給(円、0以上1億円以下)。基本給と諸手当の合計
   * @param {number} excluded 最低賃金の対象にならない賃金の合計(円、0以上)。
   *   精皆勤手当・通勤手当・家族手当・時間外/休日/深夜の割増賃金など
   * @param {number} monthlyHours 1か月平均所定労働時間(時間、0超744以下)
   * @param {string} prefectureCode 都道府県コード(例: "tokyo")
   * @returns {{ok:true, hourly:number, prefectureCode:string, prefectureName:string,
   *            minimumWage:number, effective:string, fiscalYearLabel:string,
   *            meets:boolean, diff:number, base:number}
   *          |{ok:false, code:"invalid_wage"|"invalid_excluded"|"invalid_hours"
   *                          |"invalid_prefecture"|"excluded_over_wage"}}
   *   hourly は時間換算額(円、小数第2位で四捨五入)。diff は時間換算額 − 最低賃金額。
   */
  function checkMonthly(monthlyWage, excluded, monthlyHours, prefectureCode) {
    if (excluded === undefined || excluded === null) excluded = 0;
    if (!isFiniteNumber(monthlyWage) || monthlyWage < 0 || monthlyWage > 100000000) {
      return { ok: false, code: "invalid_wage" };
    }
    if (!isFiniteNumber(excluded) || excluded < 0 || excluded > 100000000) {
      return { ok: false, code: "invalid_excluded" };
    }
    if (!isFiniteNumber(monthlyHours) || monthlyHours <= 0 || monthlyHours > 744) {
      return { ok: false, code: "invalid_hours" };
    }
    var pref = findPref(prefectureCode);
    if (!pref) return { ok: false, code: "invalid_prefecture" };
    if (excluded > monthlyWage) return { ok: false, code: "excluded_over_wage" };

    var base = monthlyWage - excluded;
    var r = judge(base / monthlyHours, pref);
    r.base = round2(base);
    return r;
  }

  /**
   * 日給を時給に換算し、地域別最低賃金を満たすか判定する。
   * 時間換算額 = (日給 − 除外する賃金) ÷ 1日の所定労働時間
   * @param {number} dailyWage 日給(円、0以上1000万円以下)
   * @param {number} excluded 最低賃金の対象にならない賃金(円、0以上)
   * @param {number} dailyHours 1日の所定労働時間(時間、0超24以下)
   * @param {string} prefectureCode 都道府県コード
   * @returns {{ok:true, hourly:number, minimumWage:number, meets:boolean, diff:number, base:number}
   *          |{ok:false, code:"invalid_wage"|"invalid_excluded"|"invalid_hours"
   *                          |"invalid_prefecture"|"excluded_over_wage"}}
   */
  function checkDaily(dailyWage, excluded, dailyHours, prefectureCode) {
    if (excluded === undefined || excluded === null) excluded = 0;
    if (!isFiniteNumber(dailyWage) || dailyWage < 0 || dailyWage > 10000000) {
      return { ok: false, code: "invalid_wage" };
    }
    if (!isFiniteNumber(excluded) || excluded < 0 || excluded > 10000000) {
      return { ok: false, code: "invalid_excluded" };
    }
    if (!isFiniteNumber(dailyHours) || dailyHours <= 0 || dailyHours > 24) {
      return { ok: false, code: "invalid_hours" };
    }
    var pref = findPref(prefectureCode);
    if (!pref) return { ok: false, code: "invalid_prefecture" };
    if (excluded > dailyWage) return { ok: false, code: "excluded_over_wage" };

    var base = dailyWage - excluded;
    var r = judge(base / dailyHours, pref);
    r.base = round2(base);
    return r;
  }

  /**
   * 時給をそのまま最低賃金と比べる。
   * @param {number} hourlyWage 時給(円、0以上100万円以下)
   * @param {string} prefectureCode 都道府県コード
   * @returns {{ok:true, hourly:number, minimumWage:number, meets:boolean, diff:number}
   *          |{ok:false, code:"invalid_wage"|"invalid_prefecture"}}
   */
  function checkHourly(hourlyWage, prefectureCode) {
    if (!isFiniteNumber(hourlyWage) || hourlyWage < 0 || hourlyWage > 1000000) {
      return { ok: false, code: "invalid_wage" };
    }
    var pref = findPref(prefectureCode);
    if (!pref) return { ok: false, code: "invalid_prefecture" };
    return judge(hourlyWage, pref);
  }

  /**
   * 最低賃金を満たすために必要な月給の下限を求める。
   * @param {number} monthlyHours 1か月平均所定労働時間(時間)
   * @param {string} prefectureCode 都道府県コード
   * @returns {{ok:true, requiredMonthly:number, minimumWage:number, prefectureName:string}
   *          |{ok:false, code:"invalid_hours"|"invalid_prefecture"}}
   *   requiredMonthly は円未満を切り上げた金額(1円未満でも下回ると違反になるため)
   */
  function requiredMonthlyWage(monthlyHours, prefectureCode) {
    if (!isFiniteNumber(monthlyHours) || monthlyHours <= 0 || monthlyHours > 744) {
      return { ok: false, code: "invalid_hours" };
    }
    var pref = findPref(prefectureCode);
    if (!pref) return { ok: false, code: "invalid_prefecture" };
    return {
      ok: true,
      requiredMonthly: Math.ceil(pref[2] * monthlyHours - 1e-9),
      minimumWage: pref[2],
      prefectureName: pref[1]
    };
  }

  var api = {
    prefectures: prefectures,
    averageMonthlyHours: averageMonthlyHours,
    checkMonthly: checkMonthly,
    checkDaily: checkDaily,
    checkHourly: checkHourly,
    requiredMonthlyWage: requiredMonthlyWage,
    FISCAL_YEAR_LABEL: FISCAL_YEAR_LABEL,
    NATIONAL_AVERAGE: NATIONAL_AVERAGE
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.SaiteiChinginCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
