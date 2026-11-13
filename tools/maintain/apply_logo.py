#!/usr/bin/env python3
"""把一张方形 PNG 变成 macOS 应用图标（圆角方形 + 透明边距）。

用法：
    python3 tools/maintain/apply_logo.py <源图.png>

会生成：
    src-tauri/icons/logo-source.png   原始素材备份
    src-tauri/icons/icon.png          1024×1024 主图标
    src-tauri/icons/32x32.png
    src-tauri/icons/128x128.png
    src-tauri/icons/128x128@2x.png
    src-tauri/icons/icon.icns         macOS 实际读取的图标

生成后需要重新构建应用：bash tools/build/build.sh
依赖：Pillow（仅生成图标时需要）
"""
import sys
import shutil
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent.parent
ICON_DIR = ROOT / "src-tauri" / "icons"

CANVAS = 1024
# Apple 的 macOS 图标网格：824×824 内容区居中，四周 100px 透明边距
TILE = 824
MARGIN = (CANVAS - TILE) // 2
RADIUS = 185


def rounded_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return mask


def build(source: Path) -> Image.Image:
    art = Image.open(source).convert("RGBA")
    if art.width != art.height:
        side = min(art.size)
        left = (art.width - side) // 2
        top = (art.height - side) // 2
        art = art.crop((left, top, left + side, top + side))

    # 按原稿等比放入图块：不裁切、不放大，保留素材自带的留白与投影
    tile = art.resize((TILE, TILE), Image.LANCZOS)
    tile.putalpha(rounded_mask(TILE, RADIUS))

    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    canvas.paste(tile, (MARGIN, MARGIN), tile)
    return canvas


def write_icns(master: Image.Image, target: Path) -> None:
    """直接写 .icns（PNG 编码条目），不依赖 iconutil 的临时文件。"""
    import io
    import struct

    entries = [
        (b"icp4", 16), (b"icp5", 32), (b"icp6", 64), (b"ic07", 128),
        (b"ic08", 256), (b"ic09", 512), (b"ic10", 1024),
        (b"ic11", 32), (b"ic12", 64), (b"ic13", 256), (b"ic14", 512),
    ]
    chunks = b""
    for code, size in entries:
        buf = io.BytesIO()
        master.resize((size, size), Image.LANCZOS).save(buf, format="PNG")
        data = buf.getvalue()
        chunks += code + struct.pack(">I", len(data) + 8) + data
    target.write_bytes(b"icns" + struct.pack(">I", len(chunks) + 8) + chunks)


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        raise SystemExit(1)
    source = Path(sys.argv[1]).expanduser()
    if not source.is_file():
        raise SystemExit(f"找不到图片：{source}")

    ICON_DIR.mkdir(parents=True, exist_ok=True)
    backup = ICON_DIR / "logo-source.png"
    if source.resolve() != backup.resolve():
        shutil.copyfile(source, backup)

    master = build(source)
    master.save(ICON_DIR / "icon.png")
    for name, size in [("32x32.png", 32), ("128x128.png", 128), ("128x128@2x.png", 256)]:
        master.resize((size, size), Image.LANCZOS).save(ICON_DIR / name)
    write_icns(master, ICON_DIR / "icon.icns")

    print(f"图标已生成：{ICON_DIR}")
    print("下一步：bash tools/build/build.sh")


if __name__ == "__main__":
    main()
