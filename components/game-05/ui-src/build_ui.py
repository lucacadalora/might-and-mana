#!/usr/bin/env python3
"""Game 05 UI pixel art, drawn procedurally at 1x (original design, not from any existing game).

Writes public/games/game-05/ui/*.png plus icons.json (fallback icon sheet index) and a zoomed
preview to the path given by --preview. Run from the repo root:

    python3 components/game-05/ui-src/build_ui.py [--preview /tmp/ui-preview.png]

Frames are 9-slice sources for CSS border-image; icons are 16x16 cells in icons.png. The HUD reads
atlas icons first (public/games/game-05/art/atlas.json) and falls back to this sheet.
"""
import json
import math
import os
import random
import sys

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
OUT = os.path.join(ROOT, "public", "games", "game-05", "ui")


def hexc(value, alpha=255):
    value = value.lstrip("#")
    return (int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16), alpha)


# ─── Palette ─────────────────────────────────────────────────────────────────────────────────────
K = hexc("1a110b")          # ink outline
K2 = hexc("2a1a10")
CLEAR = (0, 0, 0, 0)
GOLD = [hexc("fff4c2"), hexc("f7d170"), hexc("e0a23c"), hexc("a8641f"), hexc("5e3212")]
PAPER = [hexc("fcf3da"), hexc("f2e2b8"), hexc("e2c996"), hexc("c19f68"), hexc("8e6b3e")]
WOOD = [hexc("5a3a22"), hexc("3f2818"), hexc("2c1c11"), hexc("1e130b")]
RUBY = [hexc("ffb09a"), hexc("ef5a3f"), hexc("b8261b"), hexc("6e1510")]
SAPPH = [hexc("b8dcff"), hexc("5d9cf0"), hexc("2f5fc0"), hexc("1a2f6e")]
EMER = [hexc("c8f5a8"), hexc("6fcf5a"), hexc("2f9447"), hexc("16502a")]
STEEL = [hexc("ffffff"), hexc("d6dde6"), hexc("98a4b3"), hexc("5d6878")]
IRON = [hexc("a7adb8"), hexc("6f7682"), hexc("474c56"), hexc("25282f")]
SILVER = [hexc("ffffff"), hexc("e3e8ef"), hexc("aab4c2"), hexc("6b7587")]
LEATHER = [hexc("e0a66a"), hexc("b87840"), hexc("8a5328"), hexc("54311a")]
CLOTH = [hexc("f1e6cf"), hexc("cdbd9c"), hexc("9e8e70"), hexc("675b46")]
BOAR = [hexc("b58a64"), hexc("86603f"), hexc("5c3f28"), hexc("382517")]
BRONZE = [hexc("ffd79a"), hexc("e39b4a"), hexc("b0652a"), hexc("6e3a17")]
EMBER = [hexc("fff0a0"), hexc("ffb13b"), hexc("e0501e"), hexc("8e2210")]
FROST = [hexc("ffffff"), hexc("bfefff"), hexc("62c2f0"), hexc("24649e")]
THORN = [hexc("d8f08a"), hexc("8cbf3f"), hexc("4f7f24"), hexc("2a4414")]
LEAF = [hexc("d4f59a"), hexc("7fcf4a"), hexc("3f9a32"), hexc("1f5a22")]
BREAD = [hexc("ffe0a0"), hexc("e8a95a"), hexc("b8732f"), hexc("7a4418")]
ROOT_C = [hexc("f0d2a8"), hexc("cf9e6c"), hexc("9c6a40"), hexc("613d22")]
BONE = [hexc("ffffff"), hexc("f1ead8"), hexc("c9bd9e"), hexc("8a7d62")]
GLASS = [hexc("ffffff", 235), hexc("e4f2f7", 200), hexc("b6d0da", 190), hexc("7a98a6", 220)]
CORK = [hexc("e3b680"), hexc("b8834c"), hexc("86552a"), hexc("56341a")]
STONE = [hexc("e6e6de"), hexc("a9aaa2"), hexc("75776f"), hexc("45473f")]
PAPER_ICON = [hexc("fffaea"), hexc("f1e2b6"), hexc("d4b77c"), hexc("9c7b47")]
WHITE_UI = [hexc("ffffff"), hexc("fff6dc"), hexc("f0d9a6"), hexc("b99a62")]


# ─── Raster helpers ──────────────────────────────────────────────────────────────────────────────
class Canvas:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.px = [[CLEAR] * w for _ in range(h)]

    def set(self, x, y, c):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.px[y][x] = c

    def get(self, x, y):
        return self.px[y][x] if 0 <= x < self.w and 0 <= y < self.h else CLEAR

    def image(self):
        img = Image.new("RGBA", (self.w, self.h))
        img.putdata([c for row in self.px for c in row])
        return img

    def paste(self, other, ox, oy):
        for y in range(other.h):
            for x in range(other.w):
                c = other.px[y][x]
                if c[3]:
                    self.set(ox + x, oy + y, c)


def disc(cx, cy, r):
    return {(x, y) for y in range(int(cy - r - 2), int(cy + r + 3)) for x in range(int(cx - r - 2), int(cx + r + 3))
            if (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r}


def ellipse(cx, cy, rx, ry, angle=0.0):
    ca, sa = math.cos(math.radians(angle)), math.sin(math.radians(angle))
    out = set()
    for y in range(int(cy - max(rx, ry) - 2), int(cy + max(rx, ry) + 3)):
        for x in range(int(cx - max(rx, ry) - 2), int(cx + max(rx, ry) + 3)):
            dx, dy = x + 0.5 - cx, y + 0.5 - cy
            u, v = dx * ca + dy * sa, -dx * sa + dy * ca
            if (u / rx) ** 2 + (v / ry) ** 2 <= 1:
                out.add((x, y))
    return out


def rect(x0, y0, x1, y1):
    return {(x, y) for y in range(y0, y1 + 1) for x in range(x0, x1 + 1)}


def line(x0, y0, x1, y1, width=1):
    out = set()
    steps = int(max(abs(x1 - x0), abs(y1 - y0)) * 2) + 1
    for i in range(steps + 1):
        t = i / steps
        x, y = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
        for ox in range(width):
            out.add((int(round(x)) + ox, int(round(y))))
    return out


def polygon(points):
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    out = set()
    for y in range(int(min(ys)) - 1, int(max(ys)) + 2):
        for x in range(int(min(xs)) - 1, int(max(xs)) + 2):
            px, py = x + 0.5, y + 0.5
            inside = False
            j = len(points) - 1
            for i in range(len(points)):
                xi, yi = points[i]
                xj, yj = points[j]
                if (yi > py) != (yj > py) and px < (xj - xi) * (py - yi) / (yj - yi + 1e-9) + xi:
                    inside = not inside
                j = i
            if inside:
                out.add((x, y))
    return out


N4 = [(1, 0), (-1, 0), (0, 1), (0, -1)]
N8 = N4 + [(1, 1), (1, -1), (-1, 1), (-1, -1)]


def shade(cv, mask, ramp, light=(-1, -1)):
    """Directional shading: lit edge facing the light, shadow on the far side, mid band inside."""
    lx, ly = light
    for (x, y) in mask:
        if (x + lx, y + ly) not in mask or (x + lx, y) not in mask and (x, y + ly) not in mask:
            c = ramp[0]
        elif (x - lx, y - ly) not in mask or (x - lx, y) not in mask or (x, y - ly) not in mask:
            c = ramp[3] if len(ramp) > 3 else ramp[-1]
        elif (x - 2 * lx, y - 2 * ly) not in mask:
            c = ramp[2]
        else:
            c = ramp[1]
        cv.set(x, y, c)


def outline(cv, mask, color=K, diagonal=False):
    for (x, y) in mask:
        for dx, dy in (N8 if diagonal else N4):
            p = (x + dx, y + dy)
            if p not in mask and 0 <= p[0] < cv.w and 0 <= p[1] < cv.h and cv.get(*p)[3] == 0:
                cv.set(p[0], p[1], color)


def draw(cv, mask, ramp, light=(-1, -1), line_color=K, diagonal=False):
    shade(cv, mask, ramp, light)
    outline(cv, mask, line_color, diagonal)


def paint(cv, mask, color):
    for (x, y) in mask:
        cv.set(x, y, color)


# ─── Frames (9-slice sources) ────────────────────────────────────────────────────────────────────
def ring_frame(size, rings, fill, notch=1):
    cv = Canvas(size, size)
    for y in range(size):
        for x in range(size):
            d = min(x, y, size - 1 - x, size - 1 - y)
            if d < len(rings):
                tl, br = rings[d]
                top_left = (y == d and x < size - 1 - d) or (x == d and y < size - 1 - d)
                cv.set(x, y, tl if top_left else br)
            else:
                cv.set(x, y, fill)
    for n in range(notch):
        for (x, y) in [(n, 0), (0, n), (size - 1 - n, 0), (size - 1, n), (n, size - 1), (0, size - 1 - n),
                       (size - 1 - n, size - 1), (size - 1, size - 1 - n)]:
            cv.set(x, y, CLEAR)
    return cv


def corner_plate(size, gem_ramp):
    cv = Canvas(size, size)
    c = size // 2
    cut = max(2, size // 3)
    mask = {(x, y) for y in range(1, size - 1) for x in range(1, size - 1)
            if x + y >= cut and (size - 1 - x) + y >= cut and x + (size - 1 - y) >= cut and (size - 1 - x) + (size - 1 - y) >= cut}
    draw(cv, mask, GOLD[:4])
    gem = {(c - 1, c), (c, c - 1), (c, c), (c + 1, c), (c, c + 1)} if size >= 9 else {(c, c)}
    for (x, y) in gem:
        cv.set(x, y, gem_ramp[1])
    if size >= 9:
        cv.set(c - 1, c, gem_ramp[0]); cv.set(c, c - 1, gem_ramp[0])
        cv.set(c + 1, c, gem_ramp[2]); cv.set(c, c + 1, gem_ramp[3])
        cv.set(c, c, gem_ramp[1])
    return cv


def stamp_corners(frame, plate):
    s, p = frame.w, plate.w
    for flipx in (False, True):
        for flipy in (False, True):
            for y in range(p):
                for x in range(p):
                    c = plate.px[y][x]
                    if not c[3]:
                        continue
                    tx = s - 1 - x if flipx else x
                    ty = s - 1 - y if flipy else y
                    # Mirror the light: keep highlights top-left on every corner.
                    frame.set(tx, ty, c)
    return frame


def build_frames():
    frames = {}
    paper = ring_frame(30, [(K, K), (GOLD[0], GOLD[2]), (GOLD[1], GOLD[3]), (GOLD[2], GOLD[3]), (K2, K2),
                            (PAPER[3], PAPER[0]), (PAPER[2], PAPER[1])], PAPER[1])
    frames["frame-paper"] = stamp_corners(paper, corner_plate(10, RUBY))
    dark = ring_frame(24, [(K, K), (GOLD[1], GOLD[3]), (GOLD[3], GOLD[4]), (K, K), (WOOD[0], WOOD[3])], WOOD[2])
    frames["frame-dark"] = stamp_corners(dark, corner_plate(8, RUBY))
    hud = ring_frame(12, [(K, K), (GOLD[1], GOLD[3]), (K, K), (hexc("3a2517", 235), hexc("120b06", 235))], hexc("22150d", 225))
    frames["frame-hud"] = hud
    frames["frame-slot"] = ring_frame(10, [(K, K), (hexc("0d0805"), hexc("7a5530")), (hexc("1a100a"), hexc("3a2616"))], hexc("2a1a10"))
    frames["frame-slot-light"] = ring_frame(10, [(PAPER[4], PAPER[4]), (PAPER[3], PAPER[0]), (PAPER[2], PAPER[1])], hexc("ead5a5"))
    sel = ring_frame(12, [(K, K), (GOLD[0], GOLD[1]), (GOLD[1], GOLD[2]), (GOLD[3], GOLD[3])], CLEAR)
    for (x, y) in [(1, 1), (10, 1), (1, 10), (10, 10)]:
        sel.set(x, y, hexc("ffffff"))
    frames["frame-select"] = sel
    frames["frame-bar"] = ring_frame(8, [(K, K), (hexc("0b0604"), hexc("4a3020"))], hexc("140b07"))
    frames["frame-tab"] = ring_frame(12, [(K, K), (WOOD[0], WOOD[3]), (WOOD[1], WOOD[2])], WOOD[2])
    frames["frame-tab-on"] = ring_frame(12, [(K, K), (GOLD[0], GOLD[3]), (GOLD[1], GOLD[2])], GOLD[1])
    frames["frame-btn"] = ring_frame(12, [(K, K), (GOLD[1], GOLD[3]), (WOOD[0], WOOD[3])], WOOD[1])
    frames["frame-btn-on"] = ring_frame(12, [(K, K), (GOLD[0], GOLD[2]), (GOLD[1], GOLD[3])], GOLD[2])
    frames["frame-plate"] = ring_frame(12, [(K, K), (GOLD[1], GOLD[3]), (GOLD[3], GOLD[4]), (K, K)], hexc("1c120b", 238))
    return frames


# ─── Ornaments, badges, cursors ──────────────────────────────────────────────────────────────────
def crest():
    cv = Canvas(34, 11)
    cx, cy = 16.5, 5.0
    wing = set()
    for x in range(1, 33):
        d = abs(x + 0.5 - cx)
        if d < 4:
            continue
        thick = 2 if d < 11 else 1
        y0 = 5 - (1 if d > 13 else 0)
        for t in range(thick):
            wing.add((x, y0 + t))
    for side in (-1, 1):  # curls
        bx = int(cx + side * 14.5)
        wing |= {(bx, 3), (bx + side, 3), (bx + side, 4)}
        wing |= {(int(cx + side * 9), 4), (int(cx + side * 9), 7), (int(cx + side * 10), 7)}
    draw(cv, wing, GOLD[:4])
    diamond = {(x, y) for y in range(11) for x in range(34) if abs(x + 0.5 - cx) + abs(y + 0.5 - 5.5) <= 5.2}
    draw(cv, diamond, GOLD[:4])
    gem = {(x, y) for y in range(11) for x in range(34) if abs(x + 0.5 - cx) + abs(y + 0.5 - 5.5) <= 2.6}
    shade(cv, gem, RUBY)
    return cv


def pointer():
    cv = Canvas(10, 11)
    mask = polygon([(9.4, 5.5), (1.0, 0.4), (2.4, 5.5), (1.0, 10.6)])
    draw(cv, mask, GOLD[:4], diagonal=False)
    cv.set(3, 5, GOLD[3]); cv.set(4, 5, GOLD[3])
    return cv


def advance():
    cv = Canvas(11, 8)
    mask = polygon([(0.8, 0.8), (10.2, 0.8), (5.5, 7.2)])
    draw(cv, mask, RUBY)
    return cv


def level_badge():
    cv = Canvas(24, 26)
    shield = polygon([(1, 1), (23, 1), (23, 13), (18, 21), (12, 25.5), (6, 21), (1, 13)])
    rim = set(shield)
    inner = polygon([(3.5, 3.5), (20.5, 3.5), (20.5, 12.5), (16.5, 19), (12, 22.5), (7.5, 19), (3.5, 12.5)])
    draw(cv, rim, GOLD[:4])
    shade(cv, inner, [hexc("5a7fd6"), hexc("2b4a9c"), hexc("223b80"), hexc("15244f")])
    for (x, y) in inner:
        if (x - 1, y) not in inner and (x, y - 1) not in inner:
            cv.set(x, y, hexc("7ea0ea"))
    return cv


PIXEL_FONT = {
    "M": ["X...X", "XX.XX", "X.X.X", "X...X", "X...X"],
    "S": [".XXX", "X...", ".XX.", "...X", "XXX."],
    "A": [".XX.", "X..X", "XXXX", "X..X", "X..X"],
    "B": ["XXX.", "X..X", "XXX.", "X..X", "XXX."],
    "X": ["X...X", ".X.X.", "..X..", ".X.X.", "X...X"],
    "Y": ["X...X", ".X.X.", "..X..", "..X..", "..X.."],
    "!": ["X", "X", "X", ".", "X"],
    "?": ["XXX.", "...X", ".XX.", "....", ".X.."],
}


def glyph(cv, ch, ox, oy, color):
    for y, row in enumerate(PIXEL_FONT[ch]):
        for x, v in enumerate(row):
            if v == "X":
                cv.set(ox + x, oy + y, color)


def badge_main():
    cv = Canvas(13, 13)
    mask = {(x, y) for y in range(1, 12) for x in range(1, 12) if not ((x in (1, 11)) and (y in (1, 11)))}
    rim = mask
    draw(cv, rim, GOLD[:4])
    inner = rect(2, 2, 10, 10)
    paint(cv, inner, RUBY[2])
    paint(cv, rect(2, 2, 10, 2) | rect(2, 2, 2, 10), RUBY[3])
    glyph(cv, "M", 4, 4, GOLD[0])
    return cv


def badge_side():
    cv = Canvas(13, 13)
    outer = disc(6.5, 6.5, 5.6)
    draw(cv, outer, GOLD[:4])
    inner = disc(6.5, 6.5, 3.8)
    shade(cv, inner, EMER)
    paint(cv, disc(6.5, 6.5, 3.8), EMER[2])
    glyph(cv, "S", 5, 4, hexc("fffbe0"))
    return cv


def pad_button(letter, ramp, ink=None):
    cv = Canvas(13, 13)
    body = disc(6.5, 6.5, 5.7)
    draw(cv, body, ramp)
    glyph(cv, letter, 4 if len(PIXEL_FONT[letter][0]) == 5 else 5, 4, ink or hexc("ffffff"))
    return cv


def arrow_sheet(frames=16, size=21):
    sheet = Canvas(size * frames, size)
    c = size / 2
    base = [(9.8, 0), (-7.6, -5.6), (-3.4, 0), (-7.6, 5.6)]
    for i in range(frames):
        a = i * 2 * math.pi / frames
        ca, sa = math.cos(a), math.sin(a)
        pts = [(c + x * ca - y * sa, c + x * sa + y * ca) for x, y in base]
        mask = polygon(pts)
        cv = Canvas(size, size)
        draw(cv, mask, GOLD[:4], diagonal=True)
        sheet.paste(cv, i * size, 0)
    return sheet


def touch_disc(size, on=False):
    cv = Canvas(size, size)
    c = size / 2
    r = size / 2 - 0.5
    body = disc(c, c, r - 1)
    rim_outer = disc(c, c, r - 1)
    rim_inner = disc(c, c, r - 3)
    for (x, y) in rim_outer - rim_inner:
        dx, dy = x + 0.5 - c, y + 0.5 - c
        t = (dx + dy) / (r * 1.414)
        cv.set(x, y, GOLD[0] if t < -0.55 else GOLD[1] if t < 0 else GOLD[2] if t < 0.55 else GOLD[3])
    for (x, y) in rim_inner:
        dx, dy = x + 0.5 - c, y + 0.5 - c
        dist = math.hypot(dx, dy) / (r - 3)
        base = (58, 36, 22) if on else (30, 19, 12)
        top = (120, 82, 44) if on else (64, 44, 28)
        k = max(0.0, min(1.0, (dy / (r - 3) + 1) / 2))
        col = tuple(int(top[i] * (1 - k) + base[i] * k) for i in range(3))
        alpha = 235 if on else 200
        if dist > 0.86:
            col = tuple(int(v * 0.7) for v in col)
        cv.set(x, y, col + (alpha,))
    # glossy arc at the top
    for (x, y) in rim_inner:
        dx, dy = x + 0.5 - c, y + 0.5 - c
        if -0.9 < dy / (r - 3) < -0.62 and abs(dx) < (r - 3) * 0.55:
            p = cv.get(x, y)
            cv.set(x, y, (min(255, p[0] + 40), min(255, p[1] + 34), min(255, p[2] + 24), p[3]))
    outline(cv, body, K, diagonal=True)
    return cv


def stick_base(size=60):
    cv = Canvas(size, size)
    c = size / 2
    outer, inner = disc(c, c, c - 1.5), disc(c, c, c - 3.5)
    for (x, y) in outer - inner:
        dx, dy = x + 0.5 - c, y + 0.5 - c
        t = (dx + dy) / (c * 1.414)
        cv.set(x, y, GOLD[1] if t < -0.3 else GOLD[2] if t < 0.4 else GOLD[3])
    for (x, y) in inner:
        cv.set(x, y, hexc("1c120b", 96))
    for a in range(0, 360, 90):  # direction ticks
        tx, ty = c + math.cos(math.radians(a)) * (c - 7), c + math.sin(math.radians(a)) * (c - 7)
        for (x, y) in disc(tx, ty, 1.3):
            cv.set(x, y, hexc("f7d170", 170))
    outline(cv, outer, K, diagonal=True)
    return cv


def tombstone():
    cv = Canvas(26, 30)
    stone = polygon([(4, 29), (4, 9), (6, 4), (9, 1.5), (13, 0.8), (17, 1.5), (20, 4), (22, 9), (22, 29)])
    draw(cv, stone, STONE)
    cross = rect(12, 7, 13, 17) | rect(9, 10, 16, 11)
    paint(cv, cross, STONE[3])
    grass = {(x, y) for x in range(1, 25) for y in range(26, 30) if (y >= 28 or (x * 7) % 5 < 2 and y >= 26 + (x % 2))}
    draw(cv, grass, LEAF)
    return cv


def crystal():
    cv = Canvas(22, 34)
    gem = polygon([(11, 0.5), (18.5, 9), (16, 27), (11, 33.5), (6, 27), (3.5, 9)])
    shade(cv, gem, [hexc("ffffff"), hexc("bff4ff"), hexc("56c8ee"), hexc("1e6aa0")])
    for y in range(3, 30):
        cv.set(11, y, hexc("e8fcff") if y < 18 else hexc("8fe0f7"))
    outline(cv, gem, hexc("0f2d4a"), diagonal=True)
    return cv


# ─── Icons (16x16) ───────────────────────────────────────────────────────────────────────────────
def icon_flask(liquid, cork=CORK, glass_top=True):
    cv = Canvas(16, 16)
    body = disc(7.5, 10.3, 5.1)
    neck = rect(6, 3, 9, 6)
    lip = rect(5, 3, 10, 3)
    stopper = rect(6, 1, 9, 2)
    whole = body | neck | lip | stopper
    shade(cv, {p for p in body if p[1] >= 8}, liquid)
    shade(cv, {p for p in body if p[1] < 8} | neck | lip, GLASS)
    shade(cv, stopper, cork)
    cv.set(5, 9, hexc("ffffff")); cv.set(4, 10, hexc("ffffff")); cv.set(5, 10, liquid[0])
    cv.set(7, 5, hexc("ffffff"))
    outline(cv, whole, K)
    return cv


def icon_herb():
    cv = Canvas(16, 16)
    stem = line(8, 15, 8, 5) | line(8, 11, 11, 8) | line(8, 9, 5, 6)
    leaves = ellipse(4.5, 5.5, 3.4, 1.9, -40) | ellipse(11.5, 7.5, 3.4, 1.9, 40) | ellipse(8.5, 3.0, 1.7, 2.8, 8) | ellipse(5.5, 10.5, 2.8, 1.6, -25)
    draw(cv, leaves | stem, LEAF)
    for (x, y) in stem:
        if (x, y) not in leaves:
            cv.set(x, y, LEAF[3])
    return cv


def icon_root():
    cv = Canvas(16, 16)
    body = disc(8, 9, 3.4) | disc(6, 12, 2.6) | disc(10.5, 6.5, 2.2) | disc(4.5, 14, 1.5)
    tail = line(3, 15, 1, 15) | line(11, 12, 13, 14)
    draw(cv, body | tail, ROOT_C)
    sprout = line(11, 5, 12, 2) | line(12, 3, 14, 2) | line(11, 4, 9, 2)
    draw(cv, sprout, [hexc("ffb0a0"), hexc("e0503a"), hexc("a02a1e"), hexc("5e140e")])
    for (x, y) in [(7, 8), (9, 10), (6, 11)]:
        cv.set(x, y, ROOT_C[3])
    return cv


def icon_key():
    cv = Canvas(16, 16)
    bow = disc(4.5, 4.5, 3.6) - disc(4.5, 4.5, 1.5)
    shaft = line(6, 6, 13, 13, 2)
    bits = rect(10, 13, 11, 14) | rect(12, 11, 13, 12)
    draw(cv, bow | shaft | bits, IRON)
    return cv


def icon_ring():
    cv = Canvas(16, 16)
    band = disc(8, 9.5, 5.2) - disc(8, 9.5, 3.0)
    draw(cv, band, SILVER)
    gem = disc(8, 4.2, 2.2)
    draw(cv, gem, SAPPH)
    cv.set(7, 3, hexc("ffffff"))
    return cv


def icon_rod():
    cv = Canvas(16, 16)
    rod = line(3, 13, 14, 2)
    grip = line(1, 15, 4, 12, 2)
    draw(cv, rod | grip, CORK)
    paint(cv, rod - grip, hexc("8a5a2a"))
    for y in range(3, 10):
        cv.set(14, y, hexc("e8f2f8"))
    cv.set(13, 10, hexc("c0c8d0")); cv.set(13, 9, hexc("c0c8d0"))
    reel = disc(5.5, 11.5, 1.4)
    draw(cv, reel, SILVER)
    return cv


def icon_loaf():
    cv = Canvas(16, 16)
    loaf = ellipse(8, 9.5, 6.8, 4.2)
    draw(cv, loaf, BREAD)
    for sx in (4, 7, 10):
        cv.set(sx, 8, BREAD[3]); cv.set(sx + 1, 7, BREAD[3]); cv.set(sx + 2, 6, BREAD[2])
    return cv


def coin_at(cv, cx, cy, r):
    body = disc(cx, cy, r)
    for (x, y) in body:
        dx, dy = x + 0.5 - cx, y + 0.5 - cy
        d = math.hypot(dx, dy)
        lit = (dx + dy) / max(0.01, d) if d else 0
        if d > r - 1.35:  # raised rim
            col = GOLD[0] if lit < -0.5 else GOLD[1] if lit < 0.3 else GOLD[3]
        elif d > r - 2.3:  # inset edge: dark top-left, light bottom-right
            col = GOLD[3] if lit < -0.2 else GOLD[1]
        else:
            col = GOLD[2]
        cv.set(x, y, col)
    outline(cv, body, K)
    return body


def icon_coin():
    cv = Canvas(16, 16)
    coin_at(cv, 10.0, 6.0, 4.6)
    front = coin_at(cv, 6.5, 9.5, 5.6)
    for (x, y) in [(6, 8), (6, 9), (6, 10), (5, 9), (7, 9)]:
        cv.set(x, y, GOLD[1])
    cv.set(6, 9, GOLD[0])
    cv.set(4, 6, hexc("ffffff"))
    return cv


def icon_cap(ramp, style):
    cv = Canvas(16, 16)
    if style == "hood":
        hood = polygon([(8, 0.6), (12.5, 3.5), (14.2, 9), (13.6, 15.4), (2.4, 15.4), (1.8, 9), (3.5, 3.5)])
        draw(cv, hood, ramp)
        opening = ellipse(8, 10.6, 3.4, 4.2)
        for (x, y) in opening:
            cv.set(x, y, hexc("3a2616") if y > 8 else hexc("24170d"))
        paint(cv, {(x, y) for (x, y) in opening if (x, y - 1) not in opening}, ramp[3])
        return cv
    dome = {p for p in ellipse(8, 10.5, 5.6, 7.6) if p[1] <= 9}
    band = rect(2, 9, 13, 10)
    brim = rect(1, 11, 14, 12) - {(1, 12), (14, 12)} if style != "helm" else set()
    if style == "helm":
        dome = {p for p in ellipse(8, 11, 6.0, 8.6) if p[1] <= 12}
        band = rect(2, 10, 13, 11)
        guard = rect(7, 11, 8, 15)
        cheeks = rect(2, 11, 4, 14) | rect(11, 11, 13, 14)
        draw(cv, dome | band | guard | cheeks, ramp)
        paint(cv, band, ramp[2])
        paint(cv, rect(7, 1, 8, 9), ramp[0])
        for x in (3, 6, 9, 12):
            cv.set(x, 10, ramp[0])
        return cv
    draw(cv, dome | band | brim, ramp)
    paint(cv, band, ramp[2])
    paint(cv, rect(2, 11, 13, 11), ramp[1])
    if style == "leather":
        for x in range(3, 13, 2):
            cv.set(x, 9, ramp[0])
    if style == "boar":
        for x, h in [(4, 2), (6, 3), (8, 3), (10, 3), (12, 2)]:
            for i in range(h):
                y = 3 + abs(x - 8) // 2 - i
                cv.set(x, y, BONE[1] if i else BONE[2])
        for (x, y) in [(3, 9), (12, 9)]:
            cv.set(x, y, BONE[0])
    return cv


def icon_body(ramp, style):
    cv = Canvas(16, 16)
    torso = rect(4, 3, 11, 14)
    shoulders = rect(2, 3, 13, 6)
    sleeves = rect(1, 4, 3, 9) | rect(12, 4, 14, 9) if style in ("cloth", "mail") else set()
    shape = torso | shoulders | sleeves
    neck = {(7, 3), (8, 3), (7, 4), (8, 4), (6, 3), (9, 3)}
    shape -= neck
    draw(cv, shape, ramp)
    if style == "leather":
        for y in range(6, 14, 2):
            cv.set(7, y, ramp[3]); cv.set(8, y, ramp[0])
    if style == "boar":
        for (x, y) in [(3, 3), (5, 2), (10, 2), (12, 3)]:
            cv.set(x, y, BONE[1])
        paint(cv, rect(4, 9, 11, 9), ramp[3])
    if style == "mail":
        for y in range(5, 14, 2):
            for x in range(5 + (y // 2) % 2, 11, 2):
                cv.set(x, y, ramp[3])
    if style == "cloth":
        paint(cv, rect(4, 10, 11, 10), hexc("8a3a2a"))
    return cv


def icon_boot(ramp, style):
    cv = Canvas(16, 16)
    shaft = rect(4, 2, 9, 10)
    foot = rect(4, 10, 13, 13) - {(13, 10)}
    shape = shaft | foot
    draw(cv, shape, ramp)
    paint(cv, rect(4, 13, 13, 13), ramp[3])
    paint(cv, rect(4, 3, 9, 3), ramp[0])
    if style == "boar":
        for y in (5, 7):
            cv.set(9, y, BONE[1])
    if style == "bronze":
        paint(cv, rect(5, 5, 8, 8), BRONZE[1])
        cv.set(5, 5, BRONZE[0])
    return cv


def icon_sword(blade, guard=GOLD, grip=CORK, notch=False, glow=False):
    cv = Canvas(16, 16)
    blade_mask = line(5, 10, 13, 2, 2) | {(14, 1)}
    guard_mask = line(2, 8, 7, 13)
    grip_mask = line(2, 13, 4, 11)
    pommel = {(1, 14), (2, 14), (1, 15)}
    shade(cv, blade_mask, blade)
    for i in range(5, 14):  # bright edge
        cv.set(i + 1, 15 - i - 1 + 0, blade[0]) if False else None
    shade(cv, guard_mask, guard[:4])
    shade(cv, grip_mask, grip)
    shade(cv, pommel, guard[:4])
    if notch:
        cv.set(9, 6, CLEAR)
    outline(cv, blade_mask | guard_mask | grip_mask | pommel, K)
    if glow:
        for (x, y) in [(9, 3), (12, 6), (6, 7), (14, 4)]:
            if cv.get(x, y)[3] == 0:
                cv.set(x, y, EMBER[1])
    return cv


def icon_knot():
    cv = Canvas(16, 16)
    reed = [hexc("e8f0b0"), hexc("b5c865"), hexc("7a9038"), hexc("46561c")]
    loop = disc(8, 6.5, 5.4) - disc(8, 6.5, 3.2)
    tails = line(7, 11, 4, 15, 2) | line(8, 11, 11, 15, 2)
    knot = rect(6, 10, 9, 12)
    draw(cv, loop | tails | knot, reed)
    paint(cv, knot, reed[2])
    bead = disc(8, 1.9, 1.4)
    draw(cv, bead, SAPPH)
    return cv


def icon_fang():
    cv = Canvas(16, 16)
    cord = {(x, int(round(3 + 0.12 * (x - 8) ** 2))) for x in range(1, 16)}
    paint(cv, cord, hexc("7a4a2a"))
    tooth = polygon([(5.5, 5), (10.5, 5), (9.5, 10), (7.5, 15), (6.5, 10)])
    draw(cv, tooth, BONE)
    return cv


def icon_bell():
    cv = Canvas(16, 16)
    bell = polygon([(4, 12.5), (5, 6), (7, 3), (9, 3), (11, 6), (12, 12.5)]) | rect(2, 12, 13, 13)
    draw(cv, bell, BRONZE)
    hook = {(7, 1), (8, 1), (7, 2), (8, 2)}
    draw(cv, hook, BRONZE)
    clap = disc(8, 14.6, 1.2)
    draw(cv, clap, IRON)
    return cv


def icon_fireball():
    cv = Canvas(16, 16)
    core = disc(9.5, 6.5, 3.8)
    tail = polygon([(7, 4), (2, 13.5), (4, 14), (12, 9)])
    whole = core | tail
    for (x, y) in whole:
        d = math.hypot(x + 0.5 - 9.5, y + 0.5 - 6.5)
        cv.set(x, y, EMBER[0] if d < 1.8 else EMBER[1] if d < 3.2 else EMBER[2] if d < 5.5 else EMBER[3])
    outline(cv, whole, hexc("4a1206"))
    return cv


def icon_frost():
    cv = Canvas(16, 16)
    ring = disc(8, 8, 6.2) - disc(8, 8, 3.8)
    draw(cv, ring, FROST, line_color=hexc("12304e"))
    for (x, y) in [(8, 0), (8, 15), (0, 8), (15, 8)]:
        cv.set(x, y, FROST[0])
    for (x, y) in [(3, 3), (12, 3), (3, 12), (12, 12)]:
        cv.set(x, y, FROST[1])
    return cv


def icon_thorns():
    cv = Canvas(16, 16)
    spikes = polygon([(6.5, 15), (9.5, 15), (8, 1)]) | polygon([(4, 15), (6.5, 14), (1.5, 4)]) | polygon([(9.5, 14), (12, 15), (14.5, 4)])
    draw(cv, spikes, THORN)
    return cv


def icon_star(ramp=WHITE_UI):
    cv = Canvas(16, 16)
    star = polygon([(8, 0.5), (9.6, 6.4), (15.5, 8), (9.6, 9.6), (8, 15.5), (6.4, 9.6), (0.5, 8), (6.4, 6.4)])
    draw(cv, star, ramp)
    return cv


def icon_dodge():
    cv = Canvas(16, 16)
    head = polygon([(15.6, 8), (9.2, 1.6), (9.2, 14.4)])
    shaft = rect(5, 6, 9, 9)
    streaks = rect(0, 4, 3, 4) | rect(1, 11, 4, 11) | rect(2, 7, 3, 8)
    draw(cv, head | shaft, WHITE_UI)
    draw(cv, streaks, WHITE_UI)
    return cv


def icon_bag():
    cv = Canvas(16, 16)
    sack = ellipse(8, 10.5, 6.2, 5.0) | rect(6, 3, 10, 6)
    tie = rect(5, 5, 11, 6)
    draw(cv, sack, LEATHER)
    paint(cv, tie, GOLD[2])
    cv.set(5, 5, GOLD[1]); cv.set(11, 6, GOLD[3])
    paint(cv, {(7, 2), (9, 2), (6, 1), (10, 1)}, LEATHER[2])
    outline(cv, {(7, 2), (9, 2), (6, 1), (10, 1)}, K)
    return cv


def icon_pause():
    cv = Canvas(16, 16)
    bars = rect(3, 2, 6, 13) | rect(9, 2, 12, 13)
    draw(cv, bars, WHITE_UI)
    return cv


def icon_map():
    cv = Canvas(16, 16)
    sheet = polygon([(1, 3), (5.5, 1.5), (10.5, 3), (15, 1.5), (15, 13), (10.5, 14.5), (5.5, 13), (1, 14.5)])
    draw(cv, sheet, PAPER_ICON)
    for y in range(2, 14):
        cv.set(5, y, PAPER_ICON[3]); cv.set(10, y + 1, PAPER_ICON[3])
    for (x, y) in [(3, 6), (4, 7), (6, 8), (8, 8), (9, 9), (12, 7)]:
        cv.set(x, y, hexc("b8261b"))
    cv.set(12, 6, hexc("b8261b")); cv.set(11, 7, hexc("b8261b")); cv.set(13, 7, hexc("b8261b")); cv.set(12, 8, hexc("b8261b"))
    return cv


def icon_person():
    cv = Canvas(16, 16)
    head = disc(8, 5, 3.3)
    shoulders = ellipse(8, 14.5, 6.2, 4.6)
    draw(cv, head | shoulders, WHITE_UI)
    return cv


def icon_scroll():
    cv = Canvas(16, 16)
    paper = rect(3, 3, 12, 12)
    rolls = rect(2, 2, 13, 3) | rect(2, 12, 13, 13)
    draw(cv, paper, PAPER_ICON)
    draw(cv, rolls, CORK)
    for y in (5, 7, 9):
        paint(cv, rect(5, y, 10, y), PAPER_ICON[3])
    return cv


def icon_warning():
    cv = Canvas(16, 16)
    tri = polygon([(8, 0.8), (15.4, 14.6), (0.6, 14.6)])
    draw(cv, tri, GOLD[:4])
    paint(cv, rect(7, 5, 8, 10), K)
    paint(cv, rect(7, 12, 8, 13), K)
    return cv


def icon_heart():
    cv = Canvas(16, 16)
    heart = disc(5, 6, 3.6) | disc(11, 6, 3.6) | polygon([(1.6, 7), (14.4, 7), (8, 14.5)])
    draw(cv, heart, RUBY)
    return cv


def build_icons():
    icons = {}
    icons["gold"] = icon_coin()
    icons["herb"] = icon_herb()
    icons["tonic"] = icon_flask(RUBY)
    icons["manaDraught"] = icon_flask(SAPPH)
    icons["elixir"] = icon_flask(GOLD[:4], cork=[hexc("ffffff"), hexc("e0e6ee"), hexc("a8b2c0"), hexc("6b7587")])
    icons["stoneskin"] = icon_flask(STONE)
    icons["fury"] = icon_flask(EMBER)
    icons["fortune"] = icon_flask(EMER)
    icons["quickstep"] = icon_flask([hexc("d8fff4"), hexc("6fe0c8"), hexc("2aa58f"), hexc("125a4e")])
    icons["feverroot"] = icon_root()
    icons["barrowKey"] = icon_key()
    icons["silverRing"] = icon_ring()
    icons["fishingRod"] = icon_rod()
    icons["loaves"] = icon_loaf()
    icons["clothHood"] = icon_cap(CLOTH, "hood")
    for n in (1, 2, 3):
        icons[f"leatherCap{n}"] = icon_cap(LEATHER, "leather")
        icons[f"boarCap{n}"] = icon_cap(BOAR, "boar")
        icons[f"leatherVest{n}"] = icon_body(LEATHER, "leather")
        icons[f"boarVest{n}"] = icon_body(BOAR, "boar")
        icons[f"leatherBoots{n}"] = icon_boot(LEATHER, "leather")
        icons[f"boarBoots{n}"] = icon_boot(BOAR, "boar")
    icons["boarhideHelm"] = icon_cap(BOAR, "helm")
    icons["bronzeHelm1"] = icon_cap(BRONZE, "helm")
    icons["clothTunic"] = icon_body(CLOTH, "cloth")
    icons["bronzeMail1"] = icon_body(BRONZE, "mail")
    icons["clothShoes"] = icon_boot(CLOTH, "cloth")
    icons["bronzeGreaves1"] = icon_boot(BRONZE, "bronze")
    icons["wornBlade"] = icon_sword(IRON, guard=BRONZE, notch=True)
    icons["ironSword"] = icon_sword(STEEL)
    icons["emberBlade"] = icon_sword(EMBER, guard=GOLD, glow=True)
    icons["travelersKnot"] = icon_knot()
    icons["wolfFang"] = icon_fang()
    icons["lambsBell"] = icon_bell()
    icons["spell.emberBolt"] = icon_fireball()
    icons["spell.frostRing"] = icon_frost()
    icons["spell.thornbreak"] = icon_thorns()
    # Slot placeholders and UI glyphs.
    icons["slot.head"] = icon_cap([hexc("7a6a58"), hexc("5a4c3e"), hexc("43382d"), hexc("2c241c")], "leather")
    icons["slot.body"] = icon_body([hexc("7a6a58"), hexc("5a4c3e"), hexc("43382d"), hexc("2c241c")], "cloth")
    icons["slot.boots"] = icon_boot([hexc("7a6a58"), hexc("5a4c3e"), hexc("43382d"), hexc("2c241c")], "cloth")
    icons["slot.weapon"] = icon_sword([hexc("7a6a58"), hexc("5a4c3e"), hexc("43382d"), hexc("2c241c")],
                                      guard=[hexc("7a6a58"), hexc("5a4c3e"), hexc("43382d"), hexc("2c241c")],
                                      grip=[hexc("5a4c3e"), hexc("43382d"), hexc("2c241c"), hexc("2c241c")])
    icons["slot.charm"] = icon_fang()
    icons["ui.sword"] = icon_sword(STEEL)
    icons["ui.magic"] = icon_star()
    icons["ui.dodge"] = icon_dodge()
    icons["ui.bag"] = icon_bag()
    icons["ui.pause"] = icon_pause()
    icons["ui.map"] = icon_map()
    icons["ui.status"] = icon_person()
    icons["ui.quest"] = icon_scroll()
    icons["ui.warning"] = icon_warning()
    icons["ui.heart"] = icon_heart()
    icons["ui.star"] = icon_star(GOLD[:4])
    return icons


def main():
    os.makedirs(OUT, exist_ok=True)
    preview = None
    if "--preview" in sys.argv:
        preview = sys.argv[sys.argv.index("--preview") + 1]
    assets = {}
    assets.update(build_frames())
    assets["crest"] = crest()
    assets["pointer"] = pointer()
    assets["advance"] = advance()
    assets["badge-level"] = level_badge()
    assets["badge-main"] = badge_main()
    assets["badge-side"] = badge_side()
    assets["pad-a"] = pad_button("A", [hexc("c8f5a8"), hexc("5cbf4a"), hexc("2f8a3a"), hexc("16502a")])
    assets["pad-b"] = pad_button("B", RUBY)
    assets["pad-x"] = pad_button("X", SAPPH)
    assets["pad-y"] = pad_button("Y", GOLD[:4], K)
    assets["arrows"] = arrow_sheet()
    for size in (40, 30, 22):
        assets[f"touch-{size}"] = touch_disc(size)
        assets[f"touch-{size}-on"] = touch_disc(size, True)
    assets["stick-base"] = stick_base()
    assets["tombstone"] = tombstone()
    assets["crystal"] = crystal()
    icons = build_icons()
    names = list(icons.keys())
    cols = 8
    rows = (len(names) + cols - 1) // cols
    sheet = Canvas(cols * 16, rows * 16)
    index = {}
    for i, name in enumerate(names):
        sheet.paste(icons[name], (i % cols) * 16, (i // cols) * 16)
        index[name] = i
    assets["icons"] = sheet
    for name, cv in assets.items():
        cv.image().save(os.path.join(OUT, f"{name}.png"), optimize=True)
    with open(os.path.join(OUT, "icons.json"), "w") as fh:
        json.dump({"cell": 16, "cols": cols, "icons": index}, fh, indent=0, sort_keys=True)
    # Paper grain for panels (multiplied over the parchment at low opacity).
    rnd = random.Random(5)
    grain = Image.new("RGBA", (64, 64), (255, 255, 255, 255))
    gp = grain.load()
    for _ in range(260):
        x, y = rnd.randrange(64), rnd.randrange(64)
        v = rnd.choice([236, 242, 246, 250])
        gp[x, y] = (v, v - 4, v - 12, 255)
    for _ in range(26):
        x, y, n = rnd.randrange(64), rnd.randrange(64), rnd.randrange(3, 9)
        for i in range(n):
            gp[(x + i) % 64, y] = (244, 238, 226, 255)
    grain.save(os.path.join(OUT, "paper-grain.png"), optimize=True)
    if preview:
        scale = 6
        items = [(n, a.image()) for n, a in assets.items()]
        width = 1400
        x = y = 8
        row_h = 0
        placed = []
        for name, img in items:
            w, h = img.width * scale, img.height * scale
            if x + w > width - 8:
                x = 8
                y += row_h + 24
                row_h = 0
            placed.append((name, img, x, y))
            x += w + 16
            row_h = max(row_h, h)
        canvas = Image.new("RGBA", (width, y + row_h + 16), (92, 104, 88, 255))
        for name, img, px, py in placed:
            canvas.alpha_composite(img.resize((img.width * scale, img.height * scale), Image.NEAREST), (px, py))
        canvas.save(preview)
        print("preview", preview, canvas.size)
    print("wrote", len(assets), "assets and", len(icons), "icons to", OUT)


if __name__ == "__main__":
    main()
