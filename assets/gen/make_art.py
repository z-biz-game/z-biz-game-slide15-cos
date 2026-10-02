#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SLIDE15 美术资产生成器 —— 只用 Python 标准库（zlib + struct），手写 PNG。

为什么在仓内自带一个位图工厂：
- 图标是品牌资产，必须"真实可读"，不能是 0 字节占位或 SVG 冒充 PNG。本脚本产出的每一张
  都是逐像素算出来的 RGBA 位图，用 zlib 压成合法的 PNG 块，任何 ImageMagick / 浏览器都能读。
- 必须可复现：无随机、无外部依赖，`python3 assets/gen/make_art.py` 每次得到同样的字节。

视觉母题沿用玩法本身：一块暗色金属托盘上，n×n 的圆角方块，贴着空格的那几块点亮成黄铜色
（可滑动），已经归位的染一抹青色，中间留一个洞。这正是 js/view.js 在画布上画的东西，图标
把它缩成一枚徽章。

产出的文件（都落在 icons/ 与 assets/texture/）：
  icons/icon-1024.png / icon-512.png / icon-maskable-512.png / icon-192.png
  icons/apple-touch-icon.png(180) / icon-96.png / icon-64.png / icon-48.png
  icons/favicon-32.png / favicon-16.png
  icons/og-card.png(1200x630)
  assets/texture/tray-64.png  —— 一张可平铺的暗色托盘纹理，CSS 背景真实引用它
"""
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
ICONS = os.path.join(REPO, "icons")
TEX = os.path.join(REPO, "assets", "texture")

# 主题色（与 css/game.css 的 :root 一致，实测抽取）
BG_TOP = (0x17, 0x1A, 0x21)
BG_BOT = (0x10, 0x12, 0x17)
BRASS = (0xD8, 0xA1, 0x3C)
BRASS_HI = (0xE8, 0xB4, 0x5A)
BRASS_LO = (0x96, 0x6C, 0x1F)
STEEL = (0x33, 0x3B, 0x48)
STEEL_LO = (0x22, 0x29, 0x34)
CYAN = (0x78, 0xDC, 0xFF)


# ---------------------------------------------------------------- PNG 编码
def write_png(path, w, h, buf):
    """buf: bytearray(w*h*4) RGBA，行主序。写成合法的 8-bit RGBA PNG。"""
    raw = bytearray()
    stride = w * 4
    for y in range(h):
        raw.append(0)  # filter type 0 (None)
        raw += buf[y * stride:(y + 1) * stride]
    comp = zlib.compress(bytes(raw), 9)

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        c += struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        return c

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", ihdr)
           + chunk(b"IDAT", comp)
           + chunk(b"IEND", b""))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(png)
    return len(png)


# ---------------------------------------------------------------- 光栅原语
def clamp(v, lo, hi):
    return lo if v < lo else (hi if v > hi else v)


def lerp(a, b, t):
    return a + (b - a) * t


def _rounded_cov(cx, cy, x, y, w, h, r):
    """点 (cx,cy) 落在圆角矩形 (x,y,w,h,r) 内吗（浮点几何，供超采样）。"""
    qx, qy = cx - x, cy - y
    if qx < 0 or qx > w or qy < 0 or qy > h:
        return False
    rx, ry = min(qx, w - qx), min(qy, h - qy)
    if rx < r and ry < r:
        dx, dy = r - rx, r - ry
        return dx * dx + dy * dy <= r * r
    return True


def paint_rect(buf, W, H, x, y, w, h, r, colors, alpha=1.0, ss=3, diag=False, vgrad=False):
    """画一枚圆角矩形。colors=[c0,c1] 时按对角线(diag)或竖直(vgrad)插值着色。
    每个像素取 ss×ss 个次采样点估计覆盖率，得到抗锯齿边缘。"""
    if alpha <= 0:
        return
    c0, c1 = colors[0], colors[1] if len(colors) > 1 else colors[0]
    x0 = max(0, int(x // 1)); x1 = min(W, int((x + w) // 1) + 2)
    y0 = max(0, int(y // 1)); y1 = min(H, int((y + h) // 1) + 2)
    inv = 1.0 / ss
    diag_len = (w + h) or 1.0
    for py in range(y0, y1):
        row = py * W * 4
        for px in range(x0, x1):
            cov = 0
            for sy in range(ss):
                fcy = py + (sy + 0.5) * inv
                for sx in range(ss):
                    if _rounded_cov(px + (sx + 0.5) * inv, fcy, x, y, w, h, r):
                        cov += 1
            if cov == 0:
                continue
            t = 0.0
            if diag:
                t = clamp(((px - x) + (py - y)) / diag_len, 0.0, 1.0)
            elif vgrad:
                t = clamp((py - y) / (h or 1.0), 0.0, 1.0)
            rc = (lerp(c0[0], c1[0], t), lerp(c0[1], c1[1], t), lerp(c0[2], c1[2], t))
            a = alpha * (cov / (ss * ss))
            i = row + px * 4
            inv_a = 1.0 - a
            buf[i] = int(rc[0] * a + buf[i] * inv_a + 0.5)
            buf[i + 1] = int(rc[1] * a + buf[i + 1] * inv_a + 0.5)
            buf[i + 2] = int(rc[2] * a + buf[i + 2] * inv_a + 0.5)
            buf[i + 3] = int(clamp(a * 255 + buf[i + 3] * inv_a, 0, 255))


# ---------------------------------------------------------------- 母题
def render_icon(S, full_bleed=False):
    """在 S×S 上画出 SLIDE15 母题。返回 RGBA buffer + W + H。"""
    buf = bytearray(S * S * 4)
    r_bg = 0.0 if full_bleed else S * 0.225
    # 背景（逐行竖直渐变，圆角用整块近似；full_bleed 铺满）
    for py in range(S):
        t = py / max(1, S - 1)
        c = (int(lerp(BG_TOP[0], BG_BOT[0], t)),
             int(lerp(BG_TOP[1], BG_BOT[1], t)),
             int(lerp(BG_TOP[2], BG_BOT[2], t)))
        if full_bleed:
            paint_rect(buf, S, S, 0, py, S, 1, 0, [c], alpha=1.0, ss=1)
        else:
            _paint_row_rounded(buf, S, py, c, r_bg)
    if full_bleed:
        # maskable：内容缩到中心 ~78% 安全区
        m = S * 0.16
    else:
        m = S * 0.15
    grid_w = S - 2 * m
    n = 3
    gap = grid_w * 0.06
    cell = (grid_w - gap * (n - 1)) / n
    # 布局：一个 3x3，右下角留洞（空格），贴着洞的几块=黄铜(可滑)，其余=钢灰，其中一块染青(已归位)
    # 盘面（值 -> 目标格）：这里纯装饰，摆一个接近“只差几步”的态。
    layout = [
        (0, 0, "home"), (1, 0, "brass"), (2, 0, "brass"),
        (0, 1, "steel"), (1, 1, "home"), (2, 1, "brass"),
        (0, 2, "steel"), (1, 2, "brass"), (2, 2, "hole"),
    ]
    for cx, cy, kind in layout:
        x = m + cx * (cell + gap)
        y = m + cy * (cell + gap)
        if kind == "hole":
            # 洞：画一圈很淡的插座轮廓
            paint_rect(buf, S, S, x, y, cell, cell, cell * 0.16, [(230, 236, 244)], alpha=0.05, ss=3)
            _stroke_round(buf, S, S, x + cell * 0.08, y + cell * 0.08, cell * 0.84, cell * 0.84,
                          cell * 0.16, CYAN, 0.28, lw=max(1.0, cell * 0.045))
            continue
        if kind == "steel":
            cols = (STEEL, STEEL_LO)
        else:  # brass / home 都走金属块，home 顶上加一抹青
            cols = (BRASS_HI, BRASS_LO)
        paint_rect(buf, S, S, x, y, cell, cell, cell * 0.22, [cols[0], cols[1]], alpha=1.0, ss=3, diag=True)
        # 顶部高光条（镜面）
        paint_rect(buf, S, S, x + cell * 0.14, y + cell * 0.07, cell * 0.72, cell * 0.06, cell * 0.03,
                   [(255, 248, 232)], alpha=0.5 if kind == "brass" else 0.22, ss=2)
        if kind == "home":
            paint_rect(buf, S, S, x, y, cell, cell, cell * 0.22, [CYAN], alpha=0.16, ss=3, diag=True)
    return buf, S, S


def _paint_row_rounded(buf, S, py, c, r):
    """第 py 行只在该行落入圆角矩形 [0,0,S,S] 的横向区间内才上色，实现圆角轮廓。"""
    # 圆角矩形内、行 py 的可见 x 区间
    cy = py + 0.5
    if cy < r:
        dy = r - cy
    elif cy > S - r:
        dy = cy - (S - r)
    else:
        dy = 0.0
    if dy > r:
        return
    inset = r - (r * r - dy * dy) ** 0.5 if dy > 0 else 0.0
    x0 = int(inset)
    x1 = int(S - inset)
    for px in range(max(0, x0), min(S, x1)):
        i = (py * S + px) * 4
        buf[i], buf[i + 1], buf[i + 2], buf[i + 3] = c[0], c[1], c[2], 255


def _stroke_round(buf, W, H, x, y, w, h, r, color, alpha, lw):
    """给圆角矩形描一条边（近似：只画顶/底/左/右四条细带，不填内部）。"""
    paint_rect(buf, W, H, x, y, w, lw, lw * 0.5, [color], alpha=alpha, ss=3)
    paint_rect(buf, W, H, x, y + h - lw, w, lw, lw * 0.5, [color], alpha=alpha, ss=3)
    paint_rect(buf, W, H, x, y, lw, h, lw * 0.5, [color], alpha=alpha, ss=3)
    paint_rect(buf, W, H, x + w - lw, y, lw, h, lw * 0.5, [color], alpha=alpha, ss=3)


def downsample(buf, W, H, ow, oh, nw, nh):
    """面积平均降采样，返回新 buffer。"""
    out = bytearray(nw * nh * 4)
    sx = ow / nw
    sy = oh / nh
    for y in range(nh):
        y0 = int(y * sy); y1 = min(oh, int((y + 1) * sy) + 1)
        for x in range(nw):
            x0 = int(x * sx); x1 = min(ow, int((x + 1) * sx) + 1)
            rs = gs = bs = al = cnt = 0
            for yy in range(y0, y1):
                base = yy * ow * 4
                for xx in range(x0, x1):
                    i = base + xx * 4
                    a = buf[i + 3]
                    rs += buf[i] * a; gs += buf[i + 1] * a; bs += buf[i + 2] * a; al += a; cnt += 1
            o = (y * nw + x) * 4
            if al == 0:
                out[o:o + 4] = bytes(4)
            else:
                out[o] = int(rs / al); out[o + 1] = int(gs / al); out[o + 2] = int(bs / al)
                out[o + 3] = int(al / cnt)
    return out


def render_og(W=1200, H=630):
    """社交卡：左侧母题徽章，右侧大字 SLIDE15（用块状笔画拼，避免字体依赖）。"""
    buf = bytearray(W * H * 4)
    for py in range(H):
        t = py / max(1, H - 1)
        c = (int(lerp(BG_TOP[0], BG_BOT[0], t)),
             int(lerp(BG_TOP[1], BG_BOT[1], t)),
             int(lerp(BG_TOP[2], BG_BOT[2], t)))
        paint_rect(buf, W, H, 0, py, W, 1, 0, [c], alpha=1.0, ss=1)
    # 顶部/底部一条黄铜细线
    paint_rect(buf, W, H, 0, 0, W, 6, 0, [BRASS], alpha=0.9, ss=1)
    paint_rect(buf, W, H, 0, H - 6, W, 6, 0, [BRASS], alpha=0.9, ss=1)
    # 徽章（左）：把 3x3 母题放大画在 x=64 起
    badge = 430
    bx, by = 96, (H - badge) // 2
    _draw_motif_at(buf, W, H, bx, by, badge)
    # 右侧标题：SLIDE 15 —— 用分段横竖条拼出可读的几何字，青色强调“15”
    _draw_blocks_text(buf, W, H, bx + badge + 96, by + 40, "SLIDE15", BRASS)
    _draw_blocks_text(buf, W, H, bx + badge + 96, by + 210, "15", CYAN, scale=1.4)
    return buf, W, H


def _draw_motif_at(buf, W, H, ox, oy, size):
    sub, sw, sh = render_icon(size)
    for y in range(sh):
        for x in range(sw):
            i = (y * sw + x) * 4
            a = sub[i + 3]
            if a == 0:
                continue
            tx, ty = ox + x, oy + y
            if not (0 <= tx < W and 0 <= ty < H):
                continue
            j = (ty * W + tx) * 4
            af = a / 255.0
            inv = 1 - af
            buf[j] = int(sub[i] * af + buf[j] * inv)
            buf[j + 1] = int(sub[i + 1] * af + buf[j + 1] * inv)
            buf[j + 2] = int(sub[i + 2] * af + buf[j + 2] * inv)
            buf[j + 3] = int(clamp(a + buf[j + 3] * inv, 0, 255))


# 5x7 段码式点阵字（够用：字母/数字各画一个可辨认的块状字形，不引外部字体）
GLYPHS = {
    "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    "I": ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
    "D": ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
    "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
    "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
    " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
}


def _draw_blocks_text(buf, W, H, ox, oy, text, color, scale=1.0):
    cell = int(14 * scale)
    pen = ox
    for ch in text:
        g = GLYPHS.get(ch)
        if g:
            for gy in range(7):
                for gx in range(5):
                    if g[gy][gx] == "1":
                        paint_rect(buf, W, H, pen + gx * cell, oy + gy * cell, cell - 1, cell - 1,
                                   0, [color], alpha=1.0, ss=1)
        pen += int(6 * cell)
    return pen


def render_texture(T=64):
    """可平铺的暗色托盘纹理：细密斜纹 + 角落微暗，边缘对齐保证无缝。返回 buffer。"""
    buf = bytearray(T * T * 4)
    for py in range(T):
        for px in range(T):
            i = (py * T + px) * 4
            # 基础暗色（竖直轻微渐变）
            t = py / (T - 1)
            r = int(lerp(0x1A, 0x12, t)); g = int(lerp(0x1D, 0x15, t)); b = int(lerp(0x24, 0x1B, t))
            # 斜纹：以 (px+py) mod 8 做亮/暗交替，周期小、可平铺
            hatch = ((px + py) % 8)
            v = 6 if hatch in (0, 1) else (-4 if hatch in (4, 5) else 0)
            buf[i] = clamp(r + v, 0, 255)
            buf[i + 1] = clamp(g + v, 0, 255)
            buf[i + 2] = clamp(b + v, 0, 255)
            buf[i + 3] = 255
    return buf, T, T


def main():
    os.makedirs(ICONS, exist_ok=True)
    os.makedirs(TEX, exist_ok=True)
    master, ms, _ = render_icon(512)
    report = []

    def emit(name, buf, w, h):
        n = write_png(os.path.join(ICONS, name), w, h, buf)
        report.append((name, w, h, n))

    emit("icon-512.png", master, 512, 512)
    mb, mw, mh = render_icon(512, full_bleed=True)
    emit("icon-maskable-512.png", mb, mw, mh)
    for size, name in [(192, "icon-192.png"), (180, "apple-touch-icon.png"),
                       (96, "icon-96.png"), (64, "icon-64.png"), (48, "icon-48.png"),
                       (32, "favicon-32.png"), (16, "favicon-16.png")]:
        db = downsample(master, 512, 512, 512, 512, size, size)
        emit(name, db, size, size)
    ob, ow, oh = render_og()
    emit("og-card.png", ob, ow, oh)

    tb, tw, th = render_texture(64)
    n = write_png(os.path.join(TEX, "tray-64.png"), tw, th, tb)
    report.append(("texture/tray-64.png", tw, th, n))

    for name, w, h, size in report:
        print(f"{name:28s} {w:>5}x{h:<5} {size:>8d} B")
    print(f"\n{len(report)} 张写入 {ICONS} 与 {TEX}")


if __name__ == "__main__":
    main()
