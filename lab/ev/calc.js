/*
 * EV・PHEV の充電時間と電費(航続距離)の計算ロジック
 *
 * 根拠(一次情報):
 * - 経済産業省「充電インフラ整備促進に向けた指針」(令和5年10月)
 *   https://www.meti.go.jp/shingikai/mono_info_service/charging_infrastructure/pdf/20231018_1.pdf
 *   (2026年7月29日参照)
 *   ・普通充電は「現在は3kWが大半。6kWや、今後は10kWの導入も」
 *   ・急速充電は「現状9千口の大半は50kW未満であり、平均的な出力は約40kW」
 *     「50kW未満が57%、50kW以上90kW未満が31%、90kW以上が12%(2023年3月)」
 *   ・2030年に向けて急速充電の平均出力を80kWへ、需要の多い場所では150kWも設置
 *   ・「50kW以上の充電器を設置していくことを踏まえれば、30分間の充電で少なくとも10kWh
 *      (7km/kWhとしたときに70km)は充電可能」
 *
 * 計算式そのものは電力量の定義(電力量 = 出力 × 時間)による算術で、
 *   充電に入る電力量(kWh) = 容量(kWh) × (目標% − 現在%) ÷ 100
 *   充電時間(h) = 充電に入る電力量 ÷ (充電出力(kW) × 充電効率)
 *   航続距離(km) = 容量(kWh) × 残量% ÷ 100 × 電費(km/kWh)
 *
 * 前提:
 * - 充電効率は既定0.9。充電器からバッテリーに入るまでの損失を見込んだ仮定値であり、
 *   出典に定められた数値ではない(気温・充電器・車種で変わる)
 * - 実際の急速充電はバッテリー保護のため充電率が上がるほど出力が絞られる(テーパリング)。
 *   この計算は出力が一定という前提の理論値で、実際はこれより時間がかかる
 *   (経済産業省の資料も、50kW級で30分の充電で「少なくとも10kWh」としている)
 * - 電費は車種・季節・走り方で大きく変わる。冬季は暖房で3〜4割落ちることがある
 * - 丸め: 電力量と時間は小数第2位、分は整数、距離は小数第1位で四捨五入
 */
(function (global) {
  "use strict";

  var MIN_CAPACITY = 0.1, MAX_CAPACITY = 500;      // kWh
  var MIN_POWER = 0.1, MAX_POWER = 400;            // kW
  var MIN_EFFICIENCY = 0.3, MAX_EFFICIENCY = 1;
  var MIN_CONSUMPTION = 0.1, MAX_CONSUMPTION = 50; // km/kWh
  var MIN_MINUTES = 1, MAX_MINUTES = 1440;
  var DEFAULT_EFFICIENCY = 0.9;

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }
  function round1(v) { return Math.round(v * 10) / 10; }
  function round2(v) { return Math.round(v * 100) / 100; }

  function checkPercent(v) {
    return isFiniteNumber(v) && v >= 0 && v <= 100;
  }

  /**
   * 現在の充電率から目標の充電率まで充電するのにかかる時間を計算する。
   * @param {number} capacityKwh バッテリー容量(kWh。0.1〜500)
   * @param {number} fromPercent 現在の充電率(%。0〜100)
   * @param {number} toPercent 目標の充電率(%。0〜100。現在より大きいこと)
   * @param {number} powerKw 充電出力(kW。0.1〜400)
   * @param {number} [efficiency] 充電効率(0.3〜1。既定0.9)
   * @returns {{ok:true, energyKwh:number, hours:number, totalMinutes:number,
   *            hoursPart:number, minutesPart:number}
   *          |{ok:false, code:"invalid_capacity"|"invalid_from"|"invalid_to"|"invalid_order"
   *                          |"invalid_power"|"invalid_efficiency"}}
   *   energyKwh: バッテリーに入る電力量 / hours: 時間(小数)
   *   totalMinutes: 分に直した値(四捨五入) / hoursPart・minutesPart: 「◯時間◯分」の表示用
   */
  function chargeTime(capacityKwh, fromPercent, toPercent, powerKw, efficiency) {
    if (!isFiniteNumber(capacityKwh) || capacityKwh < MIN_CAPACITY || capacityKwh > MAX_CAPACITY) {
      return { ok: false, code: "invalid_capacity" };
    }
    if (!checkPercent(fromPercent)) return { ok: false, code: "invalid_from" };
    if (!checkPercent(toPercent)) return { ok: false, code: "invalid_to" };
    if (toPercent <= fromPercent) return { ok: false, code: "invalid_order" };
    if (!isFiniteNumber(powerKw) || powerKw < MIN_POWER || powerKw > MAX_POWER) {
      return { ok: false, code: "invalid_power" };
    }
    var eff = efficiency === undefined || efficiency === null ? DEFAULT_EFFICIENCY : efficiency;
    if (!isFiniteNumber(eff) || eff < MIN_EFFICIENCY || eff > MAX_EFFICIENCY) {
      return { ok: false, code: "invalid_efficiency" };
    }
    var energy = (capacityKwh * (toPercent - fromPercent)) / 100;
    var hours = energy / (powerKw * eff);
    var totalMinutes = Math.round(hours * 60);
    return {
      ok: true,
      energyKwh: round2(energy),
      hours: round2(hours),
      totalMinutes: totalMinutes,
      hoursPart: Math.floor(totalMinutes / 60),
      minutesPart: totalMinutes % 60
    };
  }

  /**
   * 現在の充電率で走れる距離を計算する。
   * @param {number} capacityKwh バッテリー容量(kWh。0.1〜500)
   * @param {number} socPercent 現在の充電率(%。0〜100)
   * @param {number} kmPerKwh 電費(km/kWh。0.1〜50)
   * @returns {{ok:true, usableKwh:number, rangeKm:number}
   *          |{ok:false, code:"invalid_capacity"|"invalid_soc"|"invalid_consumption"}}
   */
  function rangeKm(capacityKwh, socPercent, kmPerKwh) {
    if (!isFiniteNumber(capacityKwh) || capacityKwh < MIN_CAPACITY || capacityKwh > MAX_CAPACITY) {
      return { ok: false, code: "invalid_capacity" };
    }
    if (!checkPercent(socPercent)) return { ok: false, code: "invalid_soc" };
    if (!isFiniteNumber(kmPerKwh) || kmPerKwh < MIN_CONSUMPTION || kmPerKwh > MAX_CONSUMPTION) {
      return { ok: false, code: "invalid_consumption" };
    }
    var usable = (capacityKwh * socPercent) / 100;
    return { ok: true, usableKwh: round2(usable), rangeKm: round1(usable * kmPerKwh) };
  }

  /**
   * 決まった時間だけ充電したときに、どれだけ電力量が入り何km走れるかを計算する。
   * @param {number} minutes 充電する時間(分。1〜1440)
   * @param {number} powerKw 充電出力(kW。0.1〜400)
   * @param {number} kmPerKwh 電費(km/kWh。0.1〜50)
   * @param {number} [efficiency] 充電効率(0.3〜1。既定0.9)
   * @returns {{ok:true, energyKwh:number, rangeKm:number}
   *          |{ok:false, code:"invalid_minutes"|"invalid_power"|"invalid_consumption"
   *                          |"invalid_efficiency"}}
   */
  function addedRange(minutes, powerKw, kmPerKwh, efficiency) {
    if (!isFiniteNumber(minutes) || minutes < MIN_MINUTES || minutes > MAX_MINUTES) {
      return { ok: false, code: "invalid_minutes" };
    }
    if (!isFiniteNumber(powerKw) || powerKw < MIN_POWER || powerKw > MAX_POWER) {
      return { ok: false, code: "invalid_power" };
    }
    if (!isFiniteNumber(kmPerKwh) || kmPerKwh < MIN_CONSUMPTION || kmPerKwh > MAX_CONSUMPTION) {
      return { ok: false, code: "invalid_consumption" };
    }
    var eff = efficiency === undefined || efficiency === null ? DEFAULT_EFFICIENCY : efficiency;
    if (!isFiniteNumber(eff) || eff < MIN_EFFICIENCY || eff > MAX_EFFICIENCY) {
      return { ok: false, code: "invalid_efficiency" };
    }
    var energy = powerKw * (minutes / 60) * eff;
    return { ok: true, energyKwh: round2(energy), rangeKm: round1(energy * kmPerKwh) };
  }

  var api = {
    chargeTime: chargeTime,
    rangeKm: rangeKm,
    addedRange: addedRange
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.EvCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
