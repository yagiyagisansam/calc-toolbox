# 検討中ツール(lab)の一覧表をPDFで出力する
#
# 入力: lab/tools.json(build_lab_index.mjs が生成)・lab/_meta.json・lab/verify_report.json(あれば)
# 出力: lab/新ツール一覧.pdf
#
# 使い方: python3 scripts/build/build_lab_pdf.py
import json
import os
from datetime import date

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (BaseDocTemplate, Frame, PageTemplate, Paragraph,
                                Spacer, Table, TableStyle)

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LAB = os.path.join(ROOT, "lab")
OUT = os.path.join(LAB, "新ツール一覧.pdf")

# 日本語フォント(この環境に入っている IPAゴシック)
FONT_PATH = "/usr/share/fonts/truetype/fonts-japanese-gothic.ttf"
pdfmetrics.registerFont(TTFont("JP", FONT_PATH))

CAT_ORDER = ["健康", "お金", "日付", "変換"]
CAT_LABEL = {"健康": "健康", "お金": "お金", "日付": "日付・時間", "変換": "暮らし・変換"}
CAT_COLOR = {
    "健康": colors.HexColor("#e4f2ea"),
    "お金": colors.HexColor("#f7ecd9"),
    "日付": colors.HexColor("#e5edf9"),
    "変換": colors.HexColor("#eee8f7"),
}
ACCENT = colors.HexColor("#0b6e4f")
INK = colors.HexColor("#26282b")
MUTED = colors.HexColor("#6d7378")

tools = json.load(open(os.path.join(LAB, "tools.json"), encoding="utf-8"))
meta = {m["slug"]: m for m in json.load(open(os.path.join(LAB, "_meta.json"), encoding="utf-8"))}
report = {}
rp = os.path.join(LAB, "verify_report.json")
if os.path.exists(rp):
    report = json.load(open(rp, encoding="utf-8"))


def st(name, size, leading=None, color=INK, bold=False):
    return ParagraphStyle(name, fontName="JP", fontSize=size, leading=leading or size * 1.45,
                          textColor=color, alignment=TA_LEFT, wordWrap="CJK")


S_TITLE = st("t", 19, 25)
S_LEAD = st("l", 9.5, 15, MUTED)
S_H2 = st("h2", 12.5, 17, ACCENT)
S_CELL = st("c", 7.6, 10.4)
S_CELL_S = st("cs", 6.9, 9.4, MUTED)
S_TH = st("th", 7.8, 10.5, colors.white)

doc = BaseDocTemplate(OUT, pagesize=landscape(A4),
                      leftMargin=12 * mm, rightMargin=12 * mm,
                      topMargin=12 * mm, bottomMargin=14 * mm,
                      title="検討中の新ツール一覧", author="計算ツールボックス")
frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="f")


def footer(canvas, d):
    canvas.saveState()
    canvas.setFont("JP", 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(doc.leftMargin, 8 * mm, "計算ツールボックス — 検討中の新ツール一覧(公開サイト未反映)")
    canvas.drawRightString(doc.pagesize[0] - doc.rightMargin, 8 * mm, "%d" % canvas.getPageNumber())
    canvas.restoreState()


doc.addPageTemplates([PageTemplate(id="all", frames=[frame], onPage=footer)])

story = []
today = date.today().strftime("%Y年%-m月%-d日")
story.append(Paragraph("検討中の新ツール一覧", S_TITLE))
n_ok = sum(1 for t in tools if report.get(t["slug"], {}).get("ok", True))
n_tests = sum(t.get("tests", 0) for t in tools)
story.append(Paragraph(
    f"{len(tools)}件 / 作成日 {today} / 計算テスト {n_tests}件 / 検証通過 {n_ok}件<br/>"
    "国内外の計算ツールを調査して選定しました。すべて端末内だけで計算し、外部への通信はありません。"
    "<b>公開サイト(quick-calc.site)には反映していません</b> — 一覧・検索・サイトマップのいずれにも載せていません。",
    S_LEAD))
story.append(Spacer(1, 5 * mm))

HEADERS = ["#", "ツール名", "概要", "分野", "使う場面", "根拠(出典)", "テスト"]
WIDTHS = [8 * mm, 44 * mm, 68 * mm, 17 * mm, 55 * mm, 62 * mm, 12 * mm]

n = 0
for cat in CAT_ORDER:
    rows = [t for t in tools if t["cat"] == cat]
    if not rows:
        continue
    story.append(Paragraph(f"{CAT_LABEL[cat]}({len(rows)}件)", S_H2))
    story.append(Spacer(1, 1.6 * mm))

    data = [[Paragraph(f"<b>{h}</b>", S_TH) for h in HEADERS]]
    for t in rows:
        n += 1
        m = meta.get(t["slug"], {})
        src = t.get("sourceName") or m.get("source", "")
        if t.get("sourceUrl"):
            src = f'{src}<br/><font size="6">{t["sourceUrl"][:78]}</font>'
        r = report.get(t["slug"], {})
        mark = "OK" if r.get("ok", True) else "NG"
        data.append([
            Paragraph(str(n), S_CELL),
            Paragraph(t["name"], S_CELL),
            Paragraph(t["desc"], S_CELL_S),
            Paragraph(m.get("field") or CAT_LABEL[cat], S_CELL_S),
            Paragraph(m.get("why", ""), S_CELL_S),
            Paragraph(src, S_CELL_S),
            Paragraph(f'{t.get("tests", 0)}件<br/>{mark}', S_CELL_S),
        ])

    tbl = Table(data, colWidths=WIDTHS, repeatRows=1)
    style = [
        ("FONTNAME", (0, 0), (-1, -1), "JP"),
        ("BACKGROUND", (0, 0), (-1, 0), ACCENT),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#d9dde0")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#fafafa")]),
        ("BACKGROUND", (3, 1), (3, -1), CAT_COLOR[cat]),
    ]
    tbl.setStyle(TableStyle(style))
    story.append(tbl)
    story.append(Spacer(1, 6 * mm))

doc.build(story)
print(f"{OUT} を作成しました({len(tools)}件)")
