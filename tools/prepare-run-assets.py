#!/usr/bin/env python3
"""Prepare the runtime gameplay art from the production-art development masters.

**This is an authoring tool, not a build step.** Nothing in `app/`, `game/` or
the Nuxt build ever reads `design-reference/`; this script is run by hand, its
output is committed under `public/game/`, and the runtime loads only that
output. `docs/architecture/asset-strategy.md` §4.5 is the rule it implements:
development masters are not delivery inputs, they are "redrawn or extracted into
rights-cleared, text-free runtime files".

Each entry below records where a runtime file comes from, so a later art pass
can re-cut it from an updated master instead of guessing.

Requires Pillow. Run from the repository root:

    python3 tools/prepare-run-assets.py
"""

from __future__ import annotations

import math
import os
from collections import deque
from dataclasses import dataclass, field

from PIL import Image, ImageDraw, ImageFilter

MASTERS = "design-reference/production-asset-development"
OUT = "public/game"

AYSENUR_SHEET = f"{MASTERS}/characters/aysenur/purrenade-aysenur-character-reference-sheet-v1.png"
AYSENUR_ACTION = f"{MASTERS}/characters/aysenur/purrenade-aysenur-action-animation-master-v1.png"
LOLI_CHARACTER = f"{MASTERS}/characters/loli/purrenade-loli-character-master-v1.png"
GAMEPLAY = f"{MASTERS}/gameplay/purrenade-gameplay-assets-master-v1.png"
WORLD = f"{MASTERS}/world/purrenade-world-environment-master-v1.png"


@dataclass(frozen=True)
class Cell:
    """One extracted illustration, and where in which master it lives."""

    name: str
    source: str
    box: tuple[int, int, int, int]
    """`x, y, w, h` in master pixels."""
    scale: float = 1.0
    """Resampling factor. The masters are 1536x1024, so cells are small."""
    mirror: bool = False
    note: str = ""
    mode: str = "key"
    """`key` for coloured art on cream; `silhouette` for white-on-cream art."""
    keying: dict[str, int] = field(default_factory=dict)


# --- extraction ------------------------------------------------------------


def key_out(img: Image.Image, lo: int = 16, hi: int = 44, neutral: int = 26) -> Image.Image:
    """Lift a cell off the master's cream panel without eating its white.

    Three rules, in order of precedence:

    1. A pixel the panel edge cannot reach through background-coloured
       territory is *enclosed* — Ayşenur's white tank top, her sneakers, the
       barrier's white stripes — and stays fully opaque. A plain colour-distance
       key eats all three, which is exactly the "white turns into a hole" defect
       that makes hand-keyed sprites look chewed.
    2. A reachable pixel that is near-neutral and near-background is the soft
       drop shadow the master paints under every prop. It goes; the runtime
       draws its own shadow at the depth the object is actually at.
    3. Everything else fades over `lo`..`hi` with a smoothstep, which keeps the
       illustration's antialiased outline instead of stair-stepping it.
    """
    img = img.convert("RGB")
    w, h = img.size
    px = img.load()

    corners = [px[0, 0], px[w - 1, 0], px[0, h - 1], px[w - 1, h - 1]]
    bg = tuple(sorted(c[i] for c in corners)[1] for i in range(3))

    dist = [[max(abs(px[x, y][i] - bg[i]) for i in range(3)) for x in range(w)] for y in range(h)]

    reached = [[False] * w for _ in range(h)]
    queue: deque[tuple[int, int]] = deque()

    def seed(x: int, y: int) -> None:
        if dist[y][x] < hi and not reached[y][x]:
            reached[y][x] = True
            queue.append((x, y))

    for x in range(w):
        seed(x, 0)
        seed(x, h - 1)
    for y in range(h):
        seed(0, y)
        seed(w - 1, y)

    while queue:
        x, y = queue.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not reached[ny][nx] and dist[ny][nx] < hi:
                reached[ny][nx] = True
                queue.append((nx, ny))

    out = Image.new("RGBA", (w, h))
    op = out.load()

    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            if not reached[y][x]:
                op[x, y] = (r, g, b, 255)
                continue

            d = dist[y][x]
            saturation = max(r, g, b) - min(r, g, b)

            if d <= lo or (saturation < neutral and d < hi):
                alpha = 0
            elif d >= hi:
                alpha = 255
            else:
                t = (d - lo) / (hi - lo)
                alpha = int(255 * t * t * (3 - 2 * t))

            op[x, y] = (r, g, b, alpha)

    return out


def silhouette(img: Image.Image, threshold: int = 22, close: int = 7,
               feather: float = 1.2) -> Image.Image:
    """Alpha from a closed silhouette, for art that is itself nearly white.

    Loli's coat and the low barrier's stripes are within a handful of points of
    the master's cream panel, so no colour key can separate them — and the fur
    and the barrier's legs leave gaps a flood fill pours straight through, which
    is what chewed both of them into lace on the first pass. This instead builds
    a coarse "is anything drawn here" mask, closes it (dilate, flood the
    outside, erode back) so those gaps seal, and feathers the result. The
    closing costs a little of the fluffiest fur tips and buys a clean
    silhouette, which is what readability at mobile scale actually needs.
    """
    img = img.convert("RGB")
    w, h = img.size
    px = img.load()

    corners = [px[0, 0], px[w - 1, 0], px[0, h - 1], px[w - 1, h - 1]]
    bg = tuple(sorted(c[i] for c in corners)[1] for i in range(3))

    drawn = Image.new("L", (w, h), 0)
    dp = drawn.load()
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            distance = max(abs(r - bg[0]), abs(g - bg[1]), abs(b - bg[2]))
            dp[x, y] = 255 if distance >= threshold else 0

    grown = drawn.filter(ImageFilter.MaxFilter(close))
    gp = grown.load()

    outside = [[False] * w for _ in range(h)]
    queue: deque[tuple[int, int]] = deque()

    def seed(x: int, y: int) -> None:
        if gp[x, y] == 0 and not outside[y][x]:
            outside[y][x] = True
            queue.append((x, y))

    for x in range(w):
        seed(x, 0)
        seed(x, h - 1)
    for y in range(h):
        seed(0, y)
        seed(w - 1, y)

    while queue:
        x, y = queue.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not outside[ny][nx] and gp[nx, ny] == 0:
                outside[ny][nx] = True
                queue.append((nx, ny))

    solid = Image.new("L", (w, h), 0)
    sp = solid.load()
    for y in range(h):
        for x in range(w):
            sp[x, y] = 0 if outside[y][x] else 255

    solid = solid.filter(ImageFilter.MinFilter(close)).filter(ImageFilter.GaussianBlur(feather))

    art = img.convert("RGBA")
    art.putalpha(solid)
    return art


def extract(cell: Cell) -> Image.Image:
    x, y, w, h = cell.box
    cropped = Image.open(cell.source).crop((x, y, x + w, y + h))
    art = (silhouette if cell.mode == "silhouette" else key_out)(cropped, **cell.keying)

    bbox = art.getbbox()
    if bbox is not None:
        art = art.crop(bbox)

    if cell.scale != 1.0:
        art = art.resize(
            (round(art.width * cell.scale), round(art.height * cell.scale)),
            Image.LANCZOS,
        )

    if cell.mirror:
        art = art.transpose(Image.FLIP_LEFT_RIGHT)

    return art


# --- drawn assets ----------------------------------------------------------
#
# A handful of pieces are drawn rather than cut. The Paw Token's master cell is
# a pink paw inside a white glow *on a cream panel*: white and cream are four
# points apart, so no colour key can separate them, and a radial cut leaves a
# cream square corner on the road. Drawing it reproduces the master's design —
# white paw-shaped backing, brand-pink pads, soft outer bloom — at whatever
# resolution the token is actually shown at, which is the better outcome anyway.

SUPERSAMPLE = 4
PAW_PINK = (233, 74, 125)
PAW_PINK_LIGHT = (255, 138, 173)
PAW_WHITE = (255, 252, 248)


def _paw_pads(size: int) -> list[tuple[float, float, float, float]]:
    """The five pads, as ellipse boxes in a unit square scaled to `size`."""
    u = size
    return [
        (0.335 * u, 0.115 * u, 0.455 * u, 0.335 * u),
        (0.545 * u, 0.115 * u, 0.665 * u, 0.335 * u),
        (0.165 * u, 0.245 * u, 0.295 * u, 0.455 * u),
        (0.705 * u, 0.245 * u, 0.835 * u, 0.455 * u),
        (0.255 * u, 0.435 * u, 0.745 * u, 0.855 * u),
    ]


def draw_paw_token(size: int = 176, bloom: bool = False) -> Image.Image:
    """The Paw Token: the only v1 collectible, drawn to the master's design."""
    s = size * SUPERSAMPLE
    canvas = Image.new("RGBA", (s, s), (0, 0, 0, 0))

    backing = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    bd = ImageDraw.Draw(backing)
    for box in _paw_pads(s):
        grown = (
            box[0] - 0.052 * s, box[1] - 0.052 * s,
            box[2] + 0.052 * s, box[3] + 0.052 * s,
        )
        bd.ellipse(grown, fill=(*PAW_WHITE, 255))
    backing = backing.filter(ImageFilter.GaussianBlur(0.012 * s))

    glow = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for box in _paw_pads(s):
        grown = (
            box[0] - 0.105 * s, box[1] - 0.105 * s,
            box[2] + 0.105 * s, box[3] + 0.105 * s,
        )
        gd.ellipse(grown, fill=(*PAW_PINK_LIGHT, 210 if bloom else 96))
    glow = glow.filter(ImageFilter.GaussianBlur((0.10 if bloom else 0.045) * s))

    pads = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    pd = ImageDraw.Draw(pads)
    for box in _paw_pads(s):
        pd.ellipse(box, fill=(*PAW_PINK, 255))
        highlight = (
            box[0] + (box[2] - box[0]) * 0.18,
            box[1] + (box[3] - box[1]) * 0.10,
            box[0] + (box[2] - box[0]) * 0.62,
            box[1] + (box[3] - box[1]) * 0.42,
        )
        pd.ellipse(highlight, fill=(*PAW_PINK_LIGHT, 190))
    pads = pads.filter(ImageFilter.GaussianBlur(0.004 * s))

    canvas.alpha_composite(glow)
    canvas.alpha_composite(backing)
    canvas.alpha_composite(pads)

    return canvas.resize((size, size), Image.LANCZOS)


def draw_petal(size: int = 64) -> Image.Image:
    """One SLAYYY petal. Effect elements panel 11: petals, hearts, sparkles."""
    s = size * SUPERSAMPLE
    canvas = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)

    for i in range(5):
        angle = i * (2 * math.pi / 5) - math.pi / 2
        cx = s / 2 + math.cos(angle) * 0.215 * s
        cy = s / 2 + math.sin(angle) * 0.215 * s
        r = 0.205 * s
        draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(255, 150, 190, 235))

    r = 0.085 * s
    draw.ellipse((s / 2 - r, s / 2 - r, s / 2 + r, s / 2 + r), fill=(255, 214, 122, 255))

    canvas = canvas.filter(ImageFilter.GaussianBlur(0.006 * s))
    return canvas.resize((size, size), Image.LANCZOS)


def draw_sparkle(size: int = 64) -> Image.Image:
    """A four-point sparkle — the v0.3 ✦, used only by SLAYYY."""
    s = size * SUPERSAMPLE
    canvas = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    c = s / 2

    for scale, colour in ((1.0, (255, 255, 255, 235)), (0.62, (255, 236, 190, 255))):
        arm, waist = 0.48 * s * scale, 0.085 * s * scale
        draw.polygon(
            [(c, c - arm), (c + waist, c - waist), (c + arm, c),
             (c + waist, c + waist), (c, c + arm), (c - waist, c + waist),
             (c - arm, c), (c - waist, c - waist)],
            fill=colour,
        )

    canvas = canvas.filter(ImageFilter.GaussianBlur(0.008 * s))
    return canvas.resize((size, size), Image.LANCZOS)


def draw_shadow(width: int = 192, height: int = 64) -> Image.Image:
    """The contact shadow every character and prop stands on."""
    s = SUPERSAMPLE
    canvas = Image.new("RGBA", (width * s, height * s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    draw.ellipse(
        (0.08 * width * s, 0.16 * height * s, 0.92 * width * s, 0.84 * height * s),
        fill=(72, 58, 52, 120),
    )
    canvas = canvas.filter(ImageFilter.GaussianBlur(0.06 * height * s))
    return canvas.resize((width, height), Image.LANCZOS)


def fade_top(img: Image.Image, fraction: float) -> Image.Image:
    """Fade an image out towards its top edge, so a band can meet a gradient."""
    out = img.convert("RGBA")
    alpha = out.getchannel("A")
    ap = alpha.load()
    cut = int(out.height * fraction)
    for y in range(cut):
        t = y / max(1, cut)
        factor = t * t * (3 - 2 * t)
        for x in range(out.width):
            ap[x, y] = int(ap[x, y] * factor)
    out.putalpha(alpha)
    return out


def mirror_tile(img: Image.Image) -> Image.Image:
    """Double an image with its own reflection, so it can tile seamlessly."""
    out = Image.new("RGBA", (img.width * 2, img.height))
    out.paste(img, (0, 0))
    out.paste(img.transpose(Image.FLIP_LEFT_RIGHT), (img.width, 0))
    return out


# --- the catalogue ---------------------------------------------------------

CELLS: tuple[Cell, ...] = (
    # Ayşenur. The camera faces the player — design-reference-conflicts #3
    # resolves the camera question to v0.3, which draws the character facing
    # forward — so the runtime uses the turnaround's front and three-quarter
    # views rather than the action master's side-view run strip. Those cells
    # are a side-view cycle and would put the protagonist in a different camera
    # from the world she runs through.
    Cell("aysenur-run", AYSENUR_SHEET, (26, 180, 141, 372), 2.0,
         note="Turnaround / Model Views · Front"),
    Cell("aysenur-lean-right", AYSENUR_SHEET, (172, 180, 131, 372), 2.0,
         note="Turnaround / Model Views · 3/4"),
    Cell("aysenur-lean-left", AYSENUR_SHEET, (172, 180, 131, 372), 2.0, mirror=True,
         note="Turnaround / Model Views · 3/4, mirrored"),
    # 1.28x above the turnaround's factor: the action master draws this panel
    # smaller, and a hit that shrinks the character would read as a second
    # gameplay event rather than as the same person stumbling.
    Cell("aysenur-hit", AYSENUR_ACTION, (24, 470, 124, 206), 2.56,
         note="5. Hit / Fail (Cute) · Hit (Surprised)"),

    # Loli. The three-quarter turnaround rather than the action master's
    # gameplay-view front, because it is the one cell that carries every trait
    # the companion has to read by: the fluffy ginger-and-white tail, the ginger
    # head markings, the pink ears, the marking beside the nose and the faintly
    # unimpressed face. The front view loses the tail entirely.
    Cell("loli-companion", LOLI_CHARACTER, (153, 190, 132, 190), 2.4,
         mode="silhouette", note="1. Turnaround Views · 3/4 View (Left)"),

    # Obstacles. The master's "(Jump over)" caption under the cone is a known
    # non-mechanic — conflict register B.1 — and nothing here reads it: the
    # cone is LANE_BLOCKING and the barrier is JUMPABLE, decided in the domain.
    Cell("traffic-cone", GAMEPLAY, (34, 188, 78, 99), 2.4,
         note="1. Core Obstacles · Traffic Cone"),
    Cell("traffic-cone-slayyy", GAMEPLAY, (605, 188, 88, 110), 2.4,
         note="2. Obstacles (SLAYYY World Variants) · cone"),
    # Silhouette-keyed: the barrier is mostly white, and a colour key opens
    # holes straight through its stripes.
    # A high silhouette threshold on purpose: the master paints a soft grey
    # shadow under the barrier, and at the default it is "drawn" enough to
    # bridge the two legs, sealing the gap between them into a pale panel.
    Cell("low-barrier", GAMEPLAY, (135, 202, 120, 84), 2.4, mode="silhouette",
         keying={"threshold": 50}, note="1. Core Obstacles · Low Barrier"),
    Cell("low-barrier-slayyy", GAMEPLAY, (693, 200, 124, 86), 2.4, mode="silhouette",
         keying={"threshold": 60}, note="2. Obstacles (SLAYYY World Variants) · barrier"),

    # Promenade dressing. No signboard and no kiosk: both carry baked-in
    # lettering, and asset-strategy §4.3 forbids text inside art.
    Cell("prop-railing", WORLD, (192, 492, 115, 69), 3.0,
         note="3. Environment Elements · Railing"),
    Cell("prop-lamp", WORLD, (44, 452, 24, 112), 3.4,
         note="3. Environment Elements · Street Lamp"),
    Cell("prop-bench", WORLD, (87, 503, 96, 60), 3.0,
         note="3. Environment Elements · Bench"),
    Cell("prop-palm", WORLD, (405, 446, 72, 116), 3.4,
         note="3. Environment Elements · Palm Tree"),
    Cell("prop-flowerpot", WORLD, (313, 464, 91, 99), 3.0,
         note="3. Environment Elements · Flower Pot"),
)

# The distant coast, cut clear of the master's foreground palms and flowers and
# mirrored so a parallax band can repeat without a seam.
HORIZON = Cell("world-horizon", WORLD, (320, 174, 240, 138), 4.0,
               note="1. World Overview (Normal) · sky, mountains, town, sea")


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    written: list[tuple[str, tuple[int, int]]] = []

    for cell in CELLS:
        art = extract(cell)
        path = f"{OUT}/{cell.name}.png"
        art.save(path, optimize=True)
        written.append((path, art.size))

    x, y, w, h = HORIZON.box
    strip = Image.open(HORIZON.source).crop((x, y, x + w, y + h)).convert("RGBA")
    strip = strip.resize(
        (round(w * HORIZON.scale), round(h * HORIZON.scale)), Image.LANCZOS,
    )
    horizon = fade_top(mirror_tile(strip), 0.3)
    horizon.save(f"{OUT}/world-horizon.png", optimize=True)
    written.append((f"{OUT}/world-horizon.png", horizon.size))

    for name, art in (
        ("paw-token", draw_paw_token()),
        ("paw-token-slayyy", draw_paw_token(bloom=True)),
        ("fx-petal", draw_petal()),
        ("fx-sparkle", draw_sparkle()),
        ("fx-shadow", draw_shadow()),
    ):
        path = f"{OUT}/{name}.png"
        art.save(path, optimize=True)
        written.append((path, art.size))

    for path, size in written:
        print(f"{path:44s} {size[0]:>5} x {size[1]:<5} {os.path.getsize(path) // 1024:>5} KiB")


if __name__ == "__main__":
    main()
