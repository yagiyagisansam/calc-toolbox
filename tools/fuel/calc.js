/*
 * ガソリン代・燃費 計算ロジック
 *
 * 計算式:
 * - 使用燃料(L) = 走行距離(km) ÷ 燃費(km/L)
 * - ガソリン代(円) = 使用燃料(L) × ガソリン単価(円/L)
 *
 * 前提(ページにも明記):
 * - カタログ燃費(WLTCモード等)と実燃費は運転条件により異なるため概算
 * - 使用燃料は小数第2位、金額は円未満を四捨五入
 */
(function (global) {
  "use strict";

  var DISTANCE_MIN_KM = 0.1;
  var DISTANCE_MAX_KM = 10000;
  var EFFICIENCY_MIN = 1;
  var EFFICIENCY_MAX = 60;
  var PRICE_MIN = 50;
  var PRICE_MAX = 500;

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  /**
   * ガソリン代を計算する。
   * @param {number} distanceKm 走行距離(km)
   * @param {number} kmPerL 燃費(km/L)
   * @param {number} pricePerL ガソリン単価(円/L)
   * @returns {{ok: true, fuelL: number, costYen: number}
   *          |{ok: false, code: string}}
   *   code: "invalid_distance" | "invalid_efficiency" | "invalid_price"
   */
  function calculate(distanceKm, kmPerL, pricePerL) {
    if (!isFiniteNumber(distanceKm) || distanceKm < DISTANCE_MIN_KM || distanceKm > DISTANCE_MAX_KM) {
      return { ok: false, code: "invalid_distance" };
    }
    if (!isFiniteNumber(kmPerL) || kmPerL < EFFICIENCY_MIN || kmPerL > EFFICIENCY_MAX) {
      return { ok: false, code: "invalid_efficiency" };
    }
    if (!isFiniteNumber(pricePerL) || pricePerL < PRICE_MIN || pricePerL > PRICE_MAX) {
      return { ok: false, code: "invalid_price" };
    }
    var fuel = distanceKm / kmPerL;
    return {
      ok: true,
      fuelL: Math.round(fuel * 100) / 100,
      costYen: Math.round(fuel * pricePerL)
    };
  }

  var PEOPLE_MIN = 1;
  var PEOPLE_MAX = 20;
  var TOLL_MIN_YEN = 0;
  var TOLL_MAX_YEN = 200000;
  var COMMUTE_KM_MIN = 0.1;
  var COMMUTE_KM_MAX = 500;

  /**
   * ガソリン代と高速道路料金を人数で割り勘する。
   * ガソリン代は calculate と同じ式(距離÷燃費×単価・円未満四捨五入)。
   * 合計・1人あたりも円未満四捨五入。
   * @param {number} distanceKm 走行距離(km)
   * @param {number} kmPerL 燃費(km/L)
   * @param {number} pricePerL ガソリン単価(円/L)
   * @param {number} people 人数(運転者含む・1〜20の整数)
   * @param {number} tollYen 高速道路など有料道路の料金(円・0〜200,000)
   * @returns {{ok: true, fuelYen: number, tollYen: number, totalYen: number, perPersonYen: number}
   *          |{ok: false, code: string}}
   *   code: "invalid_distance" | "invalid_efficiency" | "invalid_price" | "invalid_people" | "invalid_toll"
   */
  function splitCost(distanceKm, kmPerL, pricePerL, people, tollYen) {
    var base = calculate(distanceKm, kmPerL, pricePerL);
    if (!base.ok) return base;
    if (!isFiniteNumber(people) || people !== Math.floor(people) ||
        people < PEOPLE_MIN || people > PEOPLE_MAX) {
      return { ok: false, code: "invalid_people" };
    }
    if (!isFiniteNumber(tollYen) || tollYen < TOLL_MIN_YEN || tollYen > TOLL_MAX_YEN) {
      return { ok: false, code: "invalid_toll" };
    }
    var toll = Math.round(tollYen);
    var total = base.costYen + toll;
    return {
      ok: true,
      fuelYen: base.costYen,
      tollYen: toll,
      totalYen: total,
      perPersonYen: Math.round(total / people)
    };
  }

  /**
   * 通勤(往復)のガソリン代を月・年で計算する。
   * 月の走行距離 = 片道距離 × 2 × 出勤日数。年は月×12。
   * 使用燃料は小数第2位、金額は円未満四捨五入(年は丸め前の月額×12を四捨五入)。
   * @param {number} oneWayKm 片道の通勤距離(km・0.1〜500)
   * @param {number} daysPerMonth 月の出勤日数(1〜31の整数)
   * @param {number} kmPerL 燃費(km/L)
   * @param {number} pricePerL ガソリン単価(円/L)
   * @returns {{ok: true, monthlyKm: number, fuelLPerMonth: number,
   *            costPerMonth: number, costPerYear: number}
   *          |{ok: false, code: string}}
   *   code: "invalid_distance" | "invalid_days" | "invalid_efficiency" | "invalid_price"
   */
  function commuteCost(oneWayKm, daysPerMonth, kmPerL, pricePerL) {
    if (!isFiniteNumber(oneWayKm) || oneWayKm < COMMUTE_KM_MIN || oneWayKm > COMMUTE_KM_MAX) {
      return { ok: false, code: "invalid_distance" };
    }
    if (!isFiniteNumber(daysPerMonth) || daysPerMonth !== Math.floor(daysPerMonth) ||
        daysPerMonth < 1 || daysPerMonth > 31) {
      return { ok: false, code: "invalid_days" };
    }
    if (!isFiniteNumber(kmPerL) || kmPerL < EFFICIENCY_MIN || kmPerL > EFFICIENCY_MAX) {
      return { ok: false, code: "invalid_efficiency" };
    }
    if (!isFiniteNumber(pricePerL) || pricePerL < PRICE_MIN || pricePerL > PRICE_MAX) {
      return { ok: false, code: "invalid_price" };
    }
    var monthlyKm = oneWayKm * 2 * daysPerMonth;
    var fuel = monthlyKm / kmPerL;
    var costMonthRaw = fuel * pricePerL;
    return {
      ok: true,
      monthlyKm: Math.round(monthlyKm * 10) / 10,
      fuelLPerMonth: Math.round(fuel * 100) / 100,
      costPerMonth: Math.round(costMonthRaw),
      costPerYear: Math.round(costMonthRaw * 12)
    };
  }

  var api = {
    commuteCost: commuteCost,
    splitCost: splitCost,
    calculate: calculate,
    DISTANCE_MIN_KM: DISTANCE_MIN_KM,
    DISTANCE_MAX_KM: DISTANCE_MAX_KM,
    EFFICIENCY_MIN: EFFICIENCY_MIN,
    EFFICIENCY_MAX: EFFICIENCY_MAX,
    PRICE_MIN: PRICE_MIN,
    PRICE_MAX: PRICE_MAX
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.FuelCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
