/*
 * 1日の水分摂取量の目安 計算ロジック
 *
 * 根拠(一次情報):
 * - Omni Calculator "Water Intake Calculator"
 *   https://www.omnicalculator.com/health/water-intake (2026年7月29日参照)
 *   目安量は Institute of Medicine (現 National Academy of Medicine)
 *   "Dietary Reference Intakes for Water, Potassium, Sodium, Chloride, and Sulfate" (2005)
 *   の Adequate Intake (AI: 総水分量の目安) に基づく。
 *   同ページより: 総水分量のうち飲み物からがおよそ81%、食品からがおよそ19%。
 *   運動中の補給は1時間あたり17〜25オンス(約500〜750mL)、
 *   体重が重い人や暑い条件では最大28オンス(約830mL)まで。
 *   体重からの簡易法は「体重(ポンド)÷2 = 必要量(液量オンス)」。
 * - 環境省・国土交通省「健康のため水を飲もう」推進運動
 *   https://www.env.go.jp/water/water_supply/nomou/index.html (2026年7月29日参照)
 *   日本での水分補給の啓発。1日の水の排出量は尿・便で1.6L、呼吸や汗で0.9Lの合計2.5L。
 *
 * 前提:
 * - AIは「健康な人の集団で不足しない量の目安」であり、個人に必要な量を示す値ではない。
 *   体格・気温・活動量・体調・持病・服薬で必要量は大きく変わる。
 * - 心不全・腎疾患などで水分制限を受けている場合は、医師の指示を必ず優先すること。
 * - 数値はすべて目安。のどの渇きや尿の色も合わせて判断する。
 */
(function (global) {
  "use strict";

  // Institute of Medicine (2005) の Adequate Intake。総水分量(食品由来を含む)mL/日
  var AI_CHILD = [
    { maxAge: 0.5, ml: 700 }, // 0〜6か月
    { maxAge: 1, ml: 800 }, // 7〜12か月
    { maxAge: 3, ml: 1300 }, // 1〜3歳
    { maxAge: 8, ml: 1700 } // 4〜8歳
  ];
  var AI_FEMALE = [
    { maxAge: 13, ml: 2100 }, // 9〜13歳
    { maxAge: 18, ml: 2300 }, // 14〜18歳
    { maxAge: 120, ml: 2700 } // 19歳以上
  ];
  var AI_MALE = [
    { maxAge: 13, ml: 2400 }, // 9〜13歳
    { maxAge: 18, ml: 3300 }, // 14〜18歳
    { maxAge: 120, ml: 3700 } // 19歳以上
  ];

  var DRINK_SHARE = 0.81; // 総水分量のうち飲み物からとる割合

  // 運動1時間あたりの補給量(mL)。Omni Calculator の記載による
  var EXERCISE_RATE = {
    cool: { min: 475, max: 530 }, // 体重が軽い人・涼しい環境
    normal: { min: 500, max: 750 }, // 一般的な目安
    hot: { min: 500, max: 830 } // 体重が重い人・暑い環境(上限28オンス)
  };

  // 体重(kg) → 必要量(mL) の換算係数。ポンド÷2 液量オンス を SI に直したもの
  // 1 kg = 2.20462262 lb、1 US fl oz = 29.5735296 mL
  var ML_PER_KG = (2.20462262 / 2) * 29.5735296; // ≒ 32.6 mL/kg

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function pick(rows, age) {
    for (var i = 0; i < rows.length; i++) {
      if (age <= rows[i].maxAge) return rows[i].ml;
    }
    return rows[rows.length - 1].ml;
  }

  /**
   * 年齢と性別から1日の総水分量の目安(Adequate Intake)を返す
   * @param {number} age 年齢(歳)。0以上120以下。0.5は生後6か月を表す
   * @param {string} sex "male"=男性 / "female"=女性。9歳未満では結果に影響しない
   * @returns {{ok:true, totalWaterMl:number, fromDrinksMl:number, fromFoodMl:number}
   *          |{ok:false, code:"invalid_age"|"invalid_sex"}}
   *   totalWaterMl: 食品由来を含む1日の総水分量の目安(mL)
   *   fromDrinksMl: そのうち飲み物からとる量(mL、1mL未満四捨五入)
   *   fromFoodMl: 食品からとる量(mL、1mL未満四捨五入)
   */
  function adequateIntake(age, sex) {
    if (sex !== "male" && sex !== "female") return { ok: false, code: "invalid_sex" };
    if (!isFiniteNumber(age) || age < 0 || age > 120) return { ok: false, code: "invalid_age" };
    var total = age <= 8 ? pick(AI_CHILD, age) : pick(sex === "male" ? AI_MALE : AI_FEMALE, age);
    var drinks = Math.round(total * DRINK_SHARE);
    return { ok: true, totalWaterMl: total, fromDrinksMl: drinks, fromFoodMl: total - drinks };
  }

  /**
   * 体重から必要量を概算する(体重(ポンド)÷2 液量オンス の簡易法)
   * @param {number} weightKg 体重(kg)。0より大きく300以下
   * @returns {{ok:true, ml:number, mlPerKg:number}|{ok:false, code:"invalid_weight"}}
   *   ml: 1日の目安量(mL、10mL単位に四捨五入。簡易法なので細かい桁に意味はない)
   *   mlPerKg: 体重1kgあたりの量(mL、小数第1位で四捨五入)
   */
  function weightBased(weightKg) {
    if (!isFiniteNumber(weightKg) || weightKg <= 0 || weightKg > 300) {
      return { ok: false, code: "invalid_weight" };
    }
    var ml = weightKg * ML_PER_KG;
    return {
      ok: true,
      ml: Math.round(ml / 10) * 10,
      mlPerKg: Math.round(ML_PER_KG * 10) / 10
    };
  }

  /**
   * 運動による追加の補給量を求める
   * @param {number} hours 運動時間(h)。0以上12以下
   * @param {string} condition "cool"=涼しい / "normal"=ふつう / "hot"=暑い環境
   * @returns {{ok:true, minMl:number, maxMl:number, perHourMinMl:number, perHourMaxMl:number}
   *          |{ok:false, code:"invalid_hours"|"invalid_condition"}}
   *   minMl/maxMl: 運動時間全体での追加量の幅(mL、10mL単位に四捨五入)
   */
  function exerciseAddition(hours, condition) {
    if (!EXERCISE_RATE[condition]) return { ok: false, code: "invalid_condition" };
    if (!isFiniteNumber(hours) || hours < 0 || hours > 12) return { ok: false, code: "invalid_hours" };
    var r = EXERCISE_RATE[condition];
    return {
      ok: true,
      minMl: Math.round((r.min * hours) / 10) * 10,
      maxMl: Math.round((r.max * hours) / 10) * 10,
      perHourMinMl: r.min,
      perHourMaxMl: r.max
    };
  }

  /**
   * 年齢・性別・体重・運動時間・環境から1日に飲む水の目安をまとめて求める
   * @param {number} age 年齢(歳)。0以上120以下
   * @param {string} sex "male"=男性 / "female"=女性
   * @param {number} weightKg 体重(kg)。0より大きく300以下
   * @param {number} exerciseHours 運動時間(h)。0以上12以下
   * @param {string} condition "cool"=涼しい / "normal"=ふつう / "hot"=暑い環境
   * @returns {{ok:true, totalWaterMl:number, fromDrinksMl:number, fromFoodMl:number,
   *            weightBasedMl:number, exerciseMinMl:number, exerciseMaxMl:number,
   *            drinkMinMl:number, drinkMaxMl:number, glassesMin:number, glassesMax:number}
   *          |{ok:false, code:string}}
   *   drinkMinMl/drinkMaxMl: 飲み物からとる量に運動分を足した1日の目安の幅(mL)
   *   glassesMin/glassesMax: コップ(200mL)何杯にあたるか(小数第1位で四捨五入)
   */
  function calculate(age, sex, weightKg, exerciseHours, condition) {
    var ai = adequateIntake(age, sex);
    if (!ai.ok) return ai;
    var wb = weightBased(weightKg);
    if (!wb.ok) return wb;
    var ex = exerciseAddition(exerciseHours, condition);
    if (!ex.ok) return ex;
    var minMl = ai.fromDrinksMl + ex.minMl;
    var maxMl = ai.fromDrinksMl + ex.maxMl;
    return {
      ok: true,
      totalWaterMl: ai.totalWaterMl,
      fromDrinksMl: ai.fromDrinksMl,
      fromFoodMl: ai.fromFoodMl,
      weightBasedMl: wb.ml,
      exerciseMinMl: ex.minMl,
      exerciseMaxMl: ex.maxMl,
      drinkMinMl: minMl,
      drinkMaxMl: maxMl,
      glassesMin: Math.round((minMl / 200) * 10) / 10,
      glassesMax: Math.round((maxMl / 200) * 10) / 10
    };
  }

  var api = {
    calculate: calculate,
    adequateIntake: adequateIntake,
    weightBased: weightBased,
    exerciseAddition: exerciseAddition
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.SuibunCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
