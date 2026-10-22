"""ㄲㅂ 로고로 Windows 아이콘(assets/ggb.ico)을 만든다. 로고를 바꿨을 때만 다시 실행.

    pip install pillow
    python tools/make_icon.py

좌표는 static/index.html 로고와 같은 64 격자. 작은 크기에서도 또렷하도록 진한 파랑 바탕에 흰 획.
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "ggb.ico"

BG = "#3d5afe"
INK = "#ffffff"
STROKE = 6
STROKES = [
    [(10.2, 21), (18.2, 21), (18.2, 43)],                # ㄱ
    [(27.2, 21), (34.7, 21), (34.7, 43)],                # ㄱ
    [(43.7, 21), (43.7, 43), (53.8, 43), (53.8, 21)],    # ㅂ
    [(43.7, 32), (53.8, 32)],                            # ㅂ 가운데 획
]


def draw(size: int) -> Image.Image:
    k = size * 4 / 64   # 4배로 그린 뒤 줄여서 가장자리를 매끄럽게
    img = Image.new("RGBA", (size * 4, size * 4), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, size * 4 - 1, size * 4 - 1], radius=18 * k, fill=BG)
    w, r = STROKE * k, STROKE * k / 2
    for line in STROKES:
        pts = [(x * k, y * k) for x, y in line]
        d.line(pts, fill=INK, width=round(w))
        for x, y in pts:   # 둥근 끝과 꺾임
            d.ellipse([x - r, y - r, x + r, y + r], fill=INK)
    return img.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    OUT.parent.mkdir(exist_ok=True)
    sizes = [16, 24, 32, 48, 64, 128, 256]
    draw(256).save(OUT, sizes=[(s, s) for s in sizes], append_images=[draw(s) for s in sizes[:-1]])
    print(f"저장: {OUT}")
