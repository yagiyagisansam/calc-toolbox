/*
 * メタボリックシンドローム(特定健診)の判定ロジック
 *
 * 根拠(一次情報):
 * - 厚生労働省「メタボリックシンドローム判定・保健指導レベル判定のロジックについて」
 *   https://www.mhlw.go.jp/content/12400000/001272427.pdf (2026年7月29日参照)
 *   ・判定1: 内臓脂肪面積>=100cm²、または腹囲 男性>=85cm / 女性>=90cm を満たすと判定に進む
 *   ・判定2(血糖): 空腹時血糖>=110mg/dL、またはHbA1c(NGSP値)>=6.0%、または服薬(血糖)ありで1リスク
 *   ・判定3(脂質): 中性脂肪>=150mg/dL、またはHDLコレステロール<40mg/dL、または服薬(脂質)ありで1リスク
 *   ・判定4(血圧): 収縮期>=130mmHg、または拡張期>=85mmHg、または服薬(血圧)ありで1リスク
 *   ・判定5: 追加リスク0=非該当 / 1=予備群該当 / 2以上=基準該当
 *   ・桁まるめは四捨五入で指定桁に合わせる
 * - 厚生労働省「特定健診・特定保健指導について」
 *   https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/0000161103.html (2026年7月29日参照)
 *
 * 前提:
 * - 40〜74歳を対象とする特定健康診査のメタボリックシンドローム判定のロジックのみを扱う
 * - 保健指導レベル(情報提供・動機づけ支援・積極的支援)の判定、喫煙リスク、年齢による分岐は扱わない
 * - 欠損値(未実施・測定不能)の「判定不能」処理は扱わない。すべての値を入力した前提で判定する
 */
(function (global) {
  "use strict";

  var WAIST_MALE = 85; // cm
  var WAIST_FEMALE = 90; // cm
  var VISCERAL_FAT = 100; // cm²
  var TG_LIMIT = 150; // mg/dL 以上で脂質リスク
  var HDL_LIMIT = 40; // mg/dL 未満で脂質リスク
  var SBP_LIMIT = 130; // mmHg 以上で血圧リスク
  var DBP_LIMIT = 85; // mmHg 以上で血圧リスク
  var FPG_LIMIT = 110; // mg/dL 以上で血糖リスク
  var HBA1C_LIMIT = 6.0; // % (NGSP値) 以上で血糖リスク

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function inRange(v, min, max) {
    return isFiniteNumber(v) && v >= min && v <= max;
  }

  /**
   * 健診値からメタボリックシンドロームの該当・予備群を判定する(基本形)。
   * @param {"male"|"female"} sex 性別
   * @param {number} waistCm 腹囲(cm)。30〜250
   * @param {number} systolic 収縮期血圧(mmHg)。50〜300
   * @param {number} diastolic 拡張期血圧(mmHg)。20〜200
   * @param {number} triglyceride 中性脂肪(mg/dL)。10〜5000
   * @param {number} hdl HDLコレステロール(mg/dL)。5〜200
   * @param {number} fastingGlucose 空腹時血糖(mg/dL)。20〜1000
   * @returns {{ok:true, waistOver:boolean, waistLimitCm:number,
   *            riskLipid:boolean, riskBloodPressure:boolean, riskGlucose:boolean,
   *            riskCount:number, result:"applicable"|"pre"|"not"}
   *          |{ok:false, code:string}}
   *   result は "applicable"=基準該当 / "pre"=予備群該当 / "not"=非該当。
   */
  function judge(sex, waistCm, systolic, diastolic, triglyceride, hdl, fastingGlucose) {
    return judgeFull({
      sex: sex,
      waistCm: waistCm,
      systolic: systolic,
      diastolic: diastolic,
      triglyceride: triglyceride,
      hdl: hdl,
      fastingGlucose: fastingGlucose
    });
  }

  /**
   * HbA1c・服薬・内臓脂肪面積まで含めてメタボリックシンドロームを判定する。
   * @param {object} input 判定に使う値
   * @param {"male"|"female"} input.sex 性別
   * @param {number} input.waistCm 腹囲(cm)。30〜250
   * @param {number} input.systolic 収縮期血圧(mmHg)。50〜300
   * @param {number} input.diastolic 拡張期血圧(mmHg)。20〜200
   * @param {number} input.triglyceride 中性脂肪(mg/dL)。10〜5000
   * @param {number} input.hdl HDLコレステロール(mg/dL)。5〜200
   * @param {number} input.fastingGlucose 空腹時血糖(mg/dL)。20〜1000
   * @param {number} [input.hba1c] HbA1c(NGSP値、%)。3〜20。省略可
   * @param {number} [input.visceralFatAreaCm2] 内臓脂肪面積(cm²)。0〜500。省略可
   * @param {boolean} [input.medBloodPressure] 血圧を下げる薬を服用しているか
   * @param {boolean} [input.medGlucose] 血糖を下げる薬(インスリン注射を含む)を使っているか
   * @param {boolean} [input.medLipid] 中性脂肪やコレステロールを下げる薬を服用しているか
   * @returns {{ok:true, waistOver:boolean, waistLimitCm:number,
   *            riskLipid:boolean, riskBloodPressure:boolean, riskGlucose:boolean,
   *            riskCount:number, result:"applicable"|"pre"|"not"}
   *          |{ok:false, code:"invalid_input"|"invalid_sex"|"invalid_waist"|"invalid_systolic"
   *            |"invalid_diastolic"|"invalid_triglyceride"|"invalid_hdl"|"invalid_glucose"
   *            |"invalid_hba1c"|"invalid_visceral_fat"}}
   */
  function judgeFull(input) {
    if (input === null || typeof input !== "object") return { ok: false, code: "invalid_input" };
    if (input.sex !== "male" && input.sex !== "female") return { ok: false, code: "invalid_sex" };
    if (!inRange(input.waistCm, 30, 250)) return { ok: false, code: "invalid_waist" };
    if (!inRange(input.systolic, 50, 300)) return { ok: false, code: "invalid_systolic" };
    if (!inRange(input.diastolic, 20, 200)) return { ok: false, code: "invalid_diastolic" };
    if (!inRange(input.triglyceride, 10, 5000)) return { ok: false, code: "invalid_triglyceride" };
    if (!inRange(input.hdl, 5, 200)) return { ok: false, code: "invalid_hdl" };
    if (!inRange(input.fastingGlucose, 20, 1000)) return { ok: false, code: "invalid_glucose" };
    var hasHba1c = input.hba1c !== undefined && input.hba1c !== null && input.hba1c !== "";
    if (hasHba1c && !inRange(input.hba1c, 3, 20)) return { ok: false, code: "invalid_hba1c" };
    var hasVfa = input.visceralFatAreaCm2 !== undefined && input.visceralFatAreaCm2 !== null
      && input.visceralFatAreaCm2 !== "";
    if (hasVfa && !inRange(input.visceralFatAreaCm2, 0, 500)) return { ok: false, code: "invalid_visceral_fat" };

    var waistLimit = input.sex === "male" ? WAIST_MALE : WAIST_FEMALE;
    var waistOver = input.waistCm >= waistLimit || (hasVfa && input.visceralFatAreaCm2 >= VISCERAL_FAT);

    var riskLipid = input.triglyceride >= TG_LIMIT || input.hdl < HDL_LIMIT || input.medLipid === true;
    var riskBp = input.systolic >= SBP_LIMIT || input.diastolic >= DBP_LIMIT || input.medBloodPressure === true;
    var riskGlucose = input.fastingGlucose >= FPG_LIMIT
      || (hasHba1c && input.hba1c >= HBA1C_LIMIT)
      || input.medGlucose === true;

    var riskCount = (riskLipid ? 1 : 0) + (riskBp ? 1 : 0) + (riskGlucose ? 1 : 0);
    var result;
    if (!waistOver) result = "not";
    else if (riskCount >= 2) result = "applicable";
    else if (riskCount === 1) result = "pre";
    else result = "not";

    return {
      ok: true,
      waistOver: waistOver,
      waistLimitCm: waistLimit,
      riskLipid: riskLipid,
      riskBloodPressure: riskBp,
      riskGlucose: riskGlucose,
      riskCount: riskCount,
      result: result
    };
  }

  /**
   * 該当・予備群を外すために、腹囲をあと何cm減らす必要があるかを返す。
   * @param {"male"|"female"} sex 性別
   * @param {number} waistCm 現在の腹囲(cm)。30〜250
   * @returns {{ok:true, waistLimitCm:number, overCm:number}|{ok:false, code:"invalid_sex"|"invalid_waist"}}
   *   overCm は基準を超えている分(cm、小数第1位で四捨五入)。基準未満なら0。
   */
  function waistGap(sex, waistCm) {
    if (sex !== "male" && sex !== "female") return { ok: false, code: "invalid_sex" };
    if (!inRange(waistCm, 30, 250)) return { ok: false, code: "invalid_waist" };
    var limit = sex === "male" ? WAIST_MALE : WAIST_FEMALE;
    return { ok: true, waistLimitCm: limit, overCm: Math.max(0, Math.round((waistCm - limit) * 10) / 10) };
  }

  var api = {
    WAIST_MALE: WAIST_MALE,
    WAIST_FEMALE: WAIST_FEMALE,
    judge: judge,
    judgeFull: judgeFull,
    waistGap: waistGap
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.MetaboCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
