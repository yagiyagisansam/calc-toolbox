/*
 * 年次有給休暇の付与日数 計算ロジック
 *
 * 付与日数表の根拠(一次情報):
 * - 労働基準法 第39条 https://laws.e-gov.go.jp/law/322AC0000000049
 * - 比例付与の日数: 労働基準法施行規則 第24条の3
 *   https://laws.e-gov.go.jp/law/322M40000100023
 * - 表の数値は厚生労働省(愛媛労働局)「年次有給休暇に関するQ&A」から転記(2026-07-18参照)
 *   https://jsite.mhlw.go.jp/ehime-roudoukyoku/yokuaru_goshitsumon/shurouchu/2040202.html
 *
 * 前提(ページにも明記):
 * - 付与には「雇入れから6ヶ月継続勤務」かつ「全労働日の8割以上出勤」が必要
 * - 通常の労働者 = 週所定労働時間30時間以上、または週所定労働日数5日以上
 * - 比例付与 = 週30時間未満かつ週4日以下(年216日以下)のパート等
 */
(function (global) {
  "use strict";

  // 勤続年数の区分: [0]=6ヶ月 [1]=1年6ヶ月 ... [6]=6年6ヶ月以上
  var SERVICE_LABELS = ["6ヶ月", "1年6ヶ月", "2年6ヶ月", "3年6ヶ月", "4年6ヶ月", "5年6ヶ月", "6年6ヶ月以上"];

  var GRANT_TABLE = {
    full: [10, 11, 12, 14, 16, 18, 20],
    d4: [7, 8, 9, 10, 12, 13, 15],
    d3: [5, 6, 6, 8, 9, 10, 11],
    d2: [3, 4, 4, 5, 6, 6, 7],
    d1: [1, 2, 2, 2, 3, 3, 3]
  };

  /**
   * 有給休暇の付与日数を求める。
   * @param {string} workerType "full"(通常) | "d4" | "d3" | "d2" | "d1"(週所定労働日数)
   * @param {number} serviceStep 勤続区分(0=6ヶ月 〜 6=6年6ヶ月以上)
   * @returns {{ok: true, days: number, serviceLabel: string, obligation5days: boolean}
   *          |{ok: false, code: string}}
   *   obligation5days: 年5日の時季指定義務の対象(付与日数10日以上)か
   *   code: "invalid_worker_type" | "invalid_service"
   */
  function grantedDays(workerType, serviceStep) {
    if (!(workerType in GRANT_TABLE)) {
      return { ok: false, code: "invalid_worker_type" };
    }
    if (typeof serviceStep !== "number" || serviceStep !== Math.floor(serviceStep) ||
        serviceStep < 0 || serviceStep > 6) {
      return { ok: false, code: "invalid_service" };
    }
    var days = GRANT_TABLE[workerType][serviceStep];
    return {
      ok: true,
      days: days,
      serviceLabel: SERVICE_LABELS[serviceStep],
      obligation5days: days >= 10
    };
  }

  var api = {
    grantedDays: grantedDays,
    SERVICE_LABELS: SERVICE_LABELS,
    GRANT_TABLE: GRANT_TABLE
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.YukyuCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
