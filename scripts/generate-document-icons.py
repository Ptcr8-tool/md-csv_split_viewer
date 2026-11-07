"""Generate Windows document icons from the project's own application icon.

The bundled, subset DejaVu Sans Bold font is used for reproducible rendering;
see licenses/DejaVu-LICENSE.txt for its license. Run from the repository root
with Python and Pillow. Committed ICOs are build inputs; Pillow is only needed
when regenerating them.
"""

from io import BytesIO
from pathlib import Path
import re
import struct

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "native" / "TextFileTypes.cs"
APP_ICON = ROOT / "native" / "app.ico"
LABEL_FONT = ROOT / "scripts" / "fonts" / "DejaVuSans-Bold-Subset.ttf"
OUTPUT = ROOT / "native" / "doc-icons"
SIZES = (16, 24, 32, 48, 64, 128, 256)
SCALE = 4



def supported_extensions():
    source = SOURCE.read_text(encoding="utf-8")
    groups = re.findall(r'new\("[^"\r\n]+",\s*\[([^\]]+)\]', source)
    extensions = sorted({value for group in groups for value in re.findall(r'"([a-z][a-z0-9]*)"', group)})
    if not {"md", "txt", "csv", "bat", "cmd"}.issubset(extensions):
        raise ValueError("Could not read the complete extension list")
    return extensions


def icon_image(label):
    """Draw the paper and a central, high contrast extension at 4x resolution."""
    n = 256 * SCALE
    im = Image.new("RGBA", (n, n))
    d = ImageDraw.Draw(im)

    def box(values):
        return tuple(round(x * SCALE) for x in values)

    def poly(values):
        return [(round(x * SCALE), round(y * SCALE)) for x, y in values]

    # The letter occupies most of the icon, leaving space for a folded corner.
    d.rounded_rectangle(box((22, 12, 218, 252)), radius=8*SCALE, fill=(0, 0, 0, 36))
    d.polygon(poly(((19, 5), (160, 5), (216, 61), (216, 244), (19, 244))),
              fill=(253, 254, 253, 255), outline=(162, 181, 171, 255), width=2*SCALE)
    d.polygon(poly(((160, 5), (160, 61), (216, 61))), fill=(220, 230, 224, 255))
    d.line(poly(((160, 5), (160, 61), (216, 61))), fill=(162, 181, 171, 255), width=2*SCALE)
    # A neutral detail preserves the document metaphor without competing with
    # the extension. The icon is the application's mark, not a filename.
    for y, right in ((180, 146), (194, 124)):
        d.rounded_rectangle(box((36, y, right, y+4)), radius=2*SCALE, fill=(196, 211, 202, 255))
    if label:
        label = label.upper()
        if re.fullmatch(r"[A-Z0-9]+", label) is None:
            raise ValueError("Extension contains an unsupported glyph")
        # Fit the full extension to the central area, preferring large glyphs.
        for font_size in range(84*SCALE, 2*SCALE, -SCALE):
            font = ImageFont.truetype(str(LABEL_FONT), font_size)
            bounds = d.textbbox((0, 0), label, font=font)
            width, height = bounds[2]-bounds[0], bounds[3]-bounds[1]
            if width <= 177*SCALE and height <= 58*SCALE:
                break
        left = 117.5*SCALE - width/2 - bounds[0]
        top = 117*SCALE - height/2 - bounds[1]
        d.text((round(left), round(top)), label, font=font, fill=(28, 87, 70, 255))

    else:
        # Legacy shared ProgIDs have no extension information. Never invent one.
        for y, right in ((99, 187), (116, 174), (133, 152)):
            d.rounded_rectangle(box((42, y, right, y+6)), radius=3*SCALE,
                                fill=(118, 155, 136, 255))
    # Retain the established application mark as a secondary badge.
    badge = Image.open(APP_ICON).convert("RGBA").resize((62*SCALE, 62*SCALE), Image.Resampling.LANCZOS)
    im.alpha_composite(badge, (174*SCALE, 181*SCALE))
    return im


def write_ico(path, image):
    # Encode each size explicitly. All frames are PNG RGBA, supported on modern
    # Windows, with the standard 0 byte encoding for the 256px dimensions.
    frames = []
    for size in SIZES:
        frame = image.resize((size, size), Image.Resampling.LANCZOS)
        stream = BytesIO()
        frame.save(stream, format="PNG", optimize=False, compress_level=9)
        frames.append((size, stream.getvalue()))
    offset = 6 + 16*len(frames)
    chunks = [struct.pack("<HHH", 0, 1, len(frames))]
    for size, content in frames:
        dimension = 0 if size == 256 else size
        chunks.append(struct.pack("<BBBBHHII", dimension, dimension, 0, 0, 1, 32, len(content), offset))
        offset += len(content)
    chunks.extend(content for _, content in frames)
    path.write_bytes(b"".join(chunks))


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    expected = {"document.ico"}
    write_ico(OUTPUT / "document.ico", icon_image(""))
    for extension in supported_extensions():
        name = extension + ".ico"
        expected.add(name)
        write_ico(OUTPUT / name, icon_image(extension))
    extra = {file.name for file in OUTPUT.glob("*.ico")} - expected
    if extra:
        raise ValueError("Unexpected generated icons: " + ", ".join(sorted(extra)))
    print(f"Generated {len(expected)} icons with {len(SIZES)} frames each.")


if __name__ == "__main__":
    main()
