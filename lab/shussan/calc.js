/*
 * 出産手当金・出産育児一時金の計算ロジック
 *
 * 制度・金額の時点: 2026年7月時点の全国健康保険協会(協会けんぽ)の給付内容。
 *
 * 根拠(一次情報):
 * - 全国健康保険協会「出産手当金」
 *   https://www.kyoukaikenpo.or.jp/benefit/childbirth/001/index.html (2026年7月29日参照)
 *   ・支給範囲: 出産の日(実際の出産が予定日後のときは出産予定日)以前42日
 *     (多胎妊娠の場合98日)から出産の翌日以後56日目までの範囲内で会社を休んだ期間
 *   ・出産日は出産の日以前の期間に含まれる。予定日より遅れた期間も支給対象
 *   ・支給額例: 標準報酬月額の平均17万円 → 17万円÷30≒5,670円(10円未満四捨五入)
 *     → 5,670円×2/3＝3,780円(1円未満四捨五入)
 *   ・支給開始日以前の期間が12か月に満たない場合は、実際の平均額と
 *     32万円(支給開始日が令和7年4月1日以降)のいずれか低い額を使う
 * - 全国健康保険協会「出産育児一時金」
 *   https://www.kyoukaikenpo.or.jp/benefit/childbirth/002/index.html (2026年7月29日参照)
 *   ・2023年4月1日以降の出産: 産科医療補償制度加入機関で在胎週数22週以降の出産は1児につき50万円、
 *     それ以外(加入機関で22週未満・未加入機関での出産)は1児につき48.8万円。多胎児は胎児数分
 * - 厚生労働省「出産育児一時金等について」(令和5年4月から原則42万円→原則50万円)
 *   https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/kenkou_iryou/iryouhoken/shussan/index.html (2026年7月29日参照)
 *
 * 前提:
 * - 協会けんぽ(健康保険の被保険者本人)を前提とする。健康保険組合の付加給付や
 *   国民健康保険(出産手当金は任意給付で通常なし)は考慮しない。
 * - 産前産後休業の全期間を休み、その間の給与の支払いが無い場合の満額を計算する。
 *   給与の一部が支払われた場合や傷病手当金と重なる場合は減額・調整される。
 * - 支給日数は制度上の上限日数。実際は「会社を休んだ日」だけが対象になる。
 */
(function (global) {
  "use strict";

  var LUMP_SUM_COVERED = 500000;      // 産科医療補償制度加入機関・在胎週数22週以降(2023年4月1日以降の出産)
  var LUMP_SUM_NOT_COVERED = 488000;  // それ以外
  var SHORT_PERIOD_CAP = 320000;      // 加入12か月未満のときの上限(支給開始日が令和7年4月1日以降)
  var PRENATAL_SINGLE = 42;           // 産前日数(単胎)
  var PRENATAL_MULTIPLE = 98;         // 産前日数(多胎)
  var POSTNATAL = 56;                 // 産後日数
  var AVG_MIN = 10000;                // 標準報酬月額の平均の入力下限(常識的な範囲チェック)
  var AVG_MAX = 2000000;              // 同上限
  var MAX_DELAY = 60;                 // 予定日より遅れた日数の上限(これを超える入力は誤りとみなす)
  var MAX_EARLY = 140;                // 予定日より早い日数の上限(同上)
  var MAX_BABIES = 5;                 // 胎児数の上限

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function isIntIn(v, min, max) {
    return isFiniteNumber(v) && v === Math.floor(v) && v >= min && v <= max;
  }

  function isRealDate(y, m, d) {
    if (!isIntIn(y, 1900, 2200) || !isIntIn(m, 1, 12) || !isIntIn(d, 1, 31)) return false;
    var dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }

  function dayDiff(y1, m1, d1, y2, m2, d2) {
    var a = Date.UTC(y1, m1 - 1, d1);
    var b = Date.UTC(y2, m2 - 1, d2);
    return Math.round((b - a) / 86400000);
  }

  /**
   * 支給の計算に使う「標準報酬月額の平均」を決める。
   * 加入期間が12か月に満たない場合は、実際の平均額と32万円の低いほうを使う。
   * @param {number} avgStandardMonthly 標準報酬月額の平均(円、10000〜2000000)
   * @param {boolean} [hasTwelveMonths=true] 支給開始日以前の加入期間が12か月以上あるか
   * @returns {{ok:true, base:number, capped:boolean}|{ok:false, code:"invalid_average"}}
   *   base: 計算に使う額(円)、capped: 32万円の上限が適用されたか
   */
  function applicableAverage(avgStandardMonthly, hasTwelveMonths) {
    if (!isFiniteNumber(avgStandardMonthly) ||
        avgStandardMonthly < AVG_MIN || avgStandardMonthly > AVG_MAX) {
      return { ok: false, code: "invalid_average" };
    }
    var full = hasTwelveMonths === undefined ? true : !!hasTwelveMonths;
    if (!full && avgStandardMonthly > SHORT_PERIOD_CAP) {
      return { ok: true, base: SHORT_PERIOD_CAP, capped: true };
    }
    return { ok: true, base: avgStandardMonthly, capped: false };
  }

  /**
   * 出産手当金の1日あたりの支給額。
   * 標準報酬月額の平均 ÷ 30(10円未満四捨五入)× 2/3(1円未満四捨五入)。
   * 丸めは協会けんぽの支給額例と同じ順序・単位で行う。
   * @param {number} avgStandardMonthly 標準報酬月額の平均(円、10000〜2000000)
   * @param {boolean} [hasTwelveMonths=true] 支給開始日以前の加入期間が12か月以上あるか
   * @returns {{ok:true, base:number, capped:boolean, dailyBase:number, daily:number}
   *          |{ok:false, code:"invalid_average"}}
   *   dailyBase: 平均額の30分の1(10円未満四捨五入)、daily: 1日あたり支給額(円)
   */
  function dailyAmount(avgStandardMonthly, hasTwelveMonths) {
    var a = applicableAverage(avgStandardMonthly, hasTwelveMonths);
    if (!a.ok) return a;
    var dailyBase = Math.round(a.base / 30 / 10) * 10;
    var daily = Math.round(dailyBase * 2 / 3);
    return { ok: true, base: a.base, capped: a.capped, dailyBase: dailyBase, daily: daily };
  }

  /**
   * 出産手当金の支給日数(制度上の上限日数)。
   * 産前 = 42日(多胎98日)。予定日より遅れて出産した場合はその遅れた日数を加える。
   * 産後 = 56日。予定日より早く産まれた場合、産前は出産日以前42日(多胎98日)で数える。
   * @param {number} dueY 出産予定日の年 @param {number} dueM 月 @param {number} dueD 日
   * @param {number} birthY 実際の出産日の年 @param {number} birthM 月 @param {number} birthD 日
   * @param {boolean} [isMultiple=false] 多胎妊娠か
   * @returns {{ok:true, prenatalDays:number, delayDays:number, postnatalDays:number,
   *            totalDays:number, early:boolean}
   *          |{ok:false, code:"invalid_due_date"|"invalid_birth_date"}}
   *   prenatalDays は遅れた日数を含まない基本の産前日数。totalDays が合計の支給日数。
   */
  function supportDays(dueY, dueM, dueD, birthY, birthM, birthD, isMultiple) {
    if (!isRealDate(dueY, dueM, dueD)) return { ok: false, code: "invalid_due_date" };
    if (!isRealDate(birthY, birthM, birthD)) return { ok: false, code: "invalid_birth_date" };
    var diff = dayDiff(dueY, dueM, dueD, birthY, birthM, birthD); // 正なら予定日より遅い
    if (diff > MAX_DELAY || diff < -MAX_EARLY) return { ok: false, code: "invalid_birth_date" };
    var prenatal = isMultiple ? PRENATAL_MULTIPLE : PRENATAL_SINGLE;
    var delay = diff > 0 ? diff : 0;
    return {
      ok: true,
      prenatalDays: prenatal,
      delayDays: delay,
      postnatalDays: POSTNATAL,
      totalDays: prenatal + delay + POSTNATAL,
      early: diff < 0
    };
  }

  /**
   * 出産育児一時金の額(2023年4月1日以降の出産)。
   * 産科医療補償制度に加入する医療機関等で在胎週数22週以降に出産した場合は1児50万円、
   * それ以外は1児48.8万円。多胎児は胎児数分が支給される。
   * @param {number} babies 胎児数(1〜5の整数)
   * @param {boolean} [covered=true] 産科医療補償制度加入機関で在胎週数22週以降の出産か
   * @returns {{ok:true, perBaby:number, total:number}|{ok:false, code:"invalid_babies"}}
   */
  function lumpSum(babies, covered) {
    if (!isIntIn(babies, 1, MAX_BABIES)) return { ok: false, code: "invalid_babies" };
    var per = (covered === undefined ? true : !!covered) ? LUMP_SUM_COVERED : LUMP_SUM_NOT_COVERED;
    return { ok: true, perBaby: per, total: per * babies };
  }

  /**
   * 出産手当金と出産育児一時金の合計見込み額。
   * 多胎かどうかは胎児数が2以上かで判定する。
   * @param {number} avgStandardMonthly 標準報酬月額の平均(円)
   * @param {number} dueY 出産予定日の年 @param {number} dueM 月 @param {number} dueD 日
   * @param {number} birthY 実際の出産日の年 @param {number} birthM 月 @param {number} birthD 日
   * @param {number} [babies=1] 胎児数(1〜5)
   * @param {boolean} [covered=true] 産科医療補償制度加入機関で在胎週数22週以降の出産か
   * @param {boolean} [hasTwelveMonths=true] 支給開始日以前の加入期間が12か月以上あるか
   * @returns {{ok:true, daily:number, dailyBase:number, base:number, capped:boolean,
   *            prenatalDays:number, delayDays:number, postnatalDays:number, totalDays:number,
   *            early:boolean, allowanceTotal:number, lumpSumPerBaby:number,
   *            lumpSumTotal:number, total:number}
   *          |{ok:false, code:string}}
   *   code: "invalid_average"|"invalid_due_date"|"invalid_birth_date"|"invalid_babies"
   *   allowanceTotal は出産手当金の合計(1日あたり×支給日数)、total は一時金を含む合計(円)。
   */
  function calculate(avgStandardMonthly, dueY, dueM, dueD, birthY, birthM, birthD,
                     babies, covered, hasTwelveMonths) {
    var n = babies === undefined ? 1 : babies;
    var d = dailyAmount(avgStandardMonthly, hasTwelveMonths);
    if (!d.ok) return d;
    if (!isIntIn(n, 1, MAX_BABIES)) return { ok: false, code: "invalid_babies" };
    var days = supportDays(dueY, dueM, dueD, birthY, birthM, birthD, n >= 2);
    if (!days.ok) return days;
    var ls = lumpSum(n, covered);
    if (!ls.ok) return ls;
    var allowance = d.daily * days.totalDays;
    return {
      ok: true,
      daily: d.daily,
      dailyBase: d.dailyBase,
      base: d.base,
      capped: d.capped,
      prenatalDays: days.prenatalDays,
      delayDays: days.delayDays,
      postnatalDays: days.postnatalDays,
      totalDays: days.totalDays,
      early: days.early,
      allowanceTotal: allowance,
      lumpSumPerBaby: ls.perBaby,
      lumpSumTotal: ls.total,
      total: allowance + ls.total
    };
  }

  var api = {
    applicableAverage: applicableAverage,
    dailyAmount: dailyAmount,
    supportDays: supportDays,
    lumpSum: lumpSum,
    calculate: calculate,
    LUMP_SUM_COVERED: LUMP_SUM_COVERED,
    LUMP_SUM_NOT_COVERED: LUMP_SUM_NOT_COVERED,
    SHORT_PERIOD_CAP: SHORT_PERIOD_CAP
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.ShussanCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
