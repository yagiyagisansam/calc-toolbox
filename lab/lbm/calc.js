/*
 * 除脂肪体重(LBM)とFFMI(除脂肪量指数)の計算ロジック
 *
 * 基準の時点: 2026年7月時点。FFMIの身長補正と上限値25.0は1995年の原著論文による。
 *
 * 根拠(一次情報):
 * - Kouri EM, Pope HG Jr, Katz DL, Oliva P.
 *   "Fat-free mass index in users and nonusers of anabolic-androgenic steroids."
 *   Clin J Sport Med. 1995 Oct;5(4):223-8. PMID: 7496846
 *   https://pubmed.ncbi.nlm.nih.gov/7496846/ (2026年7月29日参照)
 *   ・"FFMI is defined by the formula (fat-free body mass in kg) x (height in meters)-2."
 *   ・"We then added a slight correction of 6.3 x (1.80 m - height) to normalize these values
 *      to the height of a 1.8-m man."
 *   ・"The normalized FFMI values of athletes who had not used steroids extended up to a
 *      well-defined limit of 25.0."(男性アスリートでの上限)
 * - Calculator.net "Lean Body Mass Calculator"
 *   https://www.calculator.net/lean-body-mass-calculator.html (2026年7月29日参照)
 *   ・除脂肪体重は「体重から体脂肪の重さを引いたもの」
 *   ・体脂肪率が分からないときの推定式(W=体重kg、H=身長cm)
 *       Boer  男性 eLBM = 0.407W + 0.267H - 19.2 / 女性 eLBM = 0.252W + 0.473H - 48.3
 *       James 男性 eLBM = 1.1W - 128(W/H)^2     / 女性 eLBM = 1.07W - 148(W/H)^2
 *       Hume  男性 eLBM = 0.32810W + 0.33929H - 29.5336 / 女性 eLBM = 0.29569W + 0.41813H - 43.2933
 *
 * 前提:
 * - 除脂肪体重は「体重 ×(1 − 体脂肪率/100)」で求める。体脂肪率は家庭用体組成計の値でよいが、
 *   機種や測定条件で数%ずれるため、結果もその分ぶれる。
 * - 身長補正FFMIの係数は原著論文どおり 6.3。ウェブ上の計算機には 6.1 を使うものもあるが、
 *   ここでは一次情報である論文の値を採用している。
 * - 上限25.0はステロイドを使っていない男性アスリートで観察された値で、
 *   女性についての同様の基準はこの論文には示されていない。
 * - 丸めは、体重(kg)は小数第1位、FFMIは小数第1位(いずれも四捨五入)。
 */
(function (global) {
  "use strict";

  var HEIGHT_MIN = 100;   // 身長(cm)の入力下限
  var HEIGHT_MAX = 250;   // 身長(cm)の入力上限
  var WEIGHT_MIN = 20;    // 体重(kg)の入力下限
  var WEIGHT_MAX = 300;   // 体重(kg)の入力上限
  var FAT_MIN = 1;        // 体脂肪率(%)の入力下限
  var FAT_MAX = 70;       // 体脂肪率(%)の入力上限

  var NORMALIZE_COEF = 6.3;      // 身長補正の係数(原著論文)
  var NORMALIZE_HEIGHT_M = 1.80; // 補正の基準身長(m)
  var MALE_LIMIT = 25.0;         // 非使用者の男性アスリートで観察された上限

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }
  function round1(v) {
    return Math.round(v * 10) / 10;
  }

  /**
   * 除脂肪体重とFFMI、身長補正FFMIを計算する
   * @param {string} sex "male"=男性 / "female"=女性(判定の目安に使う)
   * @param {number} heightCm 身長(cm)
   * @param {number} weightKg 体重(kg)
   * @param {number} bodyFatPercent 体脂肪率(%)
   * @returns {{ok:true, fatMassKg:number, leanMassKg:number, ffmi:number, normalizedFfmi:number,
   *            overMaleLimit:(boolean|null)}
   *          |{ok:false, code:"invalid_sex"|"invalid_height"|"invalid_weight"|"invalid_body_fat"}}
   *   fatMassKg/leanMassKg は小数第1位、ffmi/normalizedFfmi は小数第1位で四捨五入。
   *   overMaleLimit は男性のとき身長補正FFMIが25.0を超えるか(女性は基準がないので null)
   */
  function calculate(sex, heightCm, weightKg, bodyFatPercent) {
    if (sex !== "male" && sex !== "female") {
      return { ok: false, code: "invalid_sex" };
    }
    if (!isFiniteNumber(heightCm) || heightCm < HEIGHT_MIN || heightCm > HEIGHT_MAX) {
      return { ok: false, code: "invalid_height" };
    }
    if (!isFiniteNumber(weightKg) || weightKg < WEIGHT_MIN || weightKg > WEIGHT_MAX) {
      return { ok: false, code: "invalid_weight" };
    }
    if (!isFiniteNumber(bodyFatPercent) || bodyFatPercent < FAT_MIN || bodyFatPercent > FAT_MAX) {
      return { ok: false, code: "invalid_body_fat" };
    }

    var m = heightCm / 100;
    var fat = weightKg * (bodyFatPercent / 100);
    var lean = weightKg - fat;
    var ffmi = lean / (m * m);
    var normalized = ffmi + NORMALIZE_COEF * (NORMALIZE_HEIGHT_M - m);

    return {
      ok: true,
      fatMassKg: round1(fat),
      leanMassKg: round1(lean),
      ffmi: round1(ffmi),
      normalizedFfmi: round1(normalized),
      overMaleLimit: sex === "male" ? round1(normalized) > MALE_LIMIT : null
    };
  }

  /**
   * 体脂肪率が分からないときの除脂肪体重の推定(Boer / James / Hume の3式)
   * @param {string} sex "male" / "female"
   * @param {number} heightCm 身長(cm)
   * @param {number} weightKg 体重(kg)
   * @returns {{ok:true, boer:number, james:number, hume:number}
   *          |{ok:false, code:"invalid_sex"|"invalid_height"|"invalid_weight"}}
   *   いずれも推定除脂肪体重(kg、小数第1位で四捨五入)
   */
  function estimateLbm(sex, heightCm, weightKg) {
    if (sex !== "male" && sex !== "female") {
      return { ok: false, code: "invalid_sex" };
    }
    if (!isFiniteNumber(heightCm) || heightCm < HEIGHT_MIN || heightCm > HEIGHT_MAX) {
      return { ok: false, code: "invalid_height" };
    }
    if (!isFiniteNumber(weightKg) || weightKg < WEIGHT_MIN || weightKg > WEIGHT_MAX) {
      return { ok: false, code: "invalid_weight" };
    }
    var w = weightKg, h = heightCm;
    var ratio = (w / h) * (w / h);
    var boer = sex === "male"
      ? 0.407 * w + 0.267 * h - 19.2
      : 0.252 * w + 0.473 * h - 48.3;
    var james = sex === "male"
      ? 1.1 * w - 128 * ratio
      : 1.07 * w - 148 * ratio;
    var hume = sex === "male"
      ? 0.32810 * w + 0.33929 * h - 29.5336
      : 0.29569 * w + 0.41813 * h - 43.2933;
    return { ok: true, boer: round1(boer), james: round1(james), hume: round1(hume) };
  }

  /**
   * 目標のFFMIから、その体格に必要な除脂肪体重を逆算する
   * @param {number} heightCm 身長(cm)
   * @param {number} targetFfmi 目標のFFMI(身長補正前。10〜30の範囲)
   * @returns {{ok:true, leanMassKg:number}|{ok:false, code:"invalid_height"|"invalid_target_ffmi"}}
   *   leanMassKg は小数第1位で四捨五入
   */
  function leanMassForFfmi(heightCm, targetFfmi) {
    if (!isFiniteNumber(heightCm) || heightCm < HEIGHT_MIN || heightCm > HEIGHT_MAX) {
      return { ok: false, code: "invalid_height" };
    }
    if (!isFiniteNumber(targetFfmi) || targetFfmi < 10 || targetFfmi > 30) {
      return { ok: false, code: "invalid_target_ffmi" };
    }
    var m = heightCm / 100;
    return { ok: true, leanMassKg: round1(targetFfmi * m * m) };
  }

  var api = {
    calculate: calculate,
    estimateLbm: estimateLbm,
    leanMassForFfmi: leanMassForFfmi,
    NORMALIZE_COEF: NORMALIZE_COEF,
    MALE_LIMIT: MALE_LIMIT
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.LbmCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
