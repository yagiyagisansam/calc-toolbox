/*
 * モバイルバッテリーの mAh⇔Wh 換算・機内持ち込み判定・充電回数の計算ロジック
 *
 * 規定の時点: 2026年7月時点の日本航空(JAL)の取り扱い(2026年4月24日以降のルール)。
 *
 * 根拠(一次情報):
 * - 日本航空「国内線 制限のあるお手荷物」
 *   https://www.jal.co.jp/jp/ja/dom/baggage/limit/ (2026年7月29日参照)
 *   ・ワット時定格量(Wh)= 定格容量(Ah)× 定格電圧(V)
 *   ・160Whを超えるものは機内持ち込み不可。預け入れ荷物には容量にかかわらず入れられない
 * - 日本航空「モバイルバッテリーの機内持ち込み個数および充電に関するルール変更について
 *   (2026年4月24日以降)」
 *   https://www.jal.co.jp/jp/ja/info/2026/other/260330/ (2026年7月29日参照)
 *   ・機内に持ち込めるのは1名当たり2個まで(160Wh以下に限る)
 *   ・機内でモバイルバッテリーへ充電すること、モバイルバッテリーから他機器へ充電することは禁止
 *   ・2027年1月以降は100Whに制限される可能性がある旨の注記
 *
 * 前提:
 * - 表示されている mAh はセル(リチウムイオン電池)の容量で、公称電圧は通常3.7V。
 *   Wh は mAh ÷1000 × 電圧 で求める。実際の定格電圧は製品の表示で確認すること。
 * - 充電回数の「変換効率」は本ツールの既定値0.7(70%)で、これは出典に書かれた数値ではない。
 *   セルの3.7VからUSB出力の5Vへ昇圧する際の損失・ケーブル損失・端末側の充電損失を
 *   合わせた一般的な目安として置いている。
 * - 航空会社・路線によって規定は異なる。ここでは日本航空の取り扱いを基準にしている。
 */
(function (global) {
  "use strict";

  var DEFAULT_VOLTAGE = 3.7;      // リチウムイオン電池の一般的な公称電圧(V)
  var DEFAULT_EFFICIENCY = 0.7;   // 充電回数を見積もるときの変換効率の目安
  var LIMIT_NO_COUNT = 100;       // この値以下は従来「個数制限なし」だった区分の境目(Wh)
  var LIMIT_MAX = 160;            // これを超えると機内持ち込み不可(Wh)
  var MAX_COUNT = 2;              // 1名当たりの持ち込み個数の上限(2026年4月24日以降)
  var MAH_MIN = 1, MAH_MAX = 1000000;
  var V_MIN = 1, V_MAX = 60;
  var WH_MAX = 100000;

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function round(v, d) {
    var f = Math.pow(10, d);
    return Math.round(v * f) / f;
  }

  /**
   * mAh からワット時定格量(Wh)を求める。Wh = mAh ÷1000 × 電圧。
   * @param {number} mah バッテリー容量(mAh、1〜1000000)
   * @param {number} [voltage=3.7] 定格電圧(V、1〜60)
   * @returns {{ok:true, wh:number, ah:number, voltage:number}
   *          |{ok:false, code:"invalid_mah"|"invalid_voltage"}}
   *   wh は小数第2位で丸めた値
   */
  function whFromMah(mah, voltage) {
    var v = voltage === undefined ? DEFAULT_VOLTAGE : voltage;
    if (!isFiniteNumber(mah) || mah < MAH_MIN || mah > MAH_MAX) {
      return { ok: false, code: "invalid_mah" };
    }
    if (!isFiniteNumber(v) || v < V_MIN || v > V_MAX) {
      return { ok: false, code: "invalid_voltage" };
    }
    var ah = mah / 1000;
    return { ok: true, wh: round(ah * v, 2), ah: round(ah, 3), voltage: v };
  }

  /**
   * Wh から mAh を逆算する。mAh = Wh ÷ 電圧 ×1000。
   * @param {number} wh ワット時定格量(Wh、0より大きく100000以下)
   * @param {number} [voltage=3.7] 定格電圧(V、1〜60)
   * @returns {{ok:true, mah:number}|{ok:false, code:"invalid_wh"|"invalid_voltage"}}
   *   mah は小数第1位で丸めた値
   */
  function mahFromWh(wh, voltage) {
    var v = voltage === undefined ? DEFAULT_VOLTAGE : voltage;
    if (!isFiniteNumber(wh) || wh <= 0 || wh > WH_MAX) return { ok: false, code: "invalid_wh" };
    if (!isFiniteNumber(v) || v < V_MIN || v > V_MAX) return { ok: false, code: "invalid_voltage" };
    return { ok: true, mah: round(wh / v * 1000, 1) };
  }

  /**
   * ワット時定格量から機内持ち込みの可否を判定する(日本航空の取り扱い)。
   * 160Whを超えるものは持ち込み不可。160Wh以下は1名2個まで持ち込める。
   * 預け入れ荷物には容量にかかわらず入れられない。
   * @param {number} wh ワット時定格量(Wh、0より大きく100000以下)
   * @returns {{ok:true, carryOn:boolean, checkedBaggage:boolean, maxCount:number,
   *            category:"under100"|"100to160"|"over160"}
   *          |{ok:false, code:"invalid_wh"}}
   *   carryOn: 機内持ち込みができるか、checkedBaggage: 預け入れができるか(常に false)
   *   maxCount: 持ち込める個数(不可の場合は0)
   *   category: "under100"(100Wh以下)/"100to160"(100Wh超160Wh以下)/"over160"(160Wh超)
   */
  function flightStatus(wh) {
    if (!isFiniteNumber(wh) || wh <= 0 || wh > WH_MAX) return { ok: false, code: "invalid_wh" };
    if (wh > LIMIT_MAX) {
      return { ok: true, carryOn: false, checkedBaggage: false, maxCount: 0, category: "over160" };
    }
    return {
      ok: true,
      carryOn: true,
      checkedBaggage: false,
      maxCount: MAX_COUNT,
      category: wh <= LIMIT_NO_COUNT ? "under100" : "100to160"
    };
  }

  /**
   * スマートフォンなどを何回充電できるかの目安。
   * 充電回数 = バッテリー容量(mAh)× 変換効率 ÷ 端末のバッテリー容量(mAh)。
   * @param {number} batteryMah モバイルバッテリーの容量(mAh、1〜1000000)
   * @param {number} deviceMah 端末のバッテリー容量(mAh、1〜1000000)
   * @param {number} [efficiency=0.7] 変換効率(0.3〜1.0)。既定0.7は一般的な目安
   * @returns {{ok:true, count:number, usableMah:number, efficiency:number}
   *          |{ok:false, code:"invalid_mah"|"invalid_device_mah"|"invalid_efficiency"}}
   *   count: 充電できる回数(小数第1位で丸め)、usableMah: 実際に使える容量の目安(mAh)
   */
  function chargeCount(batteryMah, deviceMah, efficiency) {
    var e = efficiency === undefined ? DEFAULT_EFFICIENCY : efficiency;
    if (!isFiniteNumber(batteryMah) || batteryMah < MAH_MIN || batteryMah > MAH_MAX) {
      return { ok: false, code: "invalid_mah" };
    }
    if (!isFiniteNumber(deviceMah) || deviceMah < MAH_MIN || deviceMah > MAH_MAX) {
      return { ok: false, code: "invalid_device_mah" };
    }
    if (!isFiniteNumber(e) || e < 0.3 || e > 1) return { ok: false, code: "invalid_efficiency" };
    var usable = batteryMah * e;
    return {
      ok: true,
      count: round(usable / deviceMah, 1),
      usableMah: Math.round(usable),
      efficiency: e
    };
  }

  /**
   * mAh から Wh・持ち込み可否・充電回数までをまとめて求める。
   * @param {number} mah モバイルバッテリーの容量(mAh、1〜1000000)
   * @param {number} [voltage=3.7] 定格電圧(V、1〜60)
   * @param {number} [deviceMah] 端末のバッテリー容量(mAh)。省略すると充電回数は返さない
   * @param {number} [efficiency=0.7] 変換効率(0.3〜1.0)
   * @returns {{ok:true, wh:number, ah:number, voltage:number, carryOn:boolean,
   *            checkedBaggage:boolean, maxCount:number, category:string,
   *            count:(number|null), usableMah:(number|null)}
   *          |{ok:false, code:string}}
   *   code: "invalid_mah"|"invalid_voltage"|"invalid_wh"|"invalid_device_mah"|"invalid_efficiency"
   */
  function calculate(mah, voltage, deviceMah, efficiency) {
    var w = whFromMah(mah, voltage);
    if (!w.ok) return w;
    var s = flightStatus(w.wh);
    if (!s.ok) return s;
    var out = {
      ok: true,
      wh: w.wh, ah: w.ah, voltage: w.voltage,
      carryOn: s.carryOn, checkedBaggage: s.checkedBaggage,
      maxCount: s.maxCount, category: s.category,
      count: null, usableMah: null
    };
    if (deviceMah !== undefined && deviceMah !== null) {
      var c = chargeCount(mah, deviceMah, efficiency);
      if (!c.ok) return c;
      out.count = c.count;
      out.usableMah = c.usableMah;
    }
    return out;
  }

  var api = {
    whFromMah: whFromMah,
    mahFromWh: mahFromWh,
    flightStatus: flightStatus,
    chargeCount: chargeCount,
    calculate: calculate,
    DEFAULT_VOLTAGE: DEFAULT_VOLTAGE,
    DEFAULT_EFFICIENCY: DEFAULT_EFFICIENCY,
    LIMIT_NO_COUNT: LIMIT_NO_COUNT,
    LIMIT_MAX: LIMIT_MAX,
    MAX_COUNT: MAX_COUNT
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.MobabattCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
