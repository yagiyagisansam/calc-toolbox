#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
掲載スポット候補の一覧を PDF にする。

なぜスクリプトにするか:
  光害指標と星見レベルは spots.json に入っている実測値をそのまま流す。
  表を手で書き写すと必ずどこかで数字がずれるので、転記は一切しない。

使い方:
  python3 scripts/stars/build_spot_report.py <spots.json> <出力.pdf>
"""
import json
import sys
from datetime import date

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle,
)

FONT_PATH = "/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf"
pdfmetrics.registerFont(TTFont("JP", FONT_PATH))

# 星見レベルの段階に対応する色。地図・凡例と同じ多色の並びを使う
# (stars/palette.js の BAND_COLORS_ON_MAP)。紙なので白地に載る濃さのほう。
BAND_COLOR = {
    "最高": colors.HexColor("#cfc302"),
    "良い": colors.HexColor("#db973b"),
    "まずまず": colors.HexColor("#db6a59"),
    "いまひとつ": colors.HexColor("#c83d80"),
    "悪い": colors.HexColor("#9c2f97"),
    "不可": colors.HexColor("#4e35af"),
}

styles = getSampleStyleSheet()


def st(name, size, leading, bold=False, color=colors.black, align=TA_LEFT):
    return ParagraphStyle(
        name, parent=styles["Normal"], fontName="JP", fontSize=size,
        leading=leading, textColor=color, alignment=align,
    )


S_TITLE = st("t", 18, 24)
S_H2 = st("h2", 12.5, 17)
S_BODY = st("b", 9, 13)
S_SMALL = st("s", 7.6, 10)
S_CELL = st("c", 7.4, 9.6)
S_CELL_B = st("cb", 7.4, 9.6)
S_NOTE = st("n", 7.2, 9.4, color=colors.HexColor("#555555"))


def p(text, style=S_CELL):
    return Paragraph(text, style)


def build(spots, out_path):
    doc = SimpleDocTemplate(
        out_path, pagesize=landscape(A4),
        leftMargin=10 * mm, rightMargin=10 * mm,
        topMargin=10 * mm, bottomMargin=10 * mm,
        title="今夜のオススメ星見スポット 掲載候補一覧",
        author="quick-calc.site",
    )
    story = []

    # ---- 表紙にあたる説明 ----
    story.append(Paragraph("掲載スポット候補 47都道府県", S_TITLE))
    story.append(Spacer(1, 3 * mm))
    story.append(Paragraph(
        "「今夜のオススメ星見スポット」(quick-calc.site/stars/) への掲載候補です。"
        f"作成日 {date.today().isoformat()}。承認いただいたものだけを掲載します。",
        S_BODY))
    story.append(Spacer(1, 4 * mm))

    story.append(Paragraph("選定条件（ご指定の4条件）", S_H2))
    story.append(Spacer(1, 1.5 * mm))
    cond = [
        ["無料", "駐車場・入場ともに料金がかからないこと。有料施設は候補から外しています。"],
        ["予約不要", "事前申込みなしで、思い立った日に行けること。観望会・ツアーは除外。"],
        ["他人に迷惑をかけない", "住宅地・集落・保育園などの生活圏は除外。私有地・放牧地への立入を伴う場所も除外。"],
        ["安全", "車で近くまで行ける舗装路のみ。登山・林道・長距離の徒歩を伴う場所は除外。"],
    ]
    t = Table([[p("<b>%s</b>" % a, S_CELL), p(b, S_CELL)] for a, b in cond],
              colWidths=[38 * mm, 232 * mm])
    t.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), "JP"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#cccccc")),
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f4f4f4")),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    story.append(t)
    story.append(Spacer(1, 5 * mm))

    # ---- 裏取りの状況(依頼どおりレポートにだけ書く) ----
    story.append(Paragraph("裏取りの状況（この欄はレポート限り。サイトには載せません）", S_H2))
    story.append(Spacer(1, 1.5 * mm))

    n_official = sum(1 for s in spots if s["evidence"] == "公式")
    n_review = sum(1 for s in spots if s["evidence"] == "口コミ")
    n_night_ok = sum(1 for s in spots if s["night"] != "要確認")
    n_night_chk = sum(1 for s in spots if s["night"] == "要確認")

    story.append(Paragraph(
        f"・出典が自治体・観光協会などの<b>公式ページ: {n_official}件</b>／"
        f"観光メディア・個人ブログなど<b>公式以外: {n_review}件</b>（表の「裏取り」欄）<br/>"
        f"・夜間の立入可否が<b>確認できたもの: {n_night_ok}件</b>／"
        f"<b>要確認: {n_night_chk}件</b>（表の「夜間」欄）<br/>"
        "・「要確認」は、その場所が使えないという意味ではなく、"
        "夜間の駐車場開放を明記した一次情報に行き当たらなかったという意味です。"
        "掲載前に管理者へ確認するか、公開時に注記を添えることをおすすめします。<br/>"
        "・<b>光害指標と星見レベルは推測ではありません。</b>本サイトが VIIRS 夜間光から作った"
        "光害データ（stars/data/lp-japan.png、解像度 約2.7km）を実際に引いた値です。"
        "星見レベルは「快晴・月なし」の条件での上限点で、その場所が出せる最良の値です。",
        S_SMALL))
    story.append(Spacer(1, 4 * mm))

    story.append(Paragraph("結果の要約", S_H2))
    story.append(Spacer(1, 1.5 * mm))
    counts = {}
    for s in spots:
        counts[s["band"]] = counts.get(s["band"], 0) + 1
    order = ["最高", "良い", "まずまず", "いまひとつ", "悪い", "不可"]
    rows = [[p("<b>段階</b>", S_CELL)] + [p("<b>%s</b>" % b, S_CELL) for b in order if b in counts],
            [p("件数", S_CELL)] + [p("%d" % counts[b], S_CELL) for b in order if b in counts]]
    t = Table(rows, colWidths=[24 * mm] + [22 * mm] * (len(rows[0]) - 1))
    style = [
        ("FONTNAME", (0, 0), (-1, -1), "JP"),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#cccccc")),
        ("ALIGN", (1, 0), (-1, -1), "CENTER"),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f4f4f4")),
    ]
    for i, b in enumerate([b for b in order if b in counts]):
        style.append(("BACKGROUND", (i + 1, 0), (i + 1, 0), BAND_COLOR[b]))
    t.setStyle(TableStyle(style))
    story.append(t)
    story.append(Spacer(1, 3 * mm))

    best = max(spots, key=lambda s: s["score"])
    worst = min(spots, key=lambda s: s["score"])
    story.append(Paragraph(
        f"・最も暗いのは <b>{best['pref']} {best['name']}</b>（{best['score']}点）、"
        f"最も明るいのは <b>{worst['pref']} {worst['name']}</b>（{worst['score']}点）。<br/>"
        "・大阪府は府内のどこを測っても光害が強く、府内最良でも「まずまず」止まりでした。"
        "神奈川・千葉・埼玉・長崎も県内に暗所が乏しく、他県より点が伸びません。"
        "これは選定の手抜きではなく、その地域の実際の明るさです。<br/>"
        "・<b>福島県は当初「浄土平」を候補にしましたが取り下げました。</b>"
        "磐梯吾妻スカイラインが夜間（17時〜翌8時）通行止めで、星を見る時間帯に到達できないためです。",
        S_SMALL))

    story.append(PageBreak())

    # ---- 本表 ----
    story.append(Paragraph("候補一覧（47都道府県・各1件）", S_H2))
    story.append(Spacer(1, 2 * mm))

    head = ["都道府県", "スポット名", "市町村", "星見\nレベル", "点数", "光害\n指標",
            "無料", "予約", "夜間", "アクセス・設備", "注意点", "裏取り"]
    widths = [17, 40, 20, 15, 11, 12, 11, 11, 15, 48, 55, 12]
    widths = [w * mm for w in widths]

    data = [[p("<b>%s</b>" % h.replace("\n", "<br/>"), S_CELL) for h in head]]
    for s in sorted(spots, key=lambda x: PREF_ORDER.index(x["pref"])):
        data.append([
            p(s["pref"]), p("<b>%s</b>" % s["name"]), p(s["city"]),
            p(s["band"]), p(str(s["score"])), p(str(s["lp"])),
            p(s["free"]), p(s["resv"]), p(s["night"]),
            p(s["access"]), p(s["caution"]), p(s["evidence"]),
        ])

    t = Table(data, colWidths=widths, repeatRows=1)
    ts = [
        ("FONTNAME", (0, 0), (-1, -1), "JP"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#cccccc")),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#eeeeee")),
        ("ALIGN", (3, 1), (8, -1), "CENTER"),
        ("ALIGN", (11, 1), (11, -1), "CENTER"),
        ("LEFTPADDING", (0, 0), (-1, -1), 2.5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2.5),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]
    for i, s in enumerate(sorted(spots, key=lambda x: PREF_ORDER.index(x["pref"])), start=1):
        # 星見レベルの欄をその段階の色で塗る(地図の凡例と同じ考え方)
        ts.append(("BACKGROUND", (3, i), (3, i), BAND_COLOR[s["band"]]))
        # 「要確認」は目で拾えるようにする(確定値と推定値を見た目でも分ける)
        if s["night"] == "要確認":
            ts.append(("BACKGROUND", (8, i), (8, i), colors.HexColor("#fde8e8")))
        if s["evidence"] == "口コミ":
            ts.append(("BACKGROUND", (11, i), (11, i), colors.HexColor("#fde8e8")))
        if i % 2 == 0:
            ts.append(("BACKGROUND", (0, i), (2, i), colors.HexColor("#fafafa")))
            ts.append(("BACKGROUND", (4, i), (7, i), colors.HexColor("#fafafa")))
            ts.append(("BACKGROUND", (9, i), (10, i), colors.HexColor("#fafafa")))
    t.setStyle(TableStyle(ts))
    story.append(t)

    story.append(Spacer(1, 3 * mm))
    story.append(Paragraph(
        "薄い赤の欄は、掲載前に確認が必要なところです。"
        "「点数」は快晴・月なしの上限、「光害指標」は 0（最も暗い）〜255（都心）。",
        S_NOTE))

    story.append(PageBreak())

    # ---- 出典 ----
    story.append(Paragraph("出典", S_H2))
    story.append(Spacer(1, 1.5 * mm))
    story.append(Paragraph(
        "各スポットの無料・駐車場・夜間の扱いについて参照したページです。"
        "「公式」は自治体・観光協会・施設の運営者によるもの。",
        S_SMALL))
    story.append(Spacer(1, 2 * mm))

    src_rows = [[p("<b>都道府県</b>", S_CELL), p("<b>種別</b>", S_CELL), p("<b>参照先</b>", S_CELL)]]
    for s in sorted(spots, key=lambda x: PREF_ORDER.index(x["pref"])):
        src_rows.append([p(s["pref"]), p(s["evidence"]),
                         p('<link href="%s" color="#1a4fb4">%s</link>' % (s["src"], s["src"]), S_SMALL)])
    t = Table(src_rows, colWidths=[22 * mm, 16 * mm, 239 * mm], repeatRows=1)
    t.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), "JP"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#cccccc")),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#eeeeee")),
        ("ALIGN", (1, 1), (1, -1), "CENTER"),
        ("TOPPADDING", (0, 0), (-1, -1), 1.6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1.6),
    ]))
    story.append(t)

    story.append(Spacer(1, 4 * mm))
    story.append(Paragraph("光害データの出典", S_H2))
    story.append(Spacer(1, 1.5 * mm))
    story.append(Paragraph(
        "光害指標・星見レベルの算出に使ったのは本サイト自作のデータです。"
        "NASA GIBS の VIIRS 夜間光（Suomi-NPP, DayNightBand Radiance）を新月夜16枚ぶん中央値合成し、"
        "大気散乱を掛けて「その地点の上空の明るさ」に変換したもの。解像度は約2.7km。"
        "計算式と校正に使った参照地点は quick-calc.site/stars/about.html に記載しています。",
        S_SMALL))

    doc.build(story)


PREF_ORDER = [
    "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
    "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
    "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県",
    "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県",
    "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県",
    "徳島県", "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県",
    "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
]

if __name__ == "__main__":
    src, out = sys.argv[1], sys.argv[2]
    with open(src, encoding="utf-8") as f:
        loaded = json.load(f)
    # 素の配列でも、注記つきの {"spots": [...]} でも受け取れるようにする
    spots = loaded["spots"] if isinstance(loaded, dict) else loaded

    missing = [x for x in PREF_ORDER if x not in {s["pref"] for s in spots}]
    if missing:
        raise SystemExit("都道府県が足りません: " + ", ".join(missing))

    build(spots, out)
    print("作成しました: %s（%d件）" % (out, len(spots)))
