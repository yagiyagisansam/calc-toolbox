/*
 * 各種届出の期限を計算するロジック
 *
 * 法令の時点: 2026年7月時点で施行されている条文による。
 *
 * 根拠(一次情報):
 * - 戸籍法(昭和22年法律第224号) e-Gov法令検索
 *   https://laws.e-gov.go.jp/law/322AC0000000224 (2026年7月29日参照)
 *   ・第43条「届出期間は、届出事件発生の日からこれを起算する。」(初日を算入する)
 *   ・第49条「出生の届出は、十四日以内(国外で出生があつたときは、三箇月以内)にこれをしなければならない。」
 *   ・第86条「死亡の届出は、届出義務者が、死亡の事実を知つた日から七日以内
 *     (国外で死亡があつたときは、その事実を知つた日から三箇月以内)に、これをしなければならない。」
 *   ・第41条 外国の方式で証書を作らせたときは三箇月以内に大使等へ提出
 *   ・第74条(婚姻)・第76条(離婚)には届出期限の定めがない(届出によって効力が生じる)
 *   ・第137条「正当な理由がなくて期間内にすべき届出又は申請をしない者は、五万円以下の過料に処する。」
 * - 住民基本台帳法(昭和42年法律第81号) e-Gov法令検索
 *   https://laws.e-gov.go.jp/law/342AC0000000081 (2026年7月29日参照)
 *   ・第22条 転入をした者は「転入をした日から十四日以内に」届け出なければならない
 *   ・第23条 転居をした者は「転居をした日から十四日以内に」届け出なければならない
 *   ・第24条 転出をする者は「あらかじめ」届け出なければならない(日数の定めはない)
 *   ・第25条 世帯変更は「その変更があつた日から十四日以内に」
 * - 民法(明治29年法律第89号) e-Gov法令検索
 *   https://laws.e-gov.go.jp/law/129AC0000000089 (2026年7月29日参照)
 *   ・第140条「日、週、月又は年によって期間を定めたときは、期間の初日は、算入しない。」
 *   ・第143条第2項「週、月又は年の初めから期間を起算しないときは、その期間は、最後の週、月又は年
 *     においてその起算日に応当する日の前日に満了する。ただし、月又は年によって期間を定めた場合に
 *     おいて、最後の月に応当する日がないときは、その月の末日に満了する。」
 *   ・第915条第1項「相続人は、自己のために相続の開始があったことを知った時から三箇月以内に、
 *     相続について、単純若しくは限定の承認又は放棄をしなければならない。」
 *
 * 前提:
 * - 戸籍法の届出(出生・死亡)は戸籍法第43条により初日を算入して数える。
 * - 住民基本台帳法・民法の期間は、特則がないため民法第140条により初日を算入しない(翌日起算)。
 * - 「箇月」の期間は民法第143条第2項に従い、起算日の応当日の前日に満了する。
 *   応当日がない月(1月31日の1か月後など)はその月の末日に満了する。
 * - 民法第142条(末日が休日のときの翌日満了)は「その日に取引をしない慣習がある場合に限る」ため
 *   一律には適用しない。末日の曜日は返すので、画面側で注意を促す。
 * - 婚姻届・離婚届など期限の定めがない届出は deadline を null で返す。
 * - 日付はすべてUTCのタイムスタンプで扱い、時差による1日ずれを避ける。
 */
(function (global) {
  "use strict";

  var YEAR_MIN = 1900;
  var YEAR_MAX = 2200;

  /* 届出の種類:
     unit  "day"=日数 / "month"=月数 / "none"=期限なし
     count 日数または月数
     first true=初日を算入する(戸籍法43条) / false=初日を算入しない(民法140条) */
  var KINDS = {
    birth:            { unit: "day",   count: 14, first: true,  abroad: { unit: "month", count: 3, first: true } },
    death:            { unit: "day",   count: 7,  first: true,  abroad: { unit: "month", count: 3, first: true } },
    moveIn:           { unit: "day",   count: 14, first: false, abroad: null },
    moveWithin:       { unit: "day",   count: 14, first: false, abroad: null },
    householdChange:  { unit: "day",   count: 14, first: false, abroad: null },
    moveOut:          { unit: "none",  count: 0,  first: false, abroad: null },
    marriage:         { unit: "none",  count: 0,  first: false, abroad: null },
    divorce:          { unit: "none",  count: 0,  first: false, abroad: null },
    inheritance:      { unit: "month", count: 3,  first: false, abroad: null },
    foreignCertificate: { unit: "month", count: 3, first: true, abroad: null }
  };

  var DAY_MS = 86400000;

  function isInt(v) {
    return typeof v === "number" && isFinite(v) && Math.floor(v) === v;
  }

  /* "YYYY-MM-DD" を UTC のタイムスタンプにする。存在しない日付は null */
  function parseDate(dateStr) {
    if (typeof dateStr !== "string") return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    if (!m) return null;
    var y = parseInt(m[1], 10), mo = parseInt(m[2], 10), d = parseInt(m[3], 10);
    if (y < YEAR_MIN || y > YEAR_MAX || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    var t = Date.UTC(y, mo - 1, d);
    var dt = new Date(t);
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    return t;
  }

  function formatDate(t) {
    var d = new Date(t);
    var mm = d.getUTCMonth() + 1, dd = d.getUTCDate();
    return d.getUTCFullYear() + "-" + (mm < 10 ? "0" : "") + mm + "-" + (dd < 10 ? "0" : "") + dd;
  }

  /* 起算日 t から months か月後の応当日の前日(民法143条2項)を返す */
  function monthEnd(t, months) {
    var d = new Date(t);
    var y = d.getUTCFullYear(), mo = d.getUTCMonth(), day = d.getUTCDate();
    var targetMonth = mo + months;
    var targetYear = y + Math.floor(targetMonth / 12);
    targetMonth = ((targetMonth % 12) + 12) % 12;
    var lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
    if (day > lastDay) {
      // 応当する日がないときは、その月の末日に満了する(前日を取らない)
      return Date.UTC(targetYear, targetMonth, lastDay);
    }
    return Date.UTC(targetYear, targetMonth, day) - DAY_MS;
  }

  /**
   * 届出の期限日を計算する
   * @param {string} kind 届出の種類。
   *   "birth"=出生届 / "death"=死亡届 / "moveIn"=転入届 / "moveWithin"=転居届 /
   *   "householdChange"=世帯変更届 / "moveOut"=転出届 / "marriage"=婚姻届 / "divorce"=離婚届 /
   *   "inheritance"=相続放棄・限定承認 / "foreignCertificate"=外国の方式による証書の提出
   * @param {string} dateStr 起点となる日("YYYY-MM-DD")。
   *   出生届は出生日、死亡届は死亡の事実を知った日、転入届は転入した日、
   *   相続放棄は自己のために相続の開始があったことを知った日
   * @param {boolean} abroad 国外での出来事かどうか(出生届・死亡届のみ期間が変わる)
   * @returns {{ok:true, kind:string, startDate:string, countedFrom:string, deadline:(string|null),
   *            unit:"day"|"month"|"none", count:number, includesFirstDay:boolean, weekday:(number|null)}
   *          |{ok:false, code:"invalid_kind"|"invalid_date"}}
   *   startDate は入力した起点の日、countedFrom は実際の起算日(初日不算入なら翌日)。
   *   deadline は期限日("YYYY-MM-DD")。期限の定めがない届出は null。
   *   weekday は期限日の曜日(0=日曜〜6=土曜)。deadline が null のときは null
   */
  function deadline(kind, dateStr, abroad) {
    if (typeof kind !== "string" || !Object.prototype.hasOwnProperty.call(KINDS, kind)) {
      return { ok: false, code: "invalid_kind" };
    }
    var t = parseDate(dateStr);
    if (t === null) return { ok: false, code: "invalid_date" };

    var rule = KINDS[kind];
    if (abroad === true && rule.abroad) rule = rule.abroad;

    if (rule.unit === "none") {
      return {
        ok: true, kind: kind, startDate: formatDate(t), countedFrom: formatDate(t),
        deadline: null, unit: "none", count: 0, includesFirstDay: false, weekday: null
      };
    }

    var start = rule.first ? t : t + DAY_MS;
    var end = rule.unit === "day" ? start + (rule.count - 1) * DAY_MS : monthEnd(start, rule.count);
    return {
      ok: true,
      kind: kind,
      startDate: formatDate(t),
      countedFrom: formatDate(start),
      deadline: formatDate(end),
      unit: rule.unit,
      count: rule.count,
      includesFirstDay: rule.first,
      weekday: new Date(end).getUTCDay()
    };
  }

  /**
   * 期限まであと何日あるかを求める
   * @param {string} kind 届出の種類(deadline と同じ)
   * @param {string} dateStr 起点となる日("YYYY-MM-DD")
   * @param {boolean} abroad 国外での出来事かどうか
   * @param {string} todayStr 今日の日付("YYYY-MM-DD")
   * @returns {{ok:true, deadline:(string|null), remainingDays:(number|null), expired:boolean}
   *          |{ok:false, code:"invalid_kind"|"invalid_date"}}
   *   remainingDays は今日を含めない残り日数(期限日当日なら0)。期限の定めがない届出は null
   */
  function remaining(kind, dateStr, abroad, todayStr) {
    var r = deadline(kind, dateStr, abroad);
    if (!r.ok) return r;
    var today = parseDate(todayStr);
    if (today === null) return { ok: false, code: "invalid_date" };
    if (r.deadline === null) {
      return { ok: true, deadline: null, remainingDays: null, expired: false };
    }
    var diff = Math.round((parseDate(r.deadline) - today) / DAY_MS);
    return { ok: true, deadline: r.deadline, remainingDays: diff, expired: diff < 0 };
  }

  var api = {
    deadline: deadline,
    remaining: remaining,
    KINDS: KINDS
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.TodokedeCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
