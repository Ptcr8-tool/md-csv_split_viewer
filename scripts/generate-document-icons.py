"""Generate Windows document icons from the project's own application icon.

The small bitmap alphabet is drawn from coordinates below: no system fonts,
external artwork, or platform-specific font rendering are required. Run from
the repository root with Python and Pillow. Committed ICOs are build inputs;
Pillow is only needed when regenerating them.
"""

from io import BytesIO
from pathlib import Path
import re
import struct

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "native" / "TextFileTypes.cs"
APP_ICON = ROOT / "native" / "app.ico"
OUTPUT = ROOT / "native" / "doc-icons"
SIZES = (16, 24, 32, 48, 64, 128, 256)
SCALE = 4

# A compact, deliberately drawn block alphabet. Each row is five pixels wide.
# Only A-Z and digits are needed for the supported extension names.
GLYPHS = {
    "A": ("01110", "11011", "11011", "11111", "11011", "11011", "11011"),
    "B": ("11110", "11011", "11011", "11110", "11011", "11011", "11110"),
    "C": ("01111", "11000", "11000", "11000", "11000", "11000", "01111"),
    "D": ("11110", "11011", "11011", "11011", "11011", "11011", "11110"),
    "E": ("11111", "11000", "11000", "11110", "11000", "11000", "11111"),
    "F": ("11111", "11000", "11000", "11110", "11000", "11000", "11000"),
    "G": ("01111", "11000", "11000", "11011", "11011", "11011", "01111"),
    "H": ("11011", "11011", "11011", "11111", "11011", "11011", "11011"),
    "I": ("11111", "01110", "01110", "01110", "01110", "01110", "11111"),
    "J": ("00111", "00011", "00011", "00011", "11011", "11011", "01110"),
    "K": ("11011", "11011", "11110", "11100", "11110", "11011", "11011"),
    "L": ("11000", "11000", "11000", "11000", "11000", "11000", "11111"),
    "M": ("10001", "11011", "11111", "10101", "10001", "10001", "10001"),
    "N": ("11001", "11101", "11101", "10111", "10111", "10011", "10011"),
    "O": ("01110", "11011", "11011", "11011", "11011", "11011", "01110"),
    "P": ("11110", "11011", "11011", "11110", "11000", "11000", "11000"),
    "Q": ("01110", "11011", "11011", "11011", "11111", "01110", "00011"),
    "R": ("11110", "11011", "11011", "11110", "11100", "11010", "11011"),
    "S": ("01111", "11000", "11000", "01110", "00011", "00011", "11110"),
    "T": ("11111", "01110", "01110", "01110", "01110", "01110", "01110"),
    "U": ("11011", "11011", "11011", "11011", "11011", "11011", "01110"),
    "V": ("11011", "11011", "11011", "11011", "11011", "01110", "00100"),
    "W": ("11011", "11011", "11011", "11011", "11111", "11111", "11011"),
    "X": ("11011", "11011", "01110", "00100", "01110", "11011", "11011"),
    "Y": ("11011", "11011", "11011", "01110", "01110", "01110", "01110"),
    "Z": ("11111", "00011", "00110", "01100", "11000", "11000", "11111"),
    "0": ("01110", "11011", "11111", "11111", "11011", "11011", "01110"),
    "1": ("01100", "11100", "01100", "01100", "01100", "01100", "11111"),
    "2": ("11110", "00011", "00011", "01110", "11000", "11000", "11111"),
    "3": ("11110", "00011", "00011", "01110", "00011", "00011", "11110"),
    "4": ("11011", "11011", "11011", "11111", "00011", "00011", "00011"),
    "5": ("11111", "11000", "11000", "11110", "00011", "00011", "11110"),
    "6": ("01111", "11000", "11000", "11110", "11011", "11011", "01110"),
    "7": ("11111", "00011", "00110", "01100", "01100", "01100", "01100"),
    "8": ("01110", "11011", "11011", "01110", "11011", "11011", "01110"),
    "9": ("01110", "11011", "11011", "01111", "00011", "00011", "11110"),
}


def supported_extensions():
    source = SOURCE.read_text(encoding="utf-8")
    groups = re.findall(r'new\("[^"\r\n]+",\s*\[([^\]]+)\]', source)
    extensions = sorted({value for group in groups for value in re.findall(r'"([a-z][a-z0-9]*)"', group)})
    if not {"md", "txt", "csv", "bat", "cmd"}.issubset(extensions):
        raise ValueError("Could not read the complete extension list")
    return extensions


def icon_image(label):
    n = 256 * SCALE
    im = Image.new("RGBA", (n, n))
    d = ImageDraw.Draw(im)
    def box(values):
        return tuple(round(x * SCALE) for x in values)
    def poly(values):
        return [(round(x * SCALE), round(y * SCALE)) for x, y in values]
    # Light shadow, separate paper sheet, and a folded upper-right corner.
    d.rounded_rectangle(box((29, 14, 214, 249)), radius=12*SCALE, fill=(0, 0, 0, 36))
    d.polygon(poly(((25, 8), (160, 8), (210, 58), (210, 239), (25, 239))), fill=(250, 252, 250, 255), outline=(185, 199, 193, 255), width=2*SCALE)
    d.polygon(poly(((160, 8), (160, 58), (210, 58))), fill=(220, 230, 224, 255))
    d.line(poly(((160, 8), (160, 58), (210, 58))), fill=(176, 194, 185, 255), width=2*SCALE)
    # A restrained document motif remains recognisable in Explorer at small sizes.
    for y, right in ((80, 173), (98, 173), (116, 143)):
        d.rounded_rectangle(box((43, y, right, y+5)), radius=2*SCALE, fill=(195, 210, 201, 255))
    d.rounded_rectangle(box((34, 145, 184, 196)), radius=5*SCALE, fill=(42, 97, 79, 255))
    if label:
        label = label.upper()
        if any(ch not in GLYPHS for ch in label):
            raise ValueError("Extension contains an unsupported glyph")
        columns = len(label) * 6 - 1
        pixel = min(5.2*SCALE, 136*SCALE / columns, 34*SCALE / 7)
        left = 40*SCALE + max(0, (136*SCALE - columns*pixel)/2)
        top = 153*SCALE + (34*SCALE - 7*pixel)/2
        for index, ch in enumerate(label):
            for y, row in enumerate(GLYPHS[ch]):
                for x, value in enumerate(row):
                    if value == "1":
                        px = left + (index*6+x)*pixel
                        py = top + y*pixel
                        d.rectangle((round(px), round(py), round(px+pixel-1), round(py+pixel-1)), fill=(255, 255, 255, 255))
    else:
        # The legacy shared ProgID cannot know an extension, so show a simple
        # document mark rather than presenting a wrong extension.
        d.rounded_rectangle(box((47, 160, 153, 167)), radius=3*SCALE, fill=(235, 246, 239, 255))
        d.rounded_rectangle(box((47, 176, 128, 183)), radius=3*SCALE, fill=(235, 246, 239, 255))
    # Preserve the exact existing app mark to make association provenance clear.
    badge = Image.open(APP_ICON).convert("RGBA").resize((76*SCALE, 76*SCALE), Image.Resampling.LANCZOS)
    im.alpha_composite(badge, (169*SCALE, 169*SCALE))
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
