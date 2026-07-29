/*
 * 血圧分類の判定ロジック
 *
 * 根拠(一次情報):
 * - 厚生労働省 健康日本21アクション支援システム(旧 e-ヘルスネット)
 *   「メタボリックシンドロームの診断基準」内『成人における血圧値の分類』
 *   https://kennet.mhlw.go.jp/information/information/metabolic/m-05-003.html (2026年7月29日参照)
 *   出典表記: 日本高血圧学会「高血圧治療ガイドライン2019(JSH2019)」
 * - 日本高血圧学会 ガイドラインのページ(最新版は「高血圧管理・治療ガイドライン2025」2025年8月29日発行)
 *   https://www.jpnsh.jp/guideline.html (2026年7月29日参照)
 *
 * 分類表(mmHg):
 *   診察室血圧  正常血圧 <120かつ<80 / 正常高値血圧 120-129かつ<80 / 高値血圧 130-139または80-89 /
 *               I度 140-159または90-99 / II度 160-179または100-109 / III度 >=180または>=110 /
 *               (孤立性)収縮期高血圧 >=140かつ<90
 *   家庭血圧    正常血圧 <115かつ<75 / 正常高値血圧 115-124かつ<75 / 高値血圧 125-134または75-84 /
 *               I度 135-144または85-89 / II度 145-159または90-99 / III度 >=160または>=100 /
 *               (孤立性)収縮期高血圧 >=135かつ<85
 *
 * 前提:
 * - 収縮期・拡張期のうち「重い方の区分」を採用する(表の一般的な読み方)
 * - 高血圧の診断は複数回の測定にもとづくもので、1回の測定値で確定するものではない
 * - 治療方針・降圧目標は本ツールでは扱わない(2025年版で診察室血圧130/80mmHg未満に一本化)
 */
(function (global) {
  "use strict";

  var SBP_MIN = 50, SBP_MAX = 300;
  var DBP_MIN = 20, DBP_MAX = 200;

  // レベル: 0=正常血圧 1=正常高値血圧 2=高値血圧 3=I度 4=II度 5=III度
  var LEVEL_KEYS = ["normal", "high_normal", "elevated", "grade1", "grade2", "grade3"];

  // [場所] 収縮期のしきい値(この値以上でレベルが上がる) / 拡張期のしきい値
  var TABLE = {
    office: {
      sbp: [120, 130, 140, 160, 180], // >=120→1, >=130→2, >=140→3, >=160→4, >=180→5
      dbp: [80, 90, 100, 110], // >=80→2, >=90→3, >=100→4, >=110→5
      htSbp: 140,
      htDbp: 90
    },
    home: {
      sbp: [115, 125, 135, 145, 160],
      dbp: [75, 85, 90, 100],
      htSbp: 135,
      htDbp: 85
    }
  };

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function sbpLevel(sbp, t) {
    var level = 0;
    for (var i = 0; i < t.sbp.length; i++) {
      if (sbp >= t.sbp[i]) level = i + 1;
    }
    return level;
  }

  function dbpLevel(dbp, t) {
    // 拡張期はレベル1(正常高値)が存在しないため、最初のしきい値を超えたらレベル2から始まる
    var level = 0;
    for (var i = 0; i < t.dbp.length; i++) {
      if (dbp >= t.dbp[i]) level = i + 2;
    }
    return level;
  }

  /**
   * 収縮期・拡張期血圧から血圧分類を判定する。
   * @param {number} systolic 収縮期血圧(上、mmHg)。50〜300
   * @param {number} diastolic 拡張期血圧(下、mmHg)。20〜200
   * @param {"office"|"home"} [place="office"] 測定場所。"office"=診察室 / "home"=家庭
   * @returns {{ok:true, place:string, level:number, category:string,
   *            systolicLevel:number, diastolicLevel:number,
   *            isolatedSystolic:boolean, isHypertension:boolean}
   *          |{ok:false, code:"invalid_systolic"|"invalid_diastolic"|"invalid_place"|"invalid_pair"}}
   *   category は "normal"|"high_normal"|"elevated"|"grade1"|"grade2"|"grade3"。
   *   isolatedSystolic は(孤立性)収縮期高血圧に当たるか。isHypertension は I度以上か。
   */
  function classify(systolic, diastolic, place) {
    var p = place === undefined ? "office" : place;
    if (p !== "office" && p !== "home") return { ok: false, code: "invalid_place" };
    if (!isFiniteNumber(systolic) || systolic < SBP_MIN || systolic > SBP_MAX) {
      return { ok: false, code: "invalid_systolic" };
    }
    if (!isFiniteNumber(diastolic) || diastolic < DBP_MIN || diastolic > DBP_MAX) {
      return { ok: false, code: "invalid_diastolic" };
    }
    if (systolic <= diastolic) return { ok: false, code: "invalid_pair" };
    var t = TABLE[p];
    var sl = sbpLevel(systolic, t);
    var dl = dbpLevel(diastolic, t);
    var level = Math.max(sl, dl);
    return {
      ok: true,
      place: p,
      level: level,
      category: LEVEL_KEYS[level],
      systolicLevel: sl,
      diastolicLevel: dl,
      isolatedSystolic: level >= 3 && systolic >= t.htSbp && diastolic < t.htDbp,
      isHypertension: level >= 3
    };
  }

  /**
   * 診察室血圧と家庭血圧の組み合わせから、白衣高血圧・仮面高血圧などの型を判定する。
   * @param {number} officeSystolic 診察室の収縮期血圧(mmHg)
   * @param {number} officeDiastolic 診察室の拡張期血圧(mmHg)
   * @param {number} homeSystolic 家庭の収縮期血圧(mmHg)
   * @param {number} homeDiastolic 家庭の拡張期血圧(mmHg)
   * @returns {{ok:true, type:"sustained"|"white_coat"|"masked"|"normotension",
   *            officeHypertension:boolean, homeHypertension:boolean}
   *          |{ok:false, code:string}}
   *   sustained=持続性高血圧 / white_coat=白衣高血圧 / masked=仮面高血圧 / normotension=どちらも高血圧でない
   */
  function compareOfficeHome(officeSystolic, officeDiastolic, homeSystolic, homeDiastolic) {
    var o = classify(officeSystolic, officeDiastolic, "office");
    if (!o.ok) return o;
    var h = classify(homeSystolic, homeDiastolic, "home");
    if (!h.ok) return h;
    var type;
    if (o.isHypertension && h.isHypertension) type = "sustained";
    else if (o.isHypertension && !h.isHypertension) type = "white_coat";
    else if (!o.isHypertension && h.isHypertension) type = "masked";
    else type = "normotension";
    return { ok: true, type: type, officeHypertension: o.isHypertension, homeHypertension: h.isHypertension };
  }

  /**
   * 指定した測定場所の分類しきい値を返す(画面での表表示用)。
   * @param {"office"|"home"} place 測定場所
   * @returns {{ok:true, place:string, sbp:number[], dbp:number[], htSbp:number, htDbp:number}
   *          |{ok:false, code:"invalid_place"}}
   */
  function thresholds(place) {
    if (place !== "office" && place !== "home") return { ok: false, code: "invalid_place" };
    var t = TABLE[place];
    return { ok: true, place: place, sbp: t.sbp.slice(), dbp: t.dbp.slice(), htSbp: t.htSbp, htDbp: t.htDbp };
  }

  var api = {
    LEVEL_KEYS: LEVEL_KEYS,
    classify: classify,
    compareOfficeHome: compareOfficeHome,
    thresholds: thresholds
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.KetsuatsuCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
