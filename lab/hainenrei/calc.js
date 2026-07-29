/*
 * 肺年齢 計算ロジック
 *
 * 根拠(一次情報):
 * - 日本呼吸器学会「肺年齢に関するステートメント」
 *   https://www.jrs.or.jp/activities/guidelines/statement/20191217170833.html (2026年7月29日参照)
 *   肺年齢は、日本呼吸器学会肺生理専門委員会が2001年に公表した
 *   「日本人のスパイログラムと動脈血液ガス分圧基準値」の1秒量(FEV1)の回帰式を
 *   年齢について解いたもの。対象は18〜95歳。
 * - 日本呼吸器学会 肺年齢コンセプト(使用手引)
 *   https://www.jrs.or.jp/activities/guidelines/file/hainenrei_shiyousyo_11b.pdf (2026年7月29日参照)
 *
 * 用いる式:
 *   1秒量(FEV1)の標準回帰式(日本呼吸器学会 2001)
 *     男性: FEV1(L) = 0.036×身長(cm) − 0.028×年齢 − 1.178
 *     女性: FEV1(L) = 0.022×身長(cm) − 0.022×年齢 − 0.005
 *   これを年齢について解いた式が肺年齢
 *     男性: 肺年齢 = (0.036×身長(cm) − 1.178 − FEV1(L)) ÷ 0.028
 *     女性: 肺年齢 = (0.022×身長(cm) − 0.005 − FEV1(L)) ÷ 0.022
 *
 * 検算:
 *   日本呼吸器学会誌 掲載の「肺年齢の解釈」(日呼吸誌 48(7):541-)の
 *   「肺年齢の％1秒量との対比表(身長別)」と一致することを確認済み。
 *   例) 男性・身長170cm・18歳・%FEV1 90% → 肺年齢 33.9歳(表と一致)
 *       女性・身長160cm・18歳・%FEV1 90% → 肺年齢 32.2歳(表と一致)
 *
 * 前提:
 * - FEV1はスパイロメトリー(呼吸機能検査)で測った1秒量。単位はリットル(L)。
 * - 対象は18〜95歳。この範囲を外れる結果は参考値として outOfRange を立てる。
 * - 肺年齢は健常者でもおよそ半数が実年齢より高く出る性質がある(学会ステートメントの指摘)。
 *   肺年齢だけで病気を判定するものではない。診断は必ず医師が行う。
 */
(function (global) {
  "use strict";

  var COEF = {
    male: { height: 0.036, age: 0.028, constant: 1.178 },
    female: { height: 0.022, age: 0.022, constant: 0.005 }
  };
  var AGE_MIN = 18; // 肺年齢の対象年齢の下限
  var AGE_MAX = 95; // 肺年齢の対象年齢の上限

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  /**
   * 指定した小数位で四捨五入する(2進小数の誤差でちょうど半分の値が下振れするのを防ぐ)
   * 例) 33.849999999999994 は有効数字12桁で 33.85 とみなしてから 33.9 にする
   * @param {number} x 対象の数値
   * @param {number} digits 小数点以下の桁数(0以上)
   * @returns {number} 四捨五入した数値
   */
  function roundTo(x, digits) {
    if (!isFinite(x)) return x;
    var p = Math.pow(10, digits);
    return Math.round(parseFloat(x.toPrecision(12)) * p) / p;
  }

  function checkSex(sex) {
    return sex === "male" || sex === "female";
  }
  function checkHeight(h) {
    return isFiniteNumber(h) && h >= 100 && h <= 250;
  }
  function checkFev1(f) {
    return isFiniteNumber(f) && f > 0 && f <= 10;
  }

  /**
   * 性別・身長・年齢から1秒量(FEV1)の予測値を求める
   * @param {number} heightCm 身長(cm)。100以上250以下
   * @param {string} sex "male"=男性 / "female"=女性
   * @param {number} age 年齢(歳)。0以上120以下
   * @returns {{ok:true, predictedFev1:number}
   *          |{ok:false, code:"invalid_height"|"invalid_sex"|"invalid_age"}}
   *   predictedFev1: 予測1秒量(L、小数第3位で四捨五入)
   */
  function predictedFev1(heightCm, sex, age) {
    if (!checkSex(sex)) return { ok: false, code: "invalid_sex" };
    if (!checkHeight(heightCm)) return { ok: false, code: "invalid_height" };
    if (!isFiniteNumber(age) || age < 0 || age > 120) return { ok: false, code: "invalid_age" };
    var c = COEF[sex];
    var v = c.height * heightCm - c.age * age - c.constant;
    return { ok: true, predictedFev1: roundTo(v, 3) };
  }

  /**
   * 1秒量(FEV1)・身長・性別・実年齢から肺年齢を求める
   * @param {number} fev1L 1秒量 FEV1(L)。0より大きく10以下
   * @param {number} heightCm 身長(cm)。100以上250以下
   * @param {string} sex "male"=男性 / "female"=女性
   * @param {number} actualAge 実年齢(歳)。0以上120以下
   * @returns {{ok:true, lungAge:number, diff:number, predictedFev1:number,
   *            percentPredicted:number, outOfRange:boolean}
   *          |{ok:false, code:"invalid_fev1"|"invalid_height"|"invalid_sex"|"invalid_age"}}
   *   lungAge: 肺年齢(歳、小数第1位で四捨五入)
   *   diff: 肺年齢 − 実年齢(歳、小数第1位で四捨五入)。プラスなら実年齢より高い
   *   predictedFev1: 実年齢での予測1秒量(L、小数第3位で四捨五入)
   *   percentPredicted: %1秒量 = FEV1 ÷ 予測値 × 100(%、小数第1位で四捨五入)
   *   outOfRange: 肺年齢が対象年齢18〜95歳の外に出たら true(参考値として扱う)
   */
  function calculate(fev1L, heightCm, sex, actualAge) {
    if (!checkSex(sex)) return { ok: false, code: "invalid_sex" };
    if (!checkHeight(heightCm)) return { ok: false, code: "invalid_height" };
    if (!checkFev1(fev1L)) return { ok: false, code: "invalid_fev1" };
    if (!isFiniteNumber(actualAge) || actualAge < 0 || actualAge > 120) {
      return { ok: false, code: "invalid_age" };
    }
    var c = COEF[sex];
    var raw = (c.height * heightCm - c.constant - fev1L) / c.age;
    var p = predictedFev1(heightCm, sex, actualAge);
    var pct = p.predictedFev1 > 0 ? (fev1L / p.predictedFev1) * 100 : 0;
    return {
      ok: true,
      lungAge: roundTo(raw, 1),
      diff: roundTo(raw - actualAge, 1),
      predictedFev1: p.predictedFev1,
      percentPredicted: roundTo(pct, 1),
      outOfRange: raw < AGE_MIN || raw > AGE_MAX
    };
  }

  /**
   * 肺年齢を実年齢に一致させるために必要な1秒量(FEV1)を求める(目標値の逆算)
   * @param {number} heightCm 身長(cm)。100以上250以下
   * @param {string} sex "male"=男性 / "female"=女性
   * @param {number} targetAge 目標にしたい肺年齢(歳)。18以上95以下
   * @returns {{ok:true, requiredFev1:number}
   *          |{ok:false, code:"invalid_height"|"invalid_sex"|"invalid_target_age"}}
   *   requiredFev1: その肺年齢になるFEV1(L、小数第3位で四捨五入)
   */
  function fev1ForLungAge(heightCm, sex, targetAge) {
    if (!checkSex(sex)) return { ok: false, code: "invalid_sex" };
    if (!checkHeight(heightCm)) return { ok: false, code: "invalid_height" };
    if (!isFiniteNumber(targetAge) || targetAge < AGE_MIN || targetAge > AGE_MAX) {
      return { ok: false, code: "invalid_target_age" };
    }
    var c = COEF[sex];
    var v = c.height * heightCm - c.constant - c.age * targetAge;
    return { ok: true, requiredFev1: roundTo(v, 3) };
  }

  var api = {
    calculate: calculate,
    predictedFev1: predictedFev1,
    fev1ForLungAge: fev1ForLungAge,
    AGE_MIN: AGE_MIN,
    AGE_MAX: AGE_MAX
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.HainenreiCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
