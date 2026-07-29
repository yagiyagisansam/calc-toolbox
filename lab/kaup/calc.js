/*
 * カウプ指数(乳幼児のBMI)と幼児の肥満度の計算ロジック
 *
 * 基準の時点: 2026年7月時点。標準体重の式は平成12年(2000年)の乳幼児身体発育調査に基づく。
 *
 * 根拠(一次情報):
 * - 国立保健医療科学院「乳幼児身体発育 評価マニュアル」(平成23年度厚生労働科学研究費補助金
 *   成育疾患克服等次世代育成基盤研究事業、平成24年3月)
 *   https://www.niph.go.jp/soshiki/07shougai/hatsuiku/index.files/katsuyou_130805.pdf (2026年7月29日参照)
 *   ・「乳幼児ではBMIは『カウプ指数』とも呼ばれており」、BMIは体重(kg)を身長(m)の二乗で割った値
 *   ・「標準の体格は15〜19というように乳幼児の"一応の基準"がある」
 *   ・短所として「BMI(カウプ指数)は月齢・年齢とともに大きく変動するので、乳幼児期を通した
 *     単一の基準で評価すると判断を誤りやすい」ことが挙げられている
 *   ・幼児期(6歳未満、身長70cm以上120cm未満)の性別・身長別標準体重(Xは身長cm)
 *       男児 標準体重 = 0.00206X^2 - 0.1166X + 6.5273
 *       女児 標準体重 = 0.00249X^2 - 0.1858X + 9.0360
 *   ・肥満度(%) = (実測体重(kg) - 身長別標準体重(kg)) / 身長別標準体重(kg) × 100
 *   ・「乳幼児では、肥満度±15%以内を『ふつう』」とする
 *   ・身長は2歳未満は仰臥位(寝かせて)、2歳以上は立位で計測する
 * - 厚生労働省「乳幼児身体発育調査」(標準体重の式のもとになった調査)
 *   https://www.mhlw.go.jp/toukei/list/73-22.html (2026年7月29日参照)
 * - 日本小児内分泌学会「日本人小児の体格の評価」(同じ幼児期の標準体重の式を掲載)
 *   https://jspe.umin.jp/medical/taikaku.html (2026年7月29日参照)
 *
 * 前提:
 * - カウプ指数は BMI と同じ値になる。入力単位を変えても意味は同じで、
 *   体重(g) ÷ 身長(cm)^2 × 10 も 体重(kg) ÷ 身長(m)^2 と等しい。
 * - 15〜19 という区分は評価マニュアルが示す「一応の基準」で、月齢による変動を織り込んでいない。
 *   確定的な判定には成長曲線(BMIパーセンタイル曲線)や健診での評価が必要。
 * - 肥満度は、評価マニュアルの幼児期の式が使える範囲(身長70cm以上120cm未満)でのみ計算する。
 * - 丸めは、カウプ指数は小数第1位まで、肥満度は小数第1位まで(いずれも四捨五入)。
 */
(function (global) {
  "use strict";

  var WEIGHT_MIN = 0.5;    // 体重(kg)の入力下限
  var WEIGHT_MAX = 40;     // 体重(kg)の入力上限
  var HEIGHT_MIN = 35;     // 身長(cm)の入力下限
  var HEIGHT_MAX = 140;    // 身長(cm)の入力上限
  var AGE_MIN = 0;         // 月齢の入力下限
  var AGE_MAX = 71;        // 月齢の入力上限(5歳11か月)

  var BAND_LOW = 15;       // 「一応の基準」の下限
  var BAND_HIGH = 19;      // 「一応の基準」の上限
  var KAUP_APPLY_MIN = 3;  // カウプ指数が使われる月齢の下限(生後3か月)

  var STD_HEIGHT_MIN = 70;   // 幼児の身長別標準体重の式が使える身長(cm)の下限
  var STD_HEIGHT_MAX = 120;  // 同上限(この値未満)
  var NORMAL_RANGE = 15;     // 肥満度±15%以内を「ふつう」とする

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }
  function round1(v) {
    return Math.round(v * 10) / 10;
  }

  /**
   * カウプ指数(乳幼児のBMI)を計算する
   * @param {number} weightKg 体重(kg)
   * @param {number} heightCm 身長(cm)。2歳未満は仰臥位、2歳以上は立位で測った値
   * @returns {{ok:true, index:number}|{ok:false, code:"invalid_weight"|"invalid_height"}}
   *   index はカウプ指数(小数第1位で四捨五入)
   */
  function index(weightKg, heightCm) {
    if (!isFiniteNumber(weightKg) || weightKg < WEIGHT_MIN || weightKg > WEIGHT_MAX) {
      return { ok: false, code: "invalid_weight" };
    }
    if (!isFiniteNumber(heightCm) || heightCm < HEIGHT_MIN || heightCm > HEIGHT_MAX) {
      return { ok: false, code: "invalid_height" };
    }
    var m = heightCm / 100;
    return { ok: true, index: round1(weightKg / (m * m)) };
  }

  /**
   * カウプ指数を計算し、月齢を踏まえた位置づけを返す
   * @param {number} weightKg 体重(kg)
   * @param {number} heightCm 身長(cm)
   * @param {number} ageMonths 月齢(0〜71の整数。5歳11か月まで)
   * @returns {{ok:true, index:number, band:"low"|"standard"|"high", inKaupAge:boolean, standingHeight:boolean}
   *          |{ok:false, code:"invalid_weight"|"invalid_height"|"invalid_age"}}
   *   band は「一応の基準」15〜19に対する位置。inKaupAge は生後3か月以上かどうか。
   *   standingHeight は身長を立位で測る月齢(24か月以上)かどうか。
   */
  function calculate(weightKg, heightCm, ageMonths) {
    var r = index(weightKg, heightCm);
    if (!r.ok) return r;
    if (!isFiniteNumber(ageMonths) || ageMonths < AGE_MIN || ageMonths > AGE_MAX) {
      return { ok: false, code: "invalid_age" };
    }
    var band = "standard";
    if (r.index < BAND_LOW) band = "low";
    else if (r.index > BAND_HIGH) band = "high";
    return {
      ok: true,
      index: r.index,
      band: band,
      inKaupAge: ageMonths >= KAUP_APPLY_MIN,
      standingHeight: ageMonths >= 24
    };
  }

  /**
   * 幼児の身長別標準体重(評価マニュアルの2次式)を求める
   * @param {number} heightCm 身長(cm)。70以上120未満でのみ計算できる
   * @param {string} sex "male"=男児 / "female"=女児
   * @returns {{ok:true, standardWeightKg:number}|{ok:false, code:"invalid_height"|"invalid_sex"|"out_of_range"}}
   *   standardWeightKg は小数第2位で四捨五入
   */
  function standardWeight(heightCm, sex) {
    if (!isFiniteNumber(heightCm) || heightCm < HEIGHT_MIN || heightCm > HEIGHT_MAX) {
      return { ok: false, code: "invalid_height" };
    }
    if (sex !== "male" && sex !== "female") {
      return { ok: false, code: "invalid_sex" };
    }
    if (heightCm < STD_HEIGHT_MIN || heightCm >= STD_HEIGHT_MAX) {
      return { ok: false, code: "out_of_range" };
    }
    var x = heightCm;
    var w = sex === "male"
      ? 0.00206 * x * x - 0.1166 * x + 6.5273
      : 0.00249 * x * x - 0.1858 * x + 9.0360;
    return { ok: true, standardWeightKg: Math.round(w * 100) / 100 };
  }

  /**
   * 幼児の肥満度(身長別標準体重に対する増減の割合)を計算する
   * @param {number} weightKg 実測体重(kg)
   * @param {number} heightCm 身長(cm)。70以上120未満
   * @param {string} sex "male" / "female"
   * @returns {{ok:true, standardWeightKg:number, degree:number, category:"under"|"normal"|"over"}
   *          |{ok:false, code:"invalid_weight"|"invalid_height"|"invalid_sex"|"out_of_range"}}
   *   degree は肥満度(%、小数第1位で四捨五入)。category は ±15%以内が "normal"
   */
  function obesityDegree(weightKg, heightCm, sex) {
    if (!isFiniteNumber(weightKg) || weightKg < WEIGHT_MIN || weightKg > WEIGHT_MAX) {
      return { ok: false, code: "invalid_weight" };
    }
    var s = standardWeight(heightCm, sex);
    if (!s.ok) return s;
    var degree = round1((weightKg - s.standardWeightKg) / s.standardWeightKg * 100);
    var category = "normal";
    if (degree < -NORMAL_RANGE) category = "under";
    else if (degree > NORMAL_RANGE) category = "over";
    return { ok: true, standardWeightKg: s.standardWeightKg, degree: degree, category: category };
  }

  var api = {
    index: index,
    calculate: calculate,
    standardWeight: standardWeight,
    obesityDegree: obesityDegree,
    BAND_LOW: BAND_LOW,
    BAND_HIGH: BAND_HIGH
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.KaupCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
