/*
 * 固定資産税・都市計画税(土地・家屋)の概算ロジック
 *
 * 根拠(一次情報):
 * - 総務省「地方税制度|固定資産税」 https://www.soumu.go.jp/main_sosiki/jichi_zeisei/czaisei/czaisei_seido/150790_15.html (2026年7月29日参照)
 *   税率は原則1.4%。住宅用地は200m2以下の部分の課税標準が価格の6分の1、
 *   200m2を超える部分は3分の1。新築住宅は一般住宅3年度分・3階建以上の耐火住宅5年度分、
 *   居住部分の床面積120m2までを限度に2分の1を減額(令和13年3月31日までの新築)。
 * - 総務省「地方税制度|固定資産税の概要」 https://www.soumu.go.jp/main_sosiki/jichi_zeisei/czaisei/czaisei_seido/149767_08.html (2026年7月29日参照)
 *   標準税率1.4%。免税点は 土地30万円・家屋20万円・償却資産150万円
 *   (令和9年度以後の年度分は 土地30万円・家屋30万円・償却資産180万円)。
 * - 地方税法(昭和25年法律第226号) https://laws.e-gov.go.jp/law/325AC0000000226 (2026年7月29日参照)
 *   第350条(固定資産税の標準税率 100分の1.4)、第349条の3の2(住宅用地の課税標準の特例 1/6・1/3)、
 *   第702条の3(住宅用地等に対する都市計画税の課税標準の特例 1/3・2/3)、
 *   第702条の4(都市計画税の税率は100分の0.3を超えることができない)。
 *
 * 制度・料率の時点:
 * - 税率・特例・免税点はいずれも 2026(令和8)年7月29日時点の現行規定。
 * - 家屋の免税点は令和8年度時点の20万円を既定とする(令和9年度以後は30万円に変わる)。
 *
 * 前提:
 * - 土地は全体が住宅用地(住宅の敷地)であるとして特例を適用する。非住宅用地は特例なしを選べる。
 * - 土地の課税標準は「評価額 × 特例割合」で計算し、負担調整措置(前年度課税標準との比較で
 *   なだらかに上昇させる仕組み)は考慮しない。実際の税額はこれより低くなることが多い。
 * - 償却資産、区分所有マンションの敷地按分、市町村独自の減免は扱わない。
 * - 課税標準額は1,000円未満切捨て、税額は100円未満切捨て(地方税法第20条の4の2)。
 */
(function (global) {
  "use strict";

  var FIXED_RATE = 1.4;              // 固定資産税の標準税率(%)
  var CITY_RATE = 0.3;               // 都市計画税の制限税率(%)
  var SMALL_AREA_PER_UNIT = 200;     // 小規模住宅用地の上限面積(m2/戸)
  var FIXED_SMALL = 1 / 6;           // 固定資産税 小規模住宅用地の特例
  var FIXED_GENERAL = 1 / 3;         // 固定資産税 一般住宅用地の特例
  var CITY_SMALL = 1 / 3;            // 都市計画税 小規模住宅用地の特例
  var CITY_GENERAL = 2 / 3;          // 都市計画税 一般住宅用地の特例
  var EXEMPT_LAND = 300000;          // 免税点(土地)
  var EXEMPT_BUILDING = 200000;      // 免税点(家屋。令和8年度時点)

  var MAX_VALUE = 100000000000;      // 評価額の上限(1,000億円)
  var MAX_AREA = 1000000;            // 面積の上限(m2)
  var MAX_UNITS = 1000;

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function floorTo(value, unit) {
    return Math.floor(value / unit) * unit;
  }

  /**
   * 住宅用地の特例を適用した後の土地の課税標準額を求める。
   * @param {number} landValueYen 土地の評価額(円。0以上)
   * @param {number} landAreaM2 土地の面積(m2。0より大きい。residential=false のときは0でもよい)
   * @param {number} units 住戸の数(1以上の整数)
   * @param {boolean} residential 住宅用地の特例を適用するか
   * @param {number} smallRate 小規模住宅用地の特例割合
   * @param {number} generalRate 一般住宅用地の特例割合
   * @returns {number} 端数処理前の課税標準額(円)
   */
  function landBase(landValueYen, landAreaM2, units, residential, smallRate, generalRate) {
    if (!residential || landAreaM2 <= 0) return landValueYen;
    var smallArea = Math.min(landAreaM2, SMALL_AREA_PER_UNIT * units);
    var generalArea = landAreaM2 - smallArea;
    var perM2 = landValueYen / landAreaM2;
    return perM2 * smallArea * smallRate + perM2 * generalArea * generalRate;
  }

  /**
   * 固定資産税・都市計画税の年税額を概算する(標準的な条件)。
   * @param {number} landValueYen 土地の評価額(円。0以上)
   * @param {number} buildingValueYen 家屋の評価額(円。0以上)
   * @param {number} landAreaM2 土地の面積(m2。0以上)
   * @param {boolean} [hasCityPlanningTax=false] 都市計画税が課される区域か
   * @returns {{ok:true, landBaseYen:number, buildingBaseYen:number,
   *            fixedTaxYen:number, cityTaxYen:number, totalYen:number,
   *            monthlyYen:number, landExempt:boolean, buildingExempt:boolean}
   *          |{ok:false, code:string}}
   *   住戸1戸・標準税率(固定1.4%・都計0.3%)・住宅用地の特例あり・新築減額なしで計算する。
   */
  function calculate(landValueYen, buildingValueYen, landAreaM2, hasCityPlanningTax) {
    return calculateDetailed(landValueYen, buildingValueYen, landAreaM2, hasCityPlanningTax,
      1, FIXED_RATE, CITY_RATE, true, false);
  }

  /**
   * 条件を指定して固定資産税・都市計画税の年税額を概算する。
   * @param {number} landValueYen 土地の評価額(円。0以上1,000億円以下)
   * @param {number} buildingValueYen 家屋の評価額(円。0以上1,000億円以下)
   * @param {number} landAreaM2 土地の面積(m2。0以上100万以下)
   * @param {boolean} [hasCityPlanningTax=false] 都市計画税が課される区域か
   * @param {number} [units=1] 住戸の数(1〜1000の整数。小規模住宅用地は200m2×戸数まで)
   * @param {number} [fixedRatePercent=1.4] 固定資産税の税率(%。0〜10)
   * @param {number} [cityRatePercent=0.3] 都市計画税の税率(%。0〜0.3)
   * @param {boolean} [residential=true] 住宅用地の特例を適用するか
   * @param {boolean} [newHouseReduction=false] 新築住宅の減額(家屋の固定資産税を2分の1)を適用するか
   * @returns {{ok:true, landBaseYen:number, buildingBaseYen:number,
   *            cityLandBaseYen:number, fixedTaxYen:number, cityTaxYen:number,
   *            totalYen:number, monthlyYen:number, landExempt:boolean, buildingExempt:boolean}
   *          |{ok:false, code:"invalid_land_value"|"invalid_building_value"|"invalid_area"|"invalid_units"|"invalid_fixed_rate"|"invalid_city_rate"}}
   *   landBaseYen/buildingBaseYen/cityLandBaseYen は1,000円未満切捨て後の課税標準額。
   *   fixedTaxYen/cityTaxYen は100円未満切捨て後の年税額。
   *   landExempt/buildingExempt は免税点(土地30万円・家屋20万円)未満で課税されない場合に true。
   *   monthlyYen は総額÷12を小数第1位で四捨五入した参考値。
   */
  function calculateDetailed(landValueYen, buildingValueYen, landAreaM2, hasCityPlanningTax,
                             units, fixedRatePercent, cityRatePercent, residential, newHouseReduction) {
    var u = units === undefined || units === null ? 1 : units;
    var fr = fixedRatePercent === undefined || fixedRatePercent === null ? FIXED_RATE : fixedRatePercent;
    var cr = cityRatePercent === undefined || cityRatePercent === null ? CITY_RATE : cityRatePercent;
    var res = residential === undefined || residential === null ? true : !!residential;
    var reduce = !!newHouseReduction;
    var city = !!hasCityPlanningTax;

    if (!isFiniteNumber(landValueYen) || landValueYen < 0 || landValueYen > MAX_VALUE) {
      return { ok: false, code: "invalid_land_value" };
    }
    if (!isFiniteNumber(buildingValueYen) || buildingValueYen < 0 || buildingValueYen > MAX_VALUE) {
      return { ok: false, code: "invalid_building_value" };
    }
    if (!isFiniteNumber(landAreaM2) || landAreaM2 < 0 || landAreaM2 > MAX_AREA) {
      return { ok: false, code: "invalid_area" };
    }
    if (!isFiniteNumber(u) || u < 1 || u > MAX_UNITS || Math.floor(u) !== u) {
      return { ok: false, code: "invalid_units" };
    }
    if (!isFiniteNumber(fr) || fr < 0 || fr > 10) return { ok: false, code: "invalid_fixed_rate" };
    if (!isFiniteNumber(cr) || cr < 0 || cr > CITY_RATE) return { ok: false, code: "invalid_city_rate" };

    var landFixed = floorTo(landBase(landValueYen, landAreaM2, u, res, FIXED_SMALL, FIXED_GENERAL), 1000);
    var landCity = floorTo(landBase(landValueYen, landAreaM2, u, res, CITY_SMALL, CITY_GENERAL), 1000);
    var buildingBase = floorTo(buildingValueYen, 1000);

    var landExempt = landFixed > 0 && landFixed < EXEMPT_LAND;
    var buildingExempt = buildingBase > 0 && buildingBase < EXEMPT_BUILDING;
    var landFixedTaxed = landExempt ? 0 : landFixed;
    var landCityTaxed = landExempt ? 0 : landCity;
    var buildingTaxed = buildingExempt ? 0 : buildingBase;

    var fixedTax = floorTo(
      landFixedTaxed * fr / 100 + buildingTaxed * fr / 100 * (reduce ? 0.5 : 1), 100);
    var cityTax = city ? floorTo((landCityTaxed + buildingTaxed) * cr / 100, 100) : 0;
    var total = fixedTax + cityTax;

    return {
      ok: true,
      landBaseYen: landFixed,
      buildingBaseYen: buildingBase,
      cityLandBaseYen: landCity,
      fixedTaxYen: fixedTax,
      cityTaxYen: cityTax,
      totalYen: total,
      monthlyYen: Math.round(total / 12 * 10) / 10,
      landExempt: landExempt,
      buildingExempt: buildingExempt
    };
  }

  var api = {
    calculate: calculate,
    calculateDetailed: calculateDetailed
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.KoteishisanCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
