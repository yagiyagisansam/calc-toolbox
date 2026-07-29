/*
 * 運転免許の更新期間・講習区分の判定ロジック
 *
 * 根拠(一次情報・e-Gov法令検索):
 * - 道路交通法 第101条第1項(免許証等の更新の申請)
 *   「当該免許証等の有効期間が満了する日の直前のその者の誕生日の一月前から
 *     当該免許証等の有効期間が満了する日までの間(以下「更新期間」という。)」
 *   https://laws.e-gov.go.jp/law/335AC0000000105 (2026年7月29日参照)
 * - 道路交通法 第95条の6第1項(免許証等の有効期間)の表
 *   優良運転者・一般運転者: 更新日等における年齢70歳未満=満了日等の後の5回目の誕生日から起算して1月を経過する日
 *                            70歳=4回目 / 71歳以上=3回目
 *   違反運転者等: 3回目の誕生日から起算して1月を経過する日
 *   同条備考一 ロ/ハ/ニ: 優良運転者=継続5年以上かつ遵守状況が優良(政令基準)、
 *                        一般運転者=優良・違反運転者等以外、
 *                        違反運転者等=継続5年以上で遵守状況が不良、または継続5年未満
 * - 道路交通法施行令 第33条の7(優良運転者及び違反運転者等に係る基準)
 *   第2項: 5年間に違反行為等をしたことがあること(軽微違反行為1回のほか違反がなく、
 *          その事故が建造物以外の物の損壊のみで報告義務違反もない場合を除く)
 *   https://laws.e-gov.go.jp/law/335CO0000000270 (2026年7月29日参照)
 * - 道路交通法施行規則 第38条第11項(更新時講習の区分と時間)
 *   優良運転者に対する講習=30分 / 一般運転者=1時間 / 違反運転者等=2時間(いずれの区分も2時間)
 *   https://laws.e-gov.go.jp/law/335M50000002060 (2026年7月29日参照)
 * - 道路交通法 第101条の4(70歳以上の者の特例)
 *   第1項: 更新期間満了日の年齢70歳以上は高齢者講習が必要
 *   第2項: 75歳以上は認知機能検査等が必要
 *   第3項: 75歳以上で一定の違反歴がある者は運転技能検査等が必要
 * - 警察庁 運転免許の更新
 *   https://www.npa.go.jp/policies/application/license_renewal/index.html (2026年7月29日参照)
 *
 * 前提:
 * - 免許証の有効期間満了日は「誕生日から起算して1月を経過する日」=誕生日の1か月後の応当日として扱う
 *   したがって更新期間は「誕生日の1か月前」から「誕生日の1か月後」までになる
 * - 月をまたぐ計算で応当日がない場合(例: 3月31日の1か月後)は、その月の末日に丸める
 * - 有効期間の末日が日曜日その他政令で定める日に当たるときは翌日が末日になる(法第95条の6第3項)が、
 *   本ツールは祝日等の判定をしないため反映していない
 * - 誕生日が2月29日の場合、うるう年以外の年は2月28日とみなす(法第101条第2項)。本ツールは日付を
 *   そのまま扱うため、この読み替えは行っていない
 * - 「初回更新者」は法律上は違反運転者等に含まれるが、講習の区分としては別に扱われる
 * - 免許停止・取消し、海外滞在などのやむを得ない理由による特例、免許の種類による違いは扱わない
 */
(function (global) {
  "use strict";

  var YEAR_MIN = 1950;
  var YEAR_MAX = 2100;

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function isInt(v) {
    return isFiniteNumber(v) && Math.floor(v) === v;
  }

  function daysInMonth(y, m) {
    return new Date(y, m, 0).getDate();
  }

  function isRealDate(y, m, d) {
    return isInt(y) && isInt(m) && isInt(d) &&
      y >= YEAR_MIN && y <= YEAR_MAX &&
      m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
  }

  /**
   * 年月日に月数を足し引きする。応当日がない場合はその月の末日に丸める。
   * @param {{y:number, m:number, d:number}} date 元の年月日
   * @param {number} months 足す月数(負なら引く)
   * @returns {{y:number, m:number, d:number}} 計算後の年月日
   */
  function addMonths(date, months) {
    var total = date.y * 12 + (date.m - 1) + months;
    var y = Math.floor(total / 12);
    var m = total % 12 + 1;
    return { y: y, m: m, d: Math.min(date.d, daysInMonth(y, m)) };
  }

  function toDays(date) {
    return Math.floor(Date.UTC(date.y, date.m - 1, date.d) / 86400000);
  }

  /**
   * 免許証の有効期限から、更新手続きができる期間を求める。
   * 更新期間は「有効期間満了日の直前の誕生日の1か月前」から「有効期間満了日」まで(法第101条第1項)。
   * 満了日は誕生日の1か月後にあたるため、開始日は満了日の2か月前になる。
   * @param {number} expiryYear 有効期限の年(1950〜2100)
   * @param {number} expiryMonth 有効期限の月(1〜12)
   * @param {number} expiryDay 有効期限の日(1〜その月の末日)
   * @returns {{ok:true, start:{y:number,m:number,d:number}, birthday:{y:number,m:number,d:number},
   *            end:{y:number,m:number,d:number}}
   *          |{ok:false, code:"invalid_expiry"}}
   *   start は更新期間の初日、birthday は満了日の直前の誕生日、end は更新期間の最終日(=有効期限)。
   */
  function renewalPeriod(expiryYear, expiryMonth, expiryDay) {
    if (!isRealDate(expiryYear, expiryMonth, expiryDay)) {
      return { ok: false, code: "invalid_expiry" };
    }
    var end = { y: expiryYear, m: expiryMonth, d: expiryDay };
    return {
      ok: true,
      start: addMonths(end, -2),
      birthday: addMonths(end, -1),
      end: end
    };
  }

  /**
   * 基準日が更新期間の前・中・後のどれに当たるかを判定する。
   * @param {number} expiryYear 有効期限の年
   * @param {number} expiryMonth 有効期限の月
   * @param {number} expiryDay 有効期限の日
   * @param {number} todayYear 基準日の年
   * @param {number} todayMonth 基準日の月
   * @param {number} todayDay 基準日の日
   * @returns {{ok:true, status:"before"|"open"|"expired", daysToStart:number, daysToEnd:number,
   *            start:{y:number,m:number,d:number}, end:{y:number,m:number,d:number}}
   *          |{ok:false, code:"invalid_expiry"|"invalid_today"}}
   *   status: before=まだ手続きできない / open=更新期間中 / expired=有効期限を過ぎている。
   *   daysToStart は開始日までの日数(過ぎていれば負)、daysToEnd は最終日までの日数(過ぎていれば負)。
   */
  function statusOn(expiryYear, expiryMonth, expiryDay, todayYear, todayMonth, todayDay) {
    var p = renewalPeriod(expiryYear, expiryMonth, expiryDay);
    if (!p.ok) return p;
    if (!isRealDate(todayYear, todayMonth, todayDay)) {
      return { ok: false, code: "invalid_today" };
    }
    var today = toDays({ y: todayYear, m: todayMonth, d: todayDay });
    var start = toDays(p.start);
    var end = toDays(p.end);
    var status = today < start ? "before" : (today <= end ? "open" : "expired");
    return {
      ok: true,
      status: status,
      daysToStart: start - today,
      daysToEnd: end - today,
      start: p.start,
      end: p.end
    };
  }

  /**
   * 継続免許期間・違反歴・年齢から、講習区分と次回の有効期間を判定する。
   * @param {number} continuousYears 更新日等までに継続して免許を受けている期間(年。0以上100以下)
   * @param {number} minorViolations 過去5年の軽微違反行為の回数(0以上の整数)
   * @param {boolean} seriousViolation 人身事故や重大な違反(軽微違反行為に当たらないもの)があるか
   * @param {number} ageAtRenewal 更新日等における年齢(歳。16〜120)
   * @returns {{ok:true, legalCategory:"excellent"|"general"|"violator",
   *            lectureCategory:"excellent"|"general"|"violator"|"first",
   *            lectureMinutes:30|60|120, validYears:3|4|5}
   *          |{ok:false, code:"invalid_years"|"invalid_violations"|"invalid_serious"|"invalid_age"}}
   *   legalCategory は法第95条の6第1項の表の区分(優良運転者/一般運転者/違反運転者等)。
   *   lectureCategory は更新時講習の区分で、継続5年未満かつ軽微違反1回以下なら "first"(初回更新者)。
   */
  function classify(continuousYears, minorViolations, seriousViolation, ageAtRenewal) {
    if (!isFiniteNumber(continuousYears) || continuousYears < 0 || continuousYears > 100) {
      return { ok: false, code: "invalid_years" };
    }
    if (!isInt(minorViolations) || minorViolations < 0 || minorViolations > 100) {
      return { ok: false, code: "invalid_violations" };
    }
    if (seriousViolation === undefined) seriousViolation = false;
    if (typeof seriousViolation !== "boolean") return { ok: false, code: "invalid_serious" };
    if (!isFiniteNumber(ageAtRenewal) || ageAtRenewal < 16 || ageAtRenewal > 120) {
      return { ok: false, code: "invalid_age" };
    }

    var clean = minorViolations === 0 && !seriousViolation;
    var lightOnly = minorViolations === 1 && !seriousViolation;

    var legalCategory, lectureCategory, lectureMinutes, validYears;
    if (continuousYears < 5) {
      // 継続5年未満は法律上は違反運転者等。講習は軽微違反1回以下なら初回更新者講習
      legalCategory = "violator";
      lectureCategory = (clean || lightOnly) ? "first" : "violator";
      lectureMinutes = 120;
      validYears = 3;
    } else if (clean) {
      legalCategory = "excellent";
      lectureCategory = "excellent";
      lectureMinutes = 30;
      validYears = ageAtRenewal < 70 ? 5 : (ageAtRenewal === 70 ? 4 : 3);
    } else if (lightOnly) {
      legalCategory = "general";
      lectureCategory = "general";
      lectureMinutes = 60;
      validYears = ageAtRenewal < 70 ? 5 : (ageAtRenewal === 70 ? 4 : 3);
    } else {
      legalCategory = "violator";
      lectureCategory = "violator";
      lectureMinutes = 120;
      validYears = 3;
    }

    return {
      ok: true,
      legalCategory: legalCategory,
      lectureCategory: lectureCategory,
      lectureMinutes: lectureMinutes,
      validYears: validYears
    };
  }

  /**
   * 更新期間満了日の年齢から、高齢者向けに必要な講習・検査を判定する(法第101条の4)。
   * @param {number} ageAtExpiry 更新期間が満了する日における年齢(歳。16〜120)
   * @returns {{ok:true, elderlyLecture:boolean, cognitiveTest:boolean, skillTestPossible:boolean}
   *          |{ok:false, code:"invalid_age"}}
   *   elderlyLecture=70歳以上で必要な高齢者講習、cognitiveTest=75歳以上で必要な認知機能検査等、
   *   skillTestPossible=75歳以上で一定の違反歴がある場合に必要となる運転技能検査等の対象年齢か。
   */
  function elderlyRequirement(ageAtExpiry) {
    if (!isFiniteNumber(ageAtExpiry) || ageAtExpiry < 16 || ageAtExpiry > 120) {
      return { ok: false, code: "invalid_age" };
    }
    return {
      ok: true,
      elderlyLecture: ageAtExpiry >= 70,
      cognitiveTest: ageAtExpiry >= 75,
      skillTestPossible: ageAtExpiry >= 75
    };
  }

  /**
   * 今回の有効期限と次回の有効期間の年数から、更新後の有効期限を求める。
   * 次回の満了日は「満了日等の後のN回目の誕生日から起算して1月を経過する日」であり、
   * 誕生日は満了日の1か月前にあたるため、結果として今回の満了日にN年を足した日になる。
   * @param {number} expiryYear 今回の有効期限の年
   * @param {number} expiryMonth 今回の有効期限の月
   * @param {number} expiryDay 今回の有効期限の日
   * @param {number} validYears 次回の有効期間(3・4・5のいずれか)
   * @returns {{ok:true, next:{y:number,m:number,d:number}}
   *          |{ok:false, code:"invalid_expiry"|"invalid_valid_years"}}
   */
  function nextExpiry(expiryYear, expiryMonth, expiryDay, validYears) {
    if (!isRealDate(expiryYear, expiryMonth, expiryDay)) {
      return { ok: false, code: "invalid_expiry" };
    }
    if (validYears !== 3 && validYears !== 4 && validYears !== 5) {
      return { ok: false, code: "invalid_valid_years" };
    }
    return {
      ok: true,
      next: addMonths({ y: expiryYear, m: expiryMonth, d: expiryDay }, validYears * 12)
    };
  }

  var api = {
    renewalPeriod: renewalPeriod,
    statusOn: statusOn,
    classify: classify,
    elderlyRequirement: elderlyRequirement,
    nextExpiry: nextExpiry
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.MenkyoKoshinCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
