"""Generate the Word and PDF sample invoices from the website catalogue."""

import json
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

from docx import Document
from docx.shared import Pt, RGBColor
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "public/invoice-templates"
TEAL = "#0F665D"
NOTE = "Illustrative values and tax rates. Replace the sample details and confirm the GST treatment before issuing an invoice."


def money(value):
    return f"{value:,.2f}"


def rounded(value):
    return value.quantize(Decimal(".01"), rounding=ROUND_HALF_UP)


def invoice_content(template):
    title = f'{template["name"]} sample invoice'
    details = [
        ("Seller", "[Name, address, GSTIN]"),
        ("Bill to", "[Customer name, address, GSTIN if applicable]"),
        ("Invoice number and date", "SAMPLE-001  /  [Date]"),
        ("Place of supply", "[State and code]"),
        ("Ship to", "[Delivery address if different]"),
        ("Tax treatment and reverse charge", "[Verify for this transaction]"),
        *((field, f"[{description}]") for field, description in template["fields"]),
    ]
    items = [("Description", "HSN/SAC", "Quantity", "Rate INR", "GST %", "Taxable INR")]
    subtotal = tax = Decimal("0")
    for label, qty, unit, rate, percent in template["lines"]:
        taxable = Decimal(qty * rate)
        subtotal += taxable
        tax += rounded(taxable * percent / 100)
        items.append((label, "[Code]", f"{qty} {unit}", money(rate), str(percent), money(taxable)))
    cgst = rounded(tax / 2)
    totals = [
        ("Taxable subtotal", money(subtotal)),
        ("Sample CGST", money(cgst)),
        ("Sample SGST", money(tax - cgst)),
        ("Total INR", money(subtotal + tax)),
        ("Payments received / balance", "[Enter payment details]"),
        ("Authorized signature", "[Sign as applicable]"),
    ]
    return title, details, items, totals


def word_table(document, rows, header=False):
    table = document.add_table(rows=0, cols=len(rows[0]))
    table.style = "Table Grid"
    for index, row in enumerate(rows):
        for column, (cell, value) in enumerate(zip(table.add_row().cells, row)):
            paragraph = cell.paragraphs[0]
            paragraph.paragraph_format.space_after = Pt(3)
            paragraph.paragraph_format.space_before = Pt(3)
            run = paragraph.add_run(value)
            run.font.size = Pt(9)
            if (header and index == 0) or (not header and column == 0):
                run.bold = True


def generate_word(file, title, details, items, totals):
    document = Document()
    document.sections[0].top_margin = Pt(40)
    document.sections[0].bottom_margin = Pt(40)
    document.add_paragraph(title, "Title")
    note = document.add_paragraph().add_run(NOTE)
    note.font.color.rgb = RGBColor.from_string(TEAL[1:])
    note.font.size = Pt(10)
    word_table(document, details)
    document.add_paragraph("Line items", "Heading 2")
    word_table(document, items, header=True)
    document.add_paragraph("Totals and payment", "Heading 2")
    word_table(document, totals)
    document.save(file)


def pdf_table(rows, widths, header=False):
    layout = [
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("TEXTCOLOR", (0, 0), (-1, -1), colors.HexColor("#202F4A")),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LINEBELOW", (0, 0), (-1, -1), .5, colors.HexColor("#D7E4E5")),
        ("ROWBACKGROUNDS", (0, 0), (-1, -1), [colors.white, colors.HexColor("#F4F8F8")]),
    ]
    if header:
        layout.extend([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor(TEAL)),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ])
    else:
        layout.append(("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"))
    if len(widths) > 2:
        layout.append(("ALIGN", (3, 0), (-1, -1), "RIGHT"))
    return Table(rows, colWidths=widths, style=TableStyle(layout))


def generate_pdf(file, title, details, items, totals):
    styles = getSampleStyleSheet()
    styles["Heading2"].textColor = colors.HexColor(TEAL)
    pdf = SimpleDocTemplate(str(file), pagesize=A4, title=title,
                            leftMargin=40, rightMargin=40, topMargin=36, bottomMargin=36)
    pdf.build([
        Paragraph(title, styles["Heading1"]),
        Paragraph(NOTE, styles["BodyText"]),
        Spacer(1, 15),
        pdf_table(details, [180, 325]),
        Paragraph("Line items", styles["Heading2"]),
        pdf_table(items, [150, 55, 85, 70, 55, 90], header=True),
        Paragraph("Totals and payment", styles["Heading2"]),
        pdf_table(totals, [180, 325]),
    ])


if __name__ == "__main__":
    OUTPUT.mkdir(parents=True, exist_ok=True)
    catalogue = json.loads((ROOT / "src/data/invoice-formats.json").read_text())
    for template in catalogue:
        content = invoice_content(template)
        generate_word(OUTPUT / f'{template["id"]}.docx', *content)
        generate_pdf(OUTPUT / f'{template["id"]}.pdf', *content)
