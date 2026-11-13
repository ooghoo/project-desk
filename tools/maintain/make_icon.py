#!/usr/bin/env python3
"""生成项目台的 macOS 应用图标（可重复执行）。

用法：python tools/maintain/make_icon.py
依赖：Pillow（仅构建图标时需要，不参与应用运行）
"""
from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 1024
ACCENT = (11, 116, 255, 255)
WHITE = (255, 255, 255, 246)

# tools/maintain/ → 上两级才是仓库根目录
ROOT = Path(__file__).resolve().parent.parent.parent
ICON_DIR = ROOT / "src-tauri" / "icons"


def build_master() -> Image.Image:
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    # macOS 圆角方形底
    draw.rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=232, fill=ACCENT)

    # 顶部极轻的高光，给纯色底一点体积感
    highlight = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    hd = ImageDraw.Draw(highlight)
    hd.rounded_rectangle([0, 0, SIZE - 1, int(SIZE * 0.62)], radius=232, fill=(255, 255, 255, 20))
    mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=232, fill=255)
    img.paste(highlight, (0, 0), mask)

    # 2x2 网格：三个白色瓦片 + 一个播放三角，表达“项目集合 + 启动”
    tile, gap = 186, 58
    start = (SIZE - (tile * 2 + gap)) // 2
    radius = 44
    cells = [
        (start, start),
        (start + tile + gap, start),
        (start, start + tile + gap),
    ]
    for x, y in cells:
        draw.rounded_rectangle([x, y, x + tile, y + tile], radius=radius, fill=WHITE)

    # 播放三角（在第四格里做视觉居中）
    cx = start + tile + gap + tile // 2 + 10
    cy = start + tile + gap + tile // 2
    draw.polygon(
        [(cx - 46, cy - 72), (cx - 46, cy + 72), (cx + 74, cy)],
        fill=WHITE,
    )
    return img


def write_icns(master: Image.Image, target: Path) -> None:
    """直接写 .icns（PNG 编码的图标条目），避免依赖 iconutil 的临时目录。"""
    import io
    import struct

    # ICNS 类型 -> 像素尺寸
    entries = [
        (b"icp4", 16),
        (b"icp5", 32),
        (b"icp6", 64),
        (b"ic07", 128),
        (b"ic08", 256),
        (b"ic09", 512),
        (b"ic10", 1024),
        (b"ic11", 32),
        (b"ic12", 64),
        (b"ic13", 256),
        (b"ic14", 512),
    ]
    chunks = b""
    for code, size in entries:
        buf = io.BytesIO()
        master.resize((size, size), Image.LANCZOS).save(buf, format="PNG")
        data = buf.getvalue()
        chunks += code + struct.pack(">I", len(data) + 8) + data
    payload = b"icns" + struct.pack(">I", len(chunks) + 8) + chunks
    target.write_bytes(payload)


def main() -> None:
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    master = build_master()
    master.save(ICON_DIR / "icon.png")

    # Tauri 需要的散装 png
    for name, size in [("32x32.png", 32), ("128x128.png", 128), ("128x128@2x.png", 256)]:
        master.resize((size, size), Image.LANCZOS).save(ICON_DIR / name)

    write_icns(master, ICON_DIR / "icon.icns")
    print("icons written to", ICON_DIR)


if __name__ == "__main__":
    main()
