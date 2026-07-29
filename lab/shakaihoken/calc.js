/*
 * 社会保険料(健康保険・介護保険・子ども子育て支援金・厚生年金)の計算ロジック
 *
 * 料率の時点: 令和8年度(2026年度)。健康保険料率・介護保険料率は令和8年3月分(4月納付分)から、
 *            子ども・子育て支援金率は令和8年4月分(5月納付分)から適用。
 *
 * 根拠(一次情報):
 * - 全国健康保険協会「令和8年度の協会けんぽの保険料率は3月分(4月納付分)から改定されます」
 *   https://www.kyoukaikenpo.or.jp/about/business/insurance_rate/rate_prefectures/r08/index.html (2026年7月29日参照)
 *   ・都道府県単位保険料率(令和8年度)を47都道府県分そのまま採用。全国平均は9.90%
 *   ・介護保険料率(全国一律) 1.62%、子ども・子育て支援金率(全国一律) 0.23%
 * - 全国健康保険協会「令和8年度保険料額表(東京支部)」
 *   https://www.kyoukaikenpo.or.jp/assets/R8_13tokyo.pdf (2026年7月29日参照)
 *   ・健康保険の標準報酬月額 第1級58,000円〜第50級1,390,000円の等級表(報酬月額の区分)
 *   ・厚生年金保険の標準報酬月額 第1級88,000円〜第32級650,000円(健康保険の第4級〜第35級に対応)
 *   ・被保険者負担分(折半額)の端数処理: 給与から控除する場合、端数が50銭以下は切り捨て、
 *     50銭を超える場合は切り上げて1円
 * - 日本年金機構「厚生年金保険料額表」
 *   https://www.nenkin.go.jp/service/kounen/hokenryo/ryogaku/ryogakuhyo/index.html (2026年7月29日参照)
 *   ・厚生年金保険料率は平成29年9月を最後に引上げが終了し18.3%で固定
 *
 * 前提:
 * - 協会けんぽ(全国健康保険協会)に加入する一般の被保険者を想定する。
 *   健康保険組合・共済組合・厚生年金基金加入者は料率が異なるため対象外。
 * - 標準報酬月額は「報酬月額」から等級表で決まる。定時決定・随時改定の実際の等級とは
 *   ずれることがある(この計算は現在の報酬額から等級を引くだけの目安)。
 * - 介護保険料は40歳以上65歳未満(介護保険第2号被保険者)のみ。
 * - 厚生年金保険料は70歳未満のみ(70歳以上は原則として被保険者資格を喪失する)。
 * - 賞与にかかる保険料(標準賞与額)、子ども・子育て拠出金(事業主のみ負担)は含めない。
 * - 端数処理は「給与から控除する場合」の規定(50銭以下切り捨て・50銭超切り上げ)を用いる。
 */
(function (global) {
  "use strict";

  /* 令和8年度 都道府県単位保険料率(単位: 1/100 パーセント。985 = 9.85%) */
  var PREF_RATES = {
    hokkaido: 1028, aomori: 985, iwate: 951, miyagi: 1010, akita: 1001,
    yamagata: 975, fukushima: 950, ibaraki: 952, tochigi: 982, gunma: 968,
    saitama: 967, chiba: 973, tokyo: 985, kanagawa: 992, niigata: 921,
    toyama: 959, ishikawa: 970, fukui: 971, yamanashi: 955, nagano: 963,
    gifu: 980, shizuoka: 961, aichi: 993, mie: 977, shiga: 988,
    kyoto: 989, osaka: 1013, hyogo: 1012, nara: 991, wakayama: 1006,
    tottori: 986, shimane: 994, okayama: 1005, hiroshima: 978, yamaguchi: 1015,
    tokushima: 1024, kagawa: 1002, ehime: 998, kochi: 1005, fukuoka: 1011,
    saga: 1055, nagasaki: 1006, kumamoto: 1008, oita: 1008, miyazaki: 977,
    kagoshima: 1013, okinawa: 944
  };

  var CARE_RATE = 162;      // 介護保険料率 1.62%(全国一律)
  var CHILD_RATE = 23;      // 子ども・子育て支援金率 0.23%(全国一律)
  var PENSION_RATE = 1830;  // 厚生年金保険料率 18.30%(全国一律)

  /* 健康保険の標準報酬月額等級表: [等級, 標準報酬月額, 報酬月額の下限(円以上)]
     下限は「その等級になる報酬月額の下端」。第1級は下限なし(0)。 */
  var GRADES = [
    [1, 58000, 0], [2, 68000, 63000], [3, 78000, 73000], [4, 88000, 83000],
    [5, 98000, 93000], [6, 104000, 101000], [7, 110000, 107000], [8, 118000, 114000],
    [9, 126000, 122000], [10, 134000, 130000], [11, 142000, 138000], [12, 150000, 146000],
    [13, 160000, 155000], [14, 170000, 165000], [15, 180000, 175000], [16, 190000, 185000],
    [17, 200000, 195000], [18, 220000, 210000], [19, 240000, 230000], [20, 260000, 250000],
    [21, 280000, 270000], [22, 300000, 290000], [23, 320000, 310000], [24, 340000, 330000],
    [25, 360000, 350000], [26, 380000, 370000], [27, 410000, 395000], [28, 440000, 425000],
    [29, 470000, 455000], [30, 500000, 485000], [31, 530000, 515000], [32, 560000, 545000],
    [33, 590000, 575000], [34, 620000, 605000], [35, 650000, 635000], [36, 680000, 665000],
    [37, 710000, 695000], [38, 750000, 730000], [39, 790000, 770000], [40, 830000, 810000],
    [41, 880000, 855000], [42, 930000, 905000], [43, 980000, 955000], [44, 1030000, 1005000],
    [45, 1090000, 1055000], [46, 1150000, 1115000], [47, 1210000, 1175000], [48, 1270000, 1235000],
    [49, 1330000, 1295000], [50, 1390000, 1355000]
  ];

  var PENSION_MIN_GRADE = 4;   // 健康保険の第4級(88,000円)が厚生年金の第1級
  var PENSION_MAX_GRADE = 35;  // 健康保険の第35級(650,000円)が厚生年金の第32級

  var REWARD_MAX = 20000000;   // 入力上限(常識的な範囲チェック)
  var AGE_MAX = 120;

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  /**
   * 標準報酬月額の等級を報酬月額から求める
   * @param {number} reward 報酬月額(円)。通勤手当などを含む月々の報酬
   * @returns {{ok:true, grade:number, standard:number, pensionGrade:(number|null), pensionStandard:number}|{ok:false, code:"invalid_reward"}}
   *   grade は健康保険の等級(1〜50)、standard は健康保険の標準報酬月額(円)。
   *   pensionGrade は厚生年金の等級(1〜32)、pensionStandard は厚生年金の標準報酬月額(円)。
   */
  function standardMonthly(reward) {
    if (!isFiniteNumber(reward) || reward < 0 || reward > REWARD_MAX) {
      return { ok: false, code: "invalid_reward" };
    }
    var row = GRADES[0];
    for (var i = 0; i < GRADES.length; i++) {
      if (reward >= GRADES[i][2]) row = GRADES[i];
    }
    var pg = row[0];
    if (pg < PENSION_MIN_GRADE) pg = PENSION_MIN_GRADE;
    if (pg > PENSION_MAX_GRADE) pg = PENSION_MAX_GRADE;
    return {
      ok: true,
      grade: row[0],
      standard: row[1],
      pensionGrade: pg - PENSION_MIN_GRADE + 1,
      pensionStandard: GRADES[pg - 1][1]
    };
  }

  /* 標準報酬月額(円)×料率(1/100%) の全額を「銭」の整数で返す。
     標準報酬月額はすべて1,000円の倍数なので (standard/100)*rate は必ず整数になり、誤差が出ない。 */
  function fullSen(standard, rate) {
    return (standard / 100) * rate;
  }

  /* 折半額(銭。半銭の端数が出うるので数値)を、給与控除時の規定
     「端数が50銭以下は切り捨て、50銭を超えるときは切り上げ」で円に丸める */
  function halfToYen(fullSenValue) {
    var half = fullSenValue / 2;
    var yen = Math.floor(half / 100);
    var rem = half - yen * 100;
    return rem > 50 ? yen + 1 : yen;
  }

  /**
   * 月給から健康保険・介護保険・子ども子育て支援金・厚生年金の本人負担額を計算する
   * @param {number} reward 報酬月額(円)
   * @param {string} pref 都道府県キー(ローマ字小文字。例 "tokyo" "osaka")
   * @param {number} age 年齢(歳)。40歳以上65歳未満で介護保険料、70歳未満で厚生年金保険料が発生する
   * @returns {{ok:true, grade:number, standard:number, pensionGrade:(number|null), pensionStandard:number,
   *            rates:{health:number, care:number, child:number, pension:number},
   *            employee:{health:number, care:number, child:number, pension:number, total:number},
   *            total:{health:number, care:number, child:number, pension:number, total:number},
   *            careApplies:boolean, pensionApplies:boolean}
   *          |{ok:false, code:"invalid_reward"|"invalid_prefecture"|"invalid_age"}}
   *   rates はパーセント表記の数値(例 9.85)。employee は本人負担額(円、上記の端数処理後)。
   *   total は事業主負担を含む全額(円。1円未満は四捨五入)。
   */
  function calculate(reward, pref, age) {
    var sm = standardMonthly(reward);
    if (!sm.ok) return sm;
    if (typeof pref !== "string" || !Object.prototype.hasOwnProperty.call(PREF_RATES, pref)) {
      return { ok: false, code: "invalid_prefecture" };
    }
    if (!isFiniteNumber(age) || age < 0 || age > AGE_MAX) {
      return { ok: false, code: "invalid_age" };
    }

    var healthRate = PREF_RATES[pref];
    var careApplies = age >= 40 && age < 65;
    var pensionApplies = age < 70;

    var healthSen = fullSen(sm.standard, healthRate);
    var careSen = careApplies ? fullSen(sm.standard, CARE_RATE) : 0;
    var childSen = fullSen(sm.standard, CHILD_RATE);
    var pensionSen = pensionApplies ? fullSen(sm.pensionStandard, PENSION_RATE) : 0;

    var eHealth = halfToYen(healthSen);
    var eCare = careApplies ? halfToYen(careSen) : 0;
    var eChild = halfToYen(childSen);
    var ePension = pensionApplies ? halfToYen(pensionSen) : 0;

    return {
      ok: true,
      grade: sm.grade,
      standard: sm.standard,
      pensionGrade: pensionApplies ? sm.pensionGrade : null,
      pensionStandard: pensionApplies ? sm.pensionStandard : 0,
      careApplies: careApplies,
      pensionApplies: pensionApplies,
      rates: {
        health: healthRate / 100,
        care: careApplies ? CARE_RATE / 100 : 0,
        child: CHILD_RATE / 100,
        pension: pensionApplies ? PENSION_RATE / 100 : 0
      },
      employee: {
        health: eHealth,
        care: eCare,
        child: eChild,
        pension: ePension,
        total: eHealth + eCare + eChild + ePension
      },
      total: {
        health: Math.round(healthSen / 100),
        care: Math.round(careSen / 100),
        child: Math.round(childSen / 100),
        pension: Math.round(pensionSen / 100),
        total: Math.round((healthSen + careSen + childSen + pensionSen) / 100)
      }
    };
  }

  /**
   * 都道府県の健康保険料率(令和8年度)を返す
   * @param {string} pref 都道府県キー(ローマ字小文字)
   * @returns {{ok:true, rate:number}|{ok:false, code:"invalid_prefecture"}} rate はパーセント表記(例 9.85)
   */
  function prefectureRate(pref) {
    if (typeof pref !== "string" || !Object.prototype.hasOwnProperty.call(PREF_RATES, pref)) {
      return { ok: false, code: "invalid_prefecture" };
    }
    return { ok: true, rate: PREF_RATES[pref] / 100 };
  }

  /**
   * 年収(月給×12 + 賞与)ではなく、月給から年間の本人負担額の目安を出す
   * @param {number} reward 報酬月額(円)
   * @param {string} pref 都道府県キー
   * @param {number} age 年齢(歳)
   * @returns {{ok:true, monthly:number, yearly:number}|{ok:false, code:string}}
   *   yearly は monthly×12(賞与分は含まない)
   */
  function yearlyEmployee(reward, pref, age) {
    var r = calculate(reward, pref, age);
    if (!r.ok) return r;
    return { ok: true, monthly: r.employee.total, yearly: r.employee.total * 12 };
  }

  var api = {
    standardMonthly: standardMonthly,
    calculate: calculate,
    prefectureRate: prefectureRate,
    yearlyEmployee: yearlyEmployee,
    PREF_RATES: PREF_RATES,
    GRADES: GRADES,
    CARE_RATE: CARE_RATE,
    CHILD_RATE: CHILD_RATE,
    PENSION_RATE: PENSION_RATE
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.ShakaihokenCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
