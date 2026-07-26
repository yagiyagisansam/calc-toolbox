# 住所ツール用の郵便番号データ(shared/postal/*.json)を生成する
#
# データ源(一次情報): 日本郵便「郵便番号データ」。取得は posuto パッケージ経由
#   (posuto は日本郵便の公式CSVを取り込んだもの。カナ読みも公式データの値)
# ローマ字はカナからヘボン式(日本郵便の表記慣行: 撥音はb/m/p前でM、
#   長音オウ/オオ/ウウは短縮、エイは保持)で機械変換する。ページ側で手修正可能にする前提
#
# 更新手順:
#   pip download posuto -d /tmp/posuto_pkg --no-deps
#   unzip -o /tmp/posuto_pkg/posuto-*.whl -d /tmp/posuto_x
#   python3 scripts/build/gen_postal_data.py /tmp/posuto_x/posuto/postaldata.db
#
# 出力: shared/postal/<zip3>.json = {"<zip4>": [県,市区町村,町域,県ローマ字,市ローマ字,町域ローマ字], ...}
#       shared/postal/meta.json  = 件数などのメタ情報
import json
import os
import re
import sqlite3
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "shared", "postal")

# 47都道府県の英語表記(慣用: 都府県サフィックスなし、北海道はHokkaido)
PREFS = {
    "北海道": "Hokkaido", "青森県": "Aomori", "岩手県": "Iwate", "宮城県": "Miyagi",
    "秋田県": "Akita", "山形県": "Yamagata", "福島県": "Fukushima", "茨城県": "Ibaraki",
    "栃木県": "Tochigi", "群馬県": "Gunma", "埼玉県": "Saitama", "千葉県": "Chiba",
    "東京都": "Tokyo", "神奈川県": "Kanagawa", "新潟県": "Niigata", "富山県": "Toyama",
    "石川県": "Ishikawa", "福井県": "Fukui", "山梨県": "Yamanashi", "長野県": "Nagano",
    "岐阜県": "Gifu", "静岡県": "Shizuoka", "愛知県": "Aichi", "三重県": "Mie",
    "滋賀県": "Shiga", "京都府": "Kyoto", "大阪府": "Osaka", "兵庫県": "Hyogo",
    "奈良県": "Nara", "和歌山県": "Wakayama", "鳥取県": "Tottori", "島根県": "Shimane",
    "岡山県": "Okayama", "広島県": "Hiroshima", "山口県": "Yamaguchi", "徳島県": "Tokushima",
    "香川県": "Kagawa", "愛媛県": "Ehime", "高知県": "Kochi", "福岡県": "Fukuoka",
    "佐賀県": "Saga", "長崎県": "Nagasaki", "熊本県": "Kumamoto", "大分県": "Oita",
    "宮崎県": "Miyazaki", "鹿児島県": "Kagoshima", "沖縄県": "Okinawa",
}

# 政令指定都市(市+区の分割に使用)
SEIREI = {
    "札幌市": "Sapporo", "仙台市": "Sendai", "さいたま市": "Saitama", "千葉市": "Chiba",
    "横浜市": "Yokohama", "川崎市": "Kawasaki", "相模原市": "Sagamihara", "新潟市": "Niigata",
    "静岡市": "Shizuoka", "浜松市": "Hamamatsu", "名古屋市": "Nagoya", "京都市": "Kyoto",
    "大阪市": "Osaka", "堺市": "Sakai", "神戸市": "Kobe", "岡山市": "Okayama",
    "広島市": "Hiroshima", "北九州市": "Kitakyushu", "福岡市": "Fukuoka", "熊本市": "Kumamoto",
}
SEIREI_KANA = {
    "札幌市": "サッポロシ", "仙台市": "センダイシ", "さいたま市": "サイタマシ", "千葉市": "チバシ",
    "横浜市": "ヨコハマシ", "川崎市": "カワサキシ", "相模原市": "サガミハラシ", "新潟市": "ニイガタシ",
    "静岡市": "シズオカシ", "浜松市": "ハママツシ", "名古屋市": "ナゴヤシ", "京都市": "キョウトシ",
    "大阪市": "オオサカシ", "堺市": "サカイシ", "神戸市": "コウベシ", "岡山市": "オカヤマシ",
    "広島市": "ヒロシマシ", "北九州市": "キタキュウシュウシ", "福岡市": "フクオカシ", "熊本市": "クマモトシ",
}

DIGRAPHS = {
    "キャ": "kya", "キュ": "kyu", "キョ": "kyo",
    "シャ": "sha", "シュ": "shu", "ショ": "sho", "シェ": "she",
    "チャ": "cha", "チュ": "chu", "チョ": "cho", "チェ": "che",
    "ニャ": "nya", "ニュ": "nyu", "ニョ": "nyo",
    "ヒャ": "hya", "ヒュ": "hyu", "ヒョ": "hyo",
    "ミャ": "mya", "ミュ": "myu", "ミョ": "myo",
    "リャ": "rya", "リュ": "ryu", "リョ": "ryo",
    "ギャ": "gya", "ギュ": "gyu", "ギョ": "gyo",
    "ジャ": "ja", "ジュ": "ju", "ジョ": "jo", "ジェ": "je",
    "ビャ": "bya", "ビュ": "byu", "ビョ": "byo",
    "ピャ": "pya", "ピュ": "pyu", "ピョ": "pyo",
    "ヂャ": "ja", "ヂュ": "ju", "ヂョ": "jo",
    "ウィ": "wi", "ウェ": "we", "ウォ": "wo",
    "ヴァ": "va", "ヴィ": "vi", "ヴェ": "ve", "ヴォ": "vo",
    "ファ": "fa", "フィ": "fi", "フェ": "fe", "フォ": "fo",
    "ティ": "ti", "ディ": "di", "デュ": "dyu", "トゥ": "tu",
}
MONO = {
    "ア": "a", "イ": "i", "ウ": "u", "エ": "e", "オ": "o",
    "カ": "ka", "キ": "ki", "ク": "ku", "ケ": "ke", "コ": "ko",
    "サ": "sa", "シ": "shi", "ス": "su", "セ": "se", "ソ": "so",
    "タ": "ta", "チ": "chi", "ツ": "tsu", "テ": "te", "ト": "to",
    "ナ": "na", "ニ": "ni", "ヌ": "nu", "ネ": "ne", "ノ": "no",
    "ハ": "ha", "ヒ": "hi", "フ": "fu", "ヘ": "he", "ホ": "ho",
    "マ": "ma", "ミ": "mi", "ム": "mu", "メ": "me", "モ": "mo",
    "ヤ": "ya", "ユ": "yu", "ヨ": "yo",
    "ラ": "ra", "リ": "ri", "ル": "ru", "レ": "re", "ロ": "ro",
    "ワ": "wa", "ヰ": "i", "ヱ": "e", "ヲ": "o",
    "ガ": "ga", "ギ": "gi", "グ": "gu", "ゲ": "ge", "ゴ": "go",
    "ザ": "za", "ジ": "ji", "ズ": "zu", "ゼ": "ze", "ゾ": "zo",
    "ダ": "da", "ヂ": "ji", "ヅ": "zu", "デ": "de", "ド": "do",
    "バ": "ba", "ビ": "bi", "ブ": "bu", "ベ": "be", "ボ": "bo",
    "パ": "pa", "ピ": "pi", "プ": "pu", "ペ": "pe", "ポ": "po",
    "ヴ": "vu",
    "ァ": "a", "ィ": "i", "ゥ": "u", "ェ": "e", "ォ": "o",
    "ヮ": "wa", "ヵ": "ka", "ヶ": "ga",
}
ZEN_MAP = {chr(0xFF10 + i): str(i) for i in range(10)}
ZEN_MAP.update({"−": "-", "‐": "-", "―": "-", "・": " ", "、": ", "})


def kana_to_romaji(kana):
    """カタカナ列をヘボン式ローマ字へ。数字はスペースで区切って残す。"""
    s = kana
    out = []
    i = 0
    sokuon = False
    while i < len(s):
        ch = s[i]
        two = s[i:i + 2]
        if ch == "ッ":
            sokuon = True
            i += 1
            continue
        if ch == "ン":
            nxt = None
            if i + 1 < len(s):
                nxt = DIGRAPHS.get(s[i + 1:i + 3]) or MONO.get(s[i + 1])
            if nxt and nxt[0] in "bmp":
                out.append("m")
            elif nxt and nxt[0] in "aiueoy":
                out.append("n'")
            else:
                out.append("n")
            i += 1
            continue
        rom = None
        if two in DIGRAPHS:
            rom = DIGRAPHS[two]
            i += 2
        elif ch in MONO:
            rom = MONO[ch]
            i += 1
        elif ch == "ー":
            i += 1
            continue
        elif ch in ZEN_MAP or ch.isdigit():
            d = ZEN_MAP.get(ch, ch)
            if d.isdigit():
                if out and not out[-1].endswith(" ") and not out[-1][-1:].isdigit():
                    out.append(" ")
                out.append(d)
                if i + 1 < len(s) and not (s[i + 1] in ZEN_MAP and ZEN_MAP[s[i + 1]].isdigit()) and not s[i + 1].isdigit():
                    out.append(" ")
            else:
                out.append(d)
            i += 1
            continue
        else:
            out.append(ch)
            i += 1
            continue
        if sokuon:
            out.append("t" if rom.startswith("ch") else rom[0])
            sokuon = False
        out.append(rom)
    r = "".join(out)
    r = re.sub(r"o[uo]", "o", r)
    r = r.replace("uu", "u")
    return re.sub(r"\s+", " ", r).strip()


def title_case(rom):
    return re.sub(r"[a-z][a-z']*", lambda m: m.group(0)[0].upper() + m.group(0)[1:], rom)


SUFFIX = [("市", "シ", "-shi"), ("区", "ク", "-ku"), ("町", "チョウ", "-cho"), ("町", "マチ", "-machi"),
          ("村", "ムラ", "-mura"), ("村", "ソン", "-son")]


def city_romaji(city, kana):
    """市区町村のローマ字(英語住所の慣行: 区,政令市 / 町村,郡 の順)。"""
    # 政令市: 「札幌市中央区」→「Chuo-ku, Sapporo」
    for c, rome in SEIREI.items():
        if city.startswith(c) and len(city) > len(c) and city.endswith("区"):
            ward_kana = kana[len(SEIREI_KANA[c]):]
            ward = title_case(kana_to_romaji(ward_kana[:-1]))  # 末尾クを除く
            return f"{ward}-ku, {rome}"
    # 郡: 「余市郡余市町」→「Yoichi-cho, Yoichi-gun」
    if "郡" in city and city[-1] in "町村":
        gi = kana.find("グン")
        if gi > 0:
            gun = title_case(kana_to_romaji(kana[:gi])) + "-gun"
            rest_kana = kana[gi + 2:]
            for suf, sk, se in SUFFIX:
                if city.endswith(suf) and rest_kana.endswith(sk):
                    stem = rest_kana[:-len(sk)]
                    return f"{title_case(kana_to_romaji(stem))}{se}, {gun}"
            return f"{title_case(kana_to_romaji(rest_kana))}, {gun}"
    # 単独の市区町村
    for suf, sk, se in SUFFIX:
        if city.endswith(suf) and kana.endswith(sk):
            stem = kana[:-len(sk)]
            if stem:
                return title_case(kana_to_romaji(stem)) + se
    return title_case(kana_to_romaji(kana))


def clean_neighborhood(nb, nb_kana):
    if not nb or "掲載がない場合" in nb or "番地がくる場合" in nb or nb.endswith("一円"):
        return "", ""
    # KEN_ALL由来の括弧書き(丁目範囲等)は補足なので落とす
    nb = re.sub("（.*?）|\\(.*?\\)", "", nb)
    nb_kana = re.sub("（.*?）|\\(.*?\\)", "", nb_kana)
    return nb, nb_kana


def rev_key(s):
    """逆引きの照合キー。大文字小文字・空白・ハイフン・アポストロフィの差を吸収する。"""
    return re.sub(r"[^a-z0-9]", "", s.lower())


# 1つの町域ローマ字に対して保持する候補の上限(同名の町域は全国に多数あるため)
REV_MAX = 12


def main(db_path):
    con = sqlite3.connect(db_path)
    cur = con.cursor()
    shards = {}
    rev = {}
    n = 0
    for code, data in cur.execute("select code, data from postal_data"):
        d = json.loads(data)
        pref, city = d["prefecture"], d["city"]
        nb, nb_kana = clean_neighborhood(d["neighborhood"], d["neighborhood_kana"])
        town_rome = title_case(kana_to_romaji(nb_kana)) if nb_kana else ""
        rec = [
            pref, city, nb,
            PREFS.get(pref, title_case(kana_to_romaji(d["prefecture_kana"]))),
            city_romaji(city, d["city_kana"]),
            town_rome,
        ]
        shards.setdefault(code[:3], {})[code[3:]] = rec
        # 逆引き(町域ローマ字 → 郵便番号の候補)。町域が無いレコードは引きようがないので載せない
        if town_rome:
            k = rev_key(town_rome)
            if k:
                bucket = rev.setdefault(k[0], {}).setdefault(k, [])
                if len(bucket) < REV_MAX:
                    bucket.append(code)
        n += 1

    os.makedirs(OUT, exist_ok=True)
    for z3, recs in shards.items():
        with open(os.path.join(OUT, z3 + ".json"), "w", encoding="utf-8") as f:
            json.dump(recs, f, ensure_ascii=False, separators=(",", ":"))

    rev_dir = os.path.join(OUT, "rev")
    os.makedirs(rev_dir, exist_ok=True)
    rev_keys = 0
    for letter, table in rev.items():
        rev_keys += len(table)
        with open(os.path.join(rev_dir, letter + ".json"), "w", encoding="utf-8") as f:
            json.dump(table, f, ensure_ascii=False, separators=(",", ":"))

    with open(os.path.join(OUT, "meta.json"), "w", encoding="utf-8") as f:
        json.dump({
            "source": "日本郵便 郵便番号データ(posuto経由)",
            "records": n, "shards": len(shards),
            "reverseKeys": rev_keys, "reverseShards": len(rev), "reverseMax": REV_MAX
        }, f, ensure_ascii=False)
    print(f"{n}件 / {len(shards)}シャード → shared/postal/")
    print(f"逆引き {rev_keys}キー / {len(rev)}シャード → shared/postal/rev/")


if __name__ == "__main__":
    main(sys.argv[1])
