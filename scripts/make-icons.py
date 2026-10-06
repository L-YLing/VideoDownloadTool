"""生成 VD视频下载器 应用图标：build/icon.ico（多尺寸）+ resources/tray.png"""
import math
from PIL import Image, ImageDraw

PRIMARY = (100, 181, 246)   # 淡蓝 #64B5F6
PRIMARY_DARK = (66, 145, 214)
WHITE = (255, 255, 255)

def rounded_rect(draw, box, radius, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)

def draw_icon(size, padding_ratio=0.10):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    pad = int(size * padding_ratio)
    # 背景圆角方块：淡蓝渐变（左上浅 → 右下深）
    for y in range(pad, size - pad):
        t = (y - pad) / (size - 2 * pad)
        r = int(PRIMARY[0] + (PRIMARY_DARK[0] - PRIMARY[0]) * t)
        g = int(PRIMARY[1] + (PRIMARY_DARK[1] - PRIMARY[1]) * t)
        b = int(PRIMARY[2] + (PRIMARY_DARK[2] - PRIMARY[2]) * t)
        draw.line([(pad, y), (size - pad, y)], fill=(r, g, b, 255))
    # 圆角遮罩
    mask = Image.new("L", (size, size), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * 0.22), fill=255)
    img.putalpha(mask)

    # 白色下载箭头：竖线 + 箭头 + 底座
    cx = size / 2
    shaft_w = size * 0.09
    arrow_h = size * 0.22
    base_y = size * 0.74
    top_y = size * 0.32
    draw = ImageDraw.Draw(img)
    # 竖线
    draw.rectangle([cx - shaft_w / 2, top_y, cx + shaft_w / 2, base_y], fill=WHITE)
    # 箭头（三角形）
    tri_w = size * 0.30
    draw.polygon(
        [
            (cx - tri_w / 2, base_y - arrow_h * 0.55),
            (cx + tri_w / 2, base_y - arrow_h * 0.55),
            (cx, base_y + arrow_h * 0.45),
        ],
        fill=WHITE,
    )
    # 底座
    bar_w = size * 0.42
    bar_h = size * 0.07
    draw.rounded_rectangle(
        [cx - bar_w / 2, base_y + arrow_h * 0.55, cx + bar_w / 2, base_y + arrow_h * 0.55 + bar_h],
        radius=bar_h / 2,
        fill=WHITE,
    )
    return img

# 多尺寸 ICO（Windows 安装包/任务栏）
sizes = [16, 24, 32, 48, 64, 128, 256]
images = [draw_icon(s) for s in sizes]
images[-1].save(
    "D:/VideoDownloadTool/vd-dl/build/icon.ico",
    format="ICO",
    sizes=[(s, s) for s in sizes],
    append_images=images[:-1],
)
print("icon.ico OK")

# 托盘图标（16x16）
tray = draw_icon(64)
tray = tray.resize((16, 16), Image.LANCZOS)
tray.save("D:/VideoDownloadTool/vd-dl/resources/tray.png")
print("tray.png OK")

# 打包额外资源需要的许可说明（一并生成目录）
import os
os.makedirs("D:/VideoDownloadTool/vd-dl/resources/bin", exist_ok=True)
print("resources OK")
