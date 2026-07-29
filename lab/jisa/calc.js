/*
 * 世界の時差 換算ロジック
 *
 * 根拠(一次情報):
 * - IANA Time Zone Database (tz database) https://www.iana.org/time-zones (2026年7月29日参照)
 *   世界の各地域のUTCオフセットとサマータイム(DST)の切替規則を収録した、
 *   時刻計算の事実上の標準データベース。
 * - 本ロジックは外部通信を一切せず、実行環境(ブラウザ・Node.js)に組み込まれている
 *   ECMAScript の Intl.DateTimeFormat 経由でこのデータベースを参照する。
 *   タイムゾーンは "Asia/Tokyo" のようなIANAのタイムゾーン名で指定する。
 *
 * データの時点:
 * - オフセットとDST規則は、閲覧している端末(ブラウザ・OS)が持つtzデータの版によって決まる。
 *   各国の制度変更が端末に反映されていない場合、将来の日付の結果がずれることがある。
 *   重要な予定は現地の公式情報で必ず確認すること。
 *
 * 前提:
 * - 入力は「基準都市の壁時計時刻」。DSTの切替で存在しない時刻(春の1時間飛ばし)や
 *   2回ある時刻(秋の1時間巻き戻し)を指定した場合は skipped / ambiguous を true で返す。
 * - 秒は扱わない(分単位)。
 * - 歴史的な日付でもtzデータにある限り当時の規則で計算される。
 */
(function (global) {
  "use strict";

  var MS_PER_MINUTE = 60000;
  var MIN_YEAR = 1900;
  var MAX_YEAR = 2200;

  function isInt(v) {
    return typeof v === "number" && isFinite(v) && Math.floor(v) === v;
  }

  function isValidZone(tz) {
    if (typeof tz !== "string" || tz === "") return false;
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return true;
    } catch (e) {
      return false;
    }
  }

  var PART_FORMATTER_CACHE = {};
  function partFormatter(tz) {
    if (!PART_FORMATTER_CACHE[tz]) {
      PART_FORMATTER_CACHE[tz] = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hour12: false,
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
        era: "short"
      });
    }
    return PART_FORMATTER_CACHE[tz];
  }

  // タイムゾーンでの壁時計時刻を「UTCとして解釈した場合のミリ秒」に変換する
  function wallMs(tz, timestamp) {
    var parts = partFormatter(tz).formatToParts(new Date(timestamp));
    var v = {};
    for (var i = 0; i < parts.length; i++) v[parts[i].type] = parts[i].value;
    var year = parseInt(v.year, 10);
    if (v.era === "BC" || v.era === "B") year = 1 - year;
    var hour = parseInt(v.hour, 10) % 24;
    return Date.UTC(year, parseInt(v.month, 10) - 1, parseInt(v.day, 10),
      hour, parseInt(v.minute, 10), parseInt(v.second, 10));
  }

  /**
   * ある瞬間における、そのタイムゾーンのUTCオフセット(分)を求める。
   * @param {string} timeZone IANAのタイムゾーン名(例 "Asia/Tokyo")
   * @param {number} timestamp UTCのミリ秒(Date.prototype.getTime() の値)
   * @returns {{ok:true, offsetMinutes:number}|{ok:false, code:"invalid_zone"|"invalid_timestamp"}}
   *   offsetMinutes は UTC より東を正とする分(日本標準時なら 540)。
   */
  function offsetMinutes(timeZone, timestamp) {
    if (!isValidZone(timeZone)) return { ok: false, code: "invalid_zone" };
    if (typeof timestamp !== "number" || !isFinite(timestamp)) {
      return { ok: false, code: "invalid_timestamp" };
    }
    return { ok: true, offsetMinutes: (wallMs(timeZone, timestamp) - timestamp) / MS_PER_MINUTE };
  }

  // そのタイムゾーンの標準時オフセット(その年で最も小さいオフセット)を推定する
  function standardOffsetMinutes(timeZone, timestamp) {
    var year = new Date(wallMs(timeZone, timestamp)).getUTCFullYear();
    var min = null;
    for (var m = 0; m < 12; m++) {
      var t = Date.UTC(year, m, 15);
      var o = (wallMs(timeZone, t) - t) / MS_PER_MINUTE;
      if (min === null || o < min) min = o;
    }
    return min;
  }

  /**
   * あるタイムゾーンの壁時計時刻(年月日時分)を UTC のミリ秒に変換する。
   * @param {string} timeZone IANAのタイムゾーン名
   * @param {number} year 年(1900〜2200)
   * @param {number} month 月(1〜12)
   * @param {number} day 日(1〜31。存在しない日付はエラー)
   * @param {number} hour 時(0〜23)
   * @param {number} minute 分(0〜59)
   * @returns {{ok:true, timestamp:number, skipped:boolean, ambiguous:boolean}
   *          |{ok:false, code:"invalid_zone"|"invalid_datetime"}}
   *   skipped はサマータイム開始で存在しない時刻を指定した場合、
   *   ambiguous はサマータイム終了で1日に2回ある時刻を指定した場合に true。
   *   いずれも近い側の実在する瞬間を timestamp として返す。
   */
  function toTimestamp(timeZone, year, month, day, hour, minute) {
    if (!isValidZone(timeZone)) return { ok: false, code: "invalid_zone" };
    if (!isInt(year) || year < MIN_YEAR || year > MAX_YEAR) return { ok: false, code: "invalid_datetime" };
    if (!isInt(month) || month < 1 || month > 12) return { ok: false, code: "invalid_datetime" };
    if (!isInt(day) || day < 1 || day > 31) return { ok: false, code: "invalid_datetime" };
    if (!isInt(hour) || hour < 0 || hour > 23) return { ok: false, code: "invalid_datetime" };
    if (!isInt(minute) || minute < 0 || minute > 59) return { ok: false, code: "invalid_datetime" };
    var target = Date.UTC(year, month - 1, day, hour, minute);
    var check = new Date(target);
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
      return { ok: false, code: "invalid_datetime" };
    }

    // 切替の前後1日のオフセットから候補を作り、壁時計時刻が一致するものだけを採る
    var day = 86400000;
    var before = target - day;
    var after = target + day;
    var offBefore = (wallMs(timeZone, before) - before) / MS_PER_MINUTE;
    var offAfter = (wallMs(timeZone, after) - after) / MS_PER_MINUTE;
    var candidates = [target - offBefore * MS_PER_MINUTE, target - offAfter * MS_PER_MINUTE];
    var valid = [];
    for (var i = 0; i < candidates.length; i++) {
      if (wallMs(timeZone, candidates[i]) === target && valid.indexOf(candidates[i]) === -1) {
        valid.push(candidates[i]);
      }
    }
    // 存在しない時刻は切替前のオフセットで換算する(結果として1時間先に送られる)
    var ts = valid.length > 0 ? Math.min.apply(null, valid) : candidates[0];
    return { ok: true, timestamp: ts, skipped: valid.length === 0, ambiguous: valid.length > 1 };
  }

  /**
   * ある瞬間を、指定したタイムゾーンの日時に分解する。
   * @param {string} timeZone IANAのタイムゾーン名
   * @param {number} timestamp UTCのミリ秒
   * @returns {{ok:true, year:number, month:number, day:number, hour:number, minute:number,
   *            text:string, offsetMinutes:number, offsetText:string, isDst:boolean}
   *          |{ok:false, code:"invalid_zone"|"invalid_timestamp"}}
   *   text は "YYYY-MM-DD HH:mm" 形式。offsetText は "+09:00" のような表記。
   *   isDst は同じ年の標準時オフセットより進んでいるか(サマータイム実施中か)。
   */
  function describe(timeZone, timestamp) {
    var o = offsetMinutes(timeZone, timestamp);
    if (!o.ok) return o;
    var w = new Date(wallMs(timeZone, timestamp));
    var off = o.offsetMinutes;
    var sign = off < 0 ? "-" : "+";
    var abs = Math.abs(off);
    var pad = function (n, len) {
      var s = String(n);
      while (s.length < len) s = "0" + s;
      return s;
    };
    return {
      ok: true,
      year: w.getUTCFullYear(),
      month: w.getUTCMonth() + 1,
      day: w.getUTCDate(),
      hour: w.getUTCHours(),
      minute: w.getUTCMinutes(),
      weekday: w.getUTCDay(),
      text: pad(w.getUTCFullYear(), 4) + "-" + pad(w.getUTCMonth() + 1, 2) + "-" + pad(w.getUTCDate(), 2) +
        " " + pad(w.getUTCHours(), 2) + ":" + pad(w.getUTCMinutes(), 2),
      offsetMinutes: off,
      offsetText: sign + pad(Math.floor(abs / 60), 2) + ":" + pad(abs % 60, 2),
      isDst: off > standardOffsetMinutes(timeZone, timestamp)
    };
  }

  /**
   * 基準都市の日時を、相手の都市の現地時間に換算する。
   * @param {string} fromZone 基準都市のIANAタイムゾーン名(例 "Asia/Tokyo")
   * @param {string} toZone 相手の都市のIANAタイムゾーン名(例 "America/New_York")
   * @param {number} year 年(1900〜2200)
   * @param {number} month 月(1〜12)
   * @param {number} day 日(1〜31)
   * @param {number} hour 時(0〜23)
   * @param {number} minute 分(0〜59)
   * @returns {{ok:true, from:object, to:object, diffMinutes:number, dayShift:number,
   *            skipped:boolean, ambiguous:boolean}
   *          |{ok:false, code:"invalid_from_zone"|"invalid_to_zone"|"invalid_datetime"}}
   *   from / to は describe() の返り値。
   *   diffMinutes は「相手の都市 − 基準都市」のオフセット差(分。相手が進んでいれば正)。
   *   dayShift は日付が何日ずれるか(-1 / 0 / +1 など)。
   */
  function convert(fromZone, toZone, year, month, day, hour, minute) {
    if (!isValidZone(fromZone)) return { ok: false, code: "invalid_from_zone" };
    if (!isValidZone(toZone)) return { ok: false, code: "invalid_to_zone" };
    var t = toTimestamp(fromZone, year, month, day, hour, minute);
    if (!t.ok) return { ok: false, code: t.code === "invalid_zone" ? "invalid_from_zone" : "invalid_datetime" };
    var from = describe(fromZone, t.timestamp);
    var to = describe(toZone, t.timestamp);
    if (!from.ok || !to.ok) return { ok: false, code: "invalid_to_zone" };
    var fromDay = Date.UTC(from.year, from.month - 1, from.day);
    var toDay = Date.UTC(to.year, to.month - 1, to.day);
    return {
      ok: true,
      from: from,
      to: to,
      diffMinutes: to.offsetMinutes - from.offsetMinutes,
      dayShift: Math.round((toDay - fromDay) / 86400000),
      skipped: t.skipped,
      ambiguous: t.ambiguous
    };
  }

  var api = {
    offsetMinutes: offsetMinutes,
    toTimestamp: toTimestamp,
    describe: describe,
    convert: convert
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.JisaCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
