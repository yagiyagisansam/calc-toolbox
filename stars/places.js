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
      .then(adopt);
    return loading;
  }

  /**
   * 既に手元にある索引を使う。
   * ブラウザでは load() が内部で呼ぶ。Node のテストからは直に呼ぶ
   * (fetch を差し替えずに検索の中身を確かめるため)。
   * @param {object} data places.json の中身
   */
  function adopt(data) {
    if (!data || !Array.isArray(data.places)) {
      throw new Error("地名データの形式が正しくありません");
    }
    state.meta = data;
    state.rows = data.places;
    state.prefs = data.prefs || [];
    state.kinds = data.kinds || [];
    /*
     * 比べる用の名前と読みを先に作っておく。
     * 打たれるたびに1万件を寄せ直すと、1文字打つごとに引っかかる。
     */
    state.folded = data.places.map(function (row) {
      return [fold(row[0]), fold(row[1] || "")];
    });
    state.ready = true;
    return data;
  }

  function isReady() {
    return state.ready;
  }

  /**
   * カタカナをひらがなに寄せる。
   * iPhone の予測変換ではカタカナが出やすいので、どちらで打っても当たるようにする。
   *
   * ヶ と ヵ は変換しない。
   *   これは「小さいケ」ではなく、箇の略字として地名にそのまま入る文字で、
   *   八ヶ岳・槍ヶ岳・霧ヶ峰・関ヶ原 のように漢字の名前の一部として現れる。
   *   ァ〜ヶ をまとめて 0x60 引くと ヶ が ゖ(ほとんど使われない小さいけ)になり、
   *   索引の側は「ヶ」のままなので永久に一致しなくなる。
   *   実際、これで「八ヶ岳」も「槍ヶ岳」も1件も出ない状態になっていた。
   *   逆に、利用者が ゖ・ゕ を打った場合は ヶ・ヵ に寄せて拾う。
   */
  function toHiragana(s) {
    return String(s)
      .replace(/[ァ-ヴ]/g, function (c) {
        return String.fromCharCode(c.charCodeAt(0) - 0x60);
      })
      .replace(/ゕ/g, "ヵ")
      .replace(/ゖ/g, "ヶ");
  }

  /*
   * 表記の揺れを1つの形に寄せる。
   *
   * 打つ側と索引の側で綴りが違うと、正しい地名なのに0件になる。
   * 実際に食い違っていたもの(国土地理院の市区町村名と突き合わせて確かめた):
   *   ケ / ヶ   金ケ崎町・七ケ宿町・保土ケ谷区 ↔ 茅ヶ崎市
   *   異体字     諌早市↔諫早市 / 塩竃市↔塩竈市 / 桧枝岐村↔檜枝岐村 / 四条畷市↔四條畷市
   * どちらが「正しい」かではなく、比べるときだけ同じ形に寄せる。
   */
  var FOLD = { 諌: "諫", 竃: "竈", 桧: "檜", 條: "条", 邊: "辺", 曾: "曽", 舘: "館" };
  var KANJI = /[一-鿿]/;

  function fold(s) {
    var text = String(s).replace(/[諌竃桧條邊曾舘]/g, function (c) {
      return FOLD[c];
    });
    /*
     * ケ を ヶ に寄せるのは、漢字に挟まれているときだけ。
     * 「茅ケ崎市」「金ケ崎町」の ケ は箇の略字で ヶ と同じものだが、
     * 「ヤツガタケ」の ケ はカタカナの一音で、ひらがなの け になるべきもの。
     * 見境なく寄せると、カタカナで打った読みが「やつがたヶ」になって
     * 索引の「やつがたけ」と当たらなくなる。
     */
    return text.replace(/(.?)ケ(.?)/g, function (all, before, after) {
      return KANJI.test(before) || KANJI.test(after) ? before + "ヶ" + after : all;
    });
  }

  /**
   * 検索用に整える(前後の空白を落とし、表記の揺れを寄せ、カナをひらがなへ)。
   *
   * 順番が大事。寄せるのを先にしないと、ケ が ひらがなの け になってしまい、
   * そのあと ヶ へ寄せる機会が無くなる(「茅ケ崎市」が「茅け崎市」になり、
   * 索引側の「茅ヶ崎市」と永久に一致しない)。
   */
  function normalize(s) {
    return toHiragana(fold(String(s == null ? "" : s).trim()));
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
      // 比べるのは寄せた形。画面に出すのは元の綴り(row[0])のまま
      var name = state.folded[i][0];
      var kana = state.folded[i][1];
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
    adopt: adopt,
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
