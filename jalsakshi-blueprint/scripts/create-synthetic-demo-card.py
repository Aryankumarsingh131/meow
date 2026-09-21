from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.colors import HexColor, black, white
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[2]
PDF = ROOT / "output" / "pdf" / "jalsakshi-synthetic-demo-card-v1.pdf"
FIXTURES = ROOT / "apps" / "mobile" / "assets" / "demo"
COLORS = {
    "SYN-A": "#3B82F6",
    "SYN-B": "#10B981",
    "SYN-C": "#F59E0B",
    "SYN-D": "#EF4444",
}


def centered(c: canvas.Canvas, text: str, y: float, size: int, color=black) -> None:
    c.setFillColor(color)
    c.setFont("Helvetica-Bold", size)
    c.drawCentredString(landscape(A4)[0] / 2, y, text)


def paragraph(c: canvas.Canvas, lines: list[str], x: float, y: float, size: int = 10, leading: int = 14) -> None:
    c.setFillColor(black)
    c.setFont("Helvetica", size)
    for line in lines:
        c.drawString(x, y, line)
        y -= leading


def draw_marks(c: canvas.Canvas, width: float, height: float) -> None:
    mark, inset = 13 * mm, 10 * mm
    for x, y in ((inset, inset), (width - inset - mark, inset), (inset, height - inset - mark),
                 (width - inset - mark, height - inset - mark)):
        c.setFillColor(black)
        c.rect(x, y, mark, mark, fill=1, stroke=0)
        c.setFillColor(white)
        c.rect(x + 4 * mm, y + 4 * mm, 5 * mm, 5 * mm, fill=1, stroke=0)


def create_fixtures() -> None:
    FIXTURES.mkdir(parents=True, exist_ok=True)
    title_font = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 58)
    label_font = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 92)
    body_font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 38)
    for label, color in COLORS.items():
        image = Image.new("RGB", (1200, 1200), "#F7F7F2")
        draw = ImageDraw.Draw(image)
        draw.rectangle((8, 8, 1191, 1191), outline="black", width=16)
        draw.text((600, 60), "JalSakshi - SYNTHETIC FIXTURE", font=title_font, fill="black", anchor="ma")
        draw.rectangle((180, 210, 1020, 950), fill=color, outline="black", width=12)
        draw.text((600, 580), label, font=label_font, fill="white", stroke_fill="black", stroke_width=4, anchor="mm")
        draw.text((600, 1010), f"EXPECTED DEMO LABEL: {label}", font=body_font, fill="black", anchor="ma")
        draw.text((600, 1080), "DEMO ONLY - NOT WATER ANALYSIS", font=body_font, fill="#B91C1C", anchor="ma")
        image.save(FIXTURES / f"{label.lower()}.png", optimize=True)


def create_pdf() -> None:
    PDF.parent.mkdir(parents=True, exist_ok=True)
    width, height = landscape(A4)
    c = canvas.Canvas(str(PDF), pagesize=(width, height), pageCompression=1)
    c.setTitle("JalSakshi Synthetic Demo Reference Card v1")
    c.setAuthor("JalSakshi prototype team")

    # Page 1: printable reference card.
    c.setLineWidth(2)
    c.rect(6 * mm, 6 * mm, width - 12 * mm, height - 12 * mm)
    draw_marks(c, width, height)
    centered(c, "JalSakshi Synthetic Demo Reference Card v1", height - 24 * mm, 22)
    centered(c, "DEMO ONLY - NOT WATER ANALYSIS", height - 35 * mm, 17, HexColor("#B91C1C"))
    centered(c, "Protocol SYN-COLOR-001 | Demo lot DEMO-0001 | Expiry: N/A", height - 44 * mm, 10)

    patch_y, patch_w, patch_h, gap = height - 91 * mm, 48 * mm, 30 * mm, 8 * mm
    start_x = (width - (4 * patch_w + 3 * gap)) / 2
    for index, (label, color) in enumerate(COLORS.items()):
        x = start_x + index * (patch_w + gap)
        c.setFillColor(HexColor(color))
        c.rect(x, patch_y, patch_w, patch_h, fill=1, stroke=1)
        c.setFillColor(white)
        c.setFont("Helvetica-Bold", 15)
        c.drawCentredString(x + patch_w / 2, patch_y + 12 * mm, label)
        c.setFont("Helvetica", 8)
        c.drawCentredString(x + patch_w / 2, patch_y + 5 * mm, color)

    c.setFillColor(HexColor("#EFF6FF"))
    c.roundRect(21 * mm, 54 * mm, 122 * mm, 47 * mm, 4 * mm, fill=1, stroke=0)
    c.setFillColor(black)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(27 * mm, 92 * mm, "Synthetic capture procedure")
    paragraph(c, [
        "1. Print at 100% on matte white paper; do not color-correct.",
        "2. Use even indoor light, no flash, and keep all four corner marks visible.",
        "3. Place one controlled SYN-A/B/C/D tile in the center below the swatches.",
        "4. Capture, save offline, reopen after app restart, then sync when online.",
        "5. A supervisor may accept/refer only the synthetic demo record.",
    ], 27 * mm, 83 * mm, 9, 12)

    c.setFillColor(HexColor("#FFF7ED"))
    c.roundRect(151 * mm, 54 * mm, 125 * mm, 47 * mm, 4 * mm, fill=1, stroke=0)
    c.setFillColor(black)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(157 * mm, 92 * mm, "Required evidence log")
    paragraph(c, [
        "Phone model / Android version / RAM / available storage",
        "Printer / paper / lighting / capture distance / timestamp",
        "App build hash / fixture ID / expected demo label / observed label",
        "Offline restart result / sync result / synthetic supervisor decision",
        "Never record concentration, safety, potability, diagnosis, or remedy.",
    ], 157 * mm, 83 * mm, 9, 12)

    centered(c, "Printed colors vary by printer, paper, light, and camera. Mismatch means DEMO INVALID, not a water result.",
             20 * mm, 10, HexColor("#B91C1C"))
    c.setFont("Helvetica", 8)
    c.setFillColor(black)
    c.drawString(28 * mm, 9 * mm, "Prepared before event confirmation - 22 Sep 2026")
    c.showPage()

    # Page 2: controlled synthetic sample tiles.
    centered(c, "Controlled Synthetic Sample Tiles", height - 18 * mm, 22)
    centered(c, "CUT OR DISPLAY FOR DEMO ONLY - NOT SCIENTIFIC REFERENCE MATERIAL", height - 29 * mm, 13,
             HexColor("#B91C1C"))
    positions = [(22 * mm, 106 * mm), (151 * mm, 106 * mm), (22 * mm, 18 * mm), (151 * mm, 18 * mm)]
    for (label, color), (x, y) in zip(COLORS.items(), positions):
        c.setDash(5, 3)
        c.setStrokeColor(black)
        c.rect(x, y, 116 * mm, 76 * mm, fill=0, stroke=1)
        c.setDash()
        c.setFillColor(HexColor(color))
        c.rect(x + 8 * mm, y + 18 * mm, 100 * mm, 48 * mm, fill=1, stroke=1)
        c.setFillColor(white)
        c.setFont("Helvetica-Bold", 24)
        c.drawCentredString(x + 58 * mm, y + 39 * mm, label)
        c.setFillColor(black)
        c.setFont("Helvetica-Bold", 10)
        c.drawCentredString(x + 58 * mm, y + 8 * mm, f"EXPECTED DEMO LABEL: {label} | {color}")
        c.setFont("Helvetica", 8)
        c.drawCentredString(x + 58 * mm, y + 3 * mm, "No concentration or potability meaning")
    c.setFont("Helvetica", 8)
    c.drawRightString(width - 10 * mm, 8 * mm, "SYN-COLOR-001 | Page 2 of 2")
    c.save()


if __name__ == "__main__":
    create_fixtures()
    create_pdf()
    print(PDF)
