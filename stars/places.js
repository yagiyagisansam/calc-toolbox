/*
 * 地名から場所を引く。
 *
 * なぜ自前なのか:
 *   住所検索のサービス(ジオコーダ)を呼べば済むが、この構成では使えない。
 *   静的サイトなので鍵を隠せる中継役がなく、ブラウザから直接叩くのは
 *   先方の規約と [[rules/scraping-etiquette]] に反する。
 *   ページの CSP も connect-src を自サイトに絞ってある。
 *   そこで地名と座標の対応表を同梱し、その中だけで引く
 *   (作り方は scripts/stars/build_places.mjs)。
 *
 * 読み込みは「使うときだけ」。
 *   索引は gzip 後で約176KBある。一覧を開いただけの人に読ませる必要はないので、
 *   検索欄に触れる・地図を開く、といった操作があってから取りに行く。
 *
 * window.StarsPlaces で公開する。
 */
(function (global) {
  "use strict";

  var state = {
    ready: false,
    meta: null,
    rows: [], // [名前, 読み, 県番号, 分類番号, 緯度, 経度, 順位]
    prefs: [],
    kinds: []
  };

  var loading = null;

  /**
   * 索引を読み込む。何度呼んでも1回しか取りに行かない。
   * @param {string} [baseUrl] data ディレクトリの場所(既定 "./data")
   * @returns {Promise<object>}
   */
  function load(baseUrl) {
    if (loading) return loading;
    var base = baseUrl || "./data";
    loading = fetch(base + "/places.json")
      .then(function (r) {
        if (!r.ok) throw new Error("地名データを取得できません (" + r.status + ")");
        return r.json();
      })
      .then(function (data) {
        if (!data || !Array.isArray(data.places)) {
          throw new Error("地名データの形式が正しくありません");
        }
        state.meta = data;
        state.rows = data.places;
        state.prefs = data.prefs || [];
        state.kinds = data.kinds || [];
        state.ready = true;
        return data;
      });
    return loading;
  }

  function isReady() {
    return state.ready;
  }

  /**
   * カタカナをひらがなに寄せる。
   * iPhone の予測変換ではカタカナが出やすいので、どちらで打っても当たるようにする。
   */
  function toHiragana(s) {
    return String(s).replace(/[ァ-ヶ]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) - 0x60);
    });
  }

  /** 検索用に整える(前後の空白を落とし、カナをひらがなへ) */
  function normalize(s) {
    return toHiragana(String(s == null ? "" : s).trim());
  }

  function toPlace(row) {
    return {
      name: row[0],
      kana: row[1],
      pref: state.prefs[row[2]] || "",
      kind: state.kinds[row[3]] || "",
      lat: row[4],
      lon: row[5],
      rank: row[6] || 0
    };
  }

  /**
   * 地名を探す。
   *
   * 並べ方:
   *   1. 名前がそのまま一致
   *   2. 名前が前から一致(「秩父」で「秩父市」)
   *   3. 読みが前から一致(「ちちぶ」で「秩父市」)
   *   4. どこかに含まれる
   *   同じ強さなら、目立つほう(人口や標高が大きいほう)を先に出す。
   *   「富士山」で小さな丘が先に来ないようにするため。
   *
   * @param {string} query
   * @param {number} [limit] 返す件数(既定 12)
   * @returns {Array<{name:string,kana:string,pref:string,kind:string,lat:number,lon:number}>}
   */
  function search(query, limit) {
    var q = normalize(query);
    if (!state.ready || q.length === 0) return [];
    var max = limit || 12;

    var hits = [];
    for (var i = 0; i < state.rows.length; i++) {
      var row = state.rows[i];
      var name = row[0];
      var kana = row[1] || "";
      var tier = -1;

      if (name === q || kana === q) tier = 0;
      else if (name.indexOf(q) === 0) tier = 1;
      else if (kana && kana.indexOf(q) === 0) tier = 2;
      else if (name.indexOf(q) >= 0) tier = 3;
      else if (kana && kana.indexOf(q) >= 0) tier = 4;
      else continue;

      hits.push({ row: row, tier: tier });
    }

    hits.sort(function (a, b) {
      return a.tier - b.tier || (b.row[6] || 0) - (a.row[6] || 0);
    });

    return hits.slice(0, max).map(function (h) {
      return toPlace(h.row);
    });
  }

  /** 都道府県の一覧(索引に入っている順) */
  function prefectures() {
    if (!state.ready) return [];
    var out = [];
    for (var i = 0; i < state.rows.length; i++) {
      if (state.kinds[state.rows[i][3]] === "都道府県") out.push(state.rows[i][0]);
    }
    return out;
  }

  /**
   * 指定した都道府県の市区町村。
   * 絞り込みの選択肢に使う(その県に掲載スポットが無くても一覧には出す)。
   */
  function citiesOf(pref) {
    if (!state.ready || !pref) return [];
    var out = [];
    for (var i = 0; i < state.rows.length; i++) {
      var row = state.rows[i];
      var kind = state.kinds[row[3]];
      if ((kind === "市・郡" || kind === "町・村・区") && state.prefs[row[2]] === pref) {
        out.push(row[0]);
      }
    }
    return out.sort(function (a, b) {
      return a.localeCompare(b, "ja");
    });
  }

  var api = {
    load: load,
    isReady: isReady,
    search: search,
    prefectures: prefectures,
    citiesOf: citiesOf,
    normalize: normalize,
    meta: function () {
      return state.meta;
    }
  };

  global.StarsPlaces = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
