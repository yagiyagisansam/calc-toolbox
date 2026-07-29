/*
 * 報酬・料金等の源泉徴収税額 の計算ロジック
 *
 * 根拠(一次情報):
 * - 国税庁 タックスアンサー No.2795「原稿料や講演料等を支払ったとき」
 *   https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2795.htm (2026年7月29日参照)
 *   ページ表記の基準時点: 令和7年4月1日現在法令等
 *   ・同一人に対し1回に支払われる金額が100万円以下: 支払金額 × 10.21%
 *   ・100万円を超える場合: (支払金額 − 100万円) × 20.42% + 102,100円
 *   ・求めた税額に1円未満の端数があるときは切り捨てる
 * - 国税庁 タックスアンサー No.2792「源泉徴収が必要な報酬・料金等とは」
 *   https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2792.htm (2026年7月29日参照)
 *   ・消費税等の額が含まれている場合は原則として消費税等を含めた金額が源泉徴収の対象
 *   ・請求書等で報酬・料金等の額と消費税等の額が明確に区分されている場合は、
 *     報酬・料金等の額のみを源泉徴収の対象としても差し支えない
 *
 * 前提:
 * - 原稿料・デザイン料・講演料など「所得税法第204条第1項第1号」の報酬・料金を想定した税率
 *   (司法書士・外交員・ホステス等、別の計算式が定められている報酬は対象外)
 * - 税率10.21%・20.42%は所得税と復興特別所得税を合わせた率
 *   (復興特別所得税は令和19年12月31日までに生ずる所得について課される)
 * - 支払先が法人の場合、原稿料等については源泉徴収を要しないため税額0円として扱う
 * - 金額の丸め: 消費税額は1円未満切捨て、源泉徴収税額は1円未満切捨て
 */
(function (global) {
  "use strict";

  var THRESHOLD = 1000000; // 100万円
  var RATE_LOW = 0.1021; // 10.21%
  var RATE_HIGH = 0.2042; // 20.42%
  var FIXED_ADD = 102100; // 100万円超のときの加算額(円)
  var AMOUNT_MAX = 1e10; // 入力上限 100億円

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  /**
   * 源泉徴収の対象金額から税額を求める。
   * @param {number} targetYen 源泉徴収の対象となる金額(円)。0〜100億
   * @returns {{ok:true, taxYen:number, rate:number, bracket:"low"|"high"}
   *          |{ok:false, code:"invalid_target"}}
   *   taxYen は1円未満を切り捨てた税額。bracket は "low"=100万円以下 / "high"=100万円超。
   */
  function withholding(targetYen) {
    if (!isFiniteNumber(targetYen) || targetYen < 0 || targetYen > AMOUNT_MAX) {
      return { ok: false, code: "invalid_target" };
    }
    if (targetYen <= THRESHOLD) {
      return { ok: true, taxYen: Math.floor(targetYen * RATE_LOW), rate: RATE_LOW, bracket: "low" };
    }
    return {
      ok: true,
      taxYen: Math.floor((targetYen - THRESHOLD) * RATE_HIGH + FIXED_ADD),
      rate: RATE_HIGH,
      bracket: "high"
    };
  }

  /**
   * 報酬額から、消費税・源泉徴収税額・手取りをまとめて計算する。
   * @param {number} rewardYen 報酬額(消費税抜き、円)。0〜100億
   * @param {number} [consumptionTaxRatePercent=10] 消費税率(%)。0〜100
   * @param {boolean} [separated=true] 請求書で報酬額と消費税額を区分表示しているか
   *   true なら税抜の報酬額のみを源泉徴収の対象にする。false なら税込金額を対象にする。
   * @param {boolean} [isCorporation=false] 支払先が法人か(法人なら原稿料等は源泉徴収不要)
   * @returns {{ok:true, rewardYen:number, consumptionTaxYen:number, grossYen:number,
   *            targetYen:number, taxYen:number, netPayYen:number, rate:number, bracket:string}
   *          |{ok:false, code:"invalid_reward"|"invalid_tax_rate"|"invalid_target"}}
   */
  function calculate(rewardYen, consumptionTaxRatePercent, separated, isCorporation) {
    var ctRate = consumptionTaxRatePercent === undefined ? 10 : consumptionTaxRatePercent;
    var sep = separated === undefined ? true : separated === true;
    if (!isFiniteNumber(rewardYen) || rewardYen < 0 || rewardYen > AMOUNT_MAX) {
      return { ok: false, code: "invalid_reward" };
    }
    if (!isFiniteNumber(ctRate) || ctRate < 0 || ctRate > 100) {
      return { ok: false, code: "invalid_tax_rate" };
    }
    var consumptionTaxYen = Math.floor((rewardYen * ctRate) / 100);
    var grossYen = rewardYen + consumptionTaxYen;
    var targetYen = sep ? rewardYen : grossYen;
    var w = withholding(targetYen);
    if (!w.ok) return w;
    var taxYen = isCorporation === true ? 0 : w.taxYen;
    return {
      ok: true,
      rewardYen: rewardYen,
      consumptionTaxYen: consumptionTaxYen,
      grossYen: grossYen,
      targetYen: targetYen,
      taxYen: taxYen,
      netPayYen: grossYen - taxYen,
      rate: w.rate,
      bracket: w.bracket
    };
  }

  /**
   * 手取り(振込額)から、税抜の報酬額を逆算する。
   * 端数切捨てがあるため、手取りが指定額以上になる最小の報酬額を整数円で探す。
   * @param {number} netPayYen 希望する手取り額(円)。1〜100億
   * @param {number} [consumptionTaxRatePercent=10] 消費税率(%)。0〜100
   * @param {boolean} [separated=true] 請求書で報酬額と消費税額を区分表示しているか
   * @param {boolean} [isCorporation=false] 支払先が法人か
   * @returns {{ok:true, rewardYen:number, consumptionTaxYen:number, grossYen:number,
   *            taxYen:number, netPayYen:number, exact:boolean}
   *          |{ok:false, code:"invalid_net_pay"|"invalid_tax_rate"|"not_found"}}
   *   exact は手取りがちょうど一致したかどうか。
   */
  function reverseFromNetPay(netPayYen, consumptionTaxRatePercent, separated, isCorporation) {
    var ctRate = consumptionTaxRatePercent === undefined ? 10 : consumptionTaxRatePercent;
    if (!isFiniteNumber(netPayYen) || netPayYen <= 0 || netPayYen > AMOUNT_MAX) {
      return { ok: false, code: "invalid_net_pay" };
    }
    if (!isFiniteNumber(ctRate) || ctRate < 0 || ctRate > 100) {
      return { ok: false, code: "invalid_tax_rate" };
    }
    var lo = 1;
    var hi = Math.ceil(netPayYen * 2) + 10;
    if (hi > AMOUNT_MAX) return { ok: false, code: "not_found" };
    function net(x) {
      var r = calculate(x, ctRate, separated, isCorporation);
      return r.ok ? r.netPayYen : Infinity;
    }
    if (net(hi) < netPayYen) return { ok: false, code: "not_found" };
    while (lo < hi) {
      var mid = Math.floor((lo + hi) / 2);
      if (net(mid) >= netPayYen) hi = mid; else lo = mid + 1;
    }
    var res = calculate(lo, ctRate, separated, isCorporation);
    res.exact = res.netPayYen === netPayYen;
    return res;
  }

  var api = {
    THRESHOLD: THRESHOLD,
    RATE_LOW: RATE_LOW,
    RATE_HIGH: RATE_HIGH,
    withholding: withholding,
    calculate: calculate,
    reverseFromNetPay: reverseFromNetPay
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.GensenCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
