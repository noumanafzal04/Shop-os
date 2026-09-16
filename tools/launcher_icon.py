"""
The launcher icon: a cart on the brand.

Drawn rather than exported, because there is no logo file anywhere in this
repo — the wordmark is a `<Text>` component — and no SVG renderer on this
machine. PIL primitives at 4x, downsampled, which is sharper at 48px than a
traced path would be.

Geometry is in fractions of the canvas so every density is the same drawing.
"""
from PIL import Image, ImageDraw

BRAND = (85, 127, 29, 255)     # #557F1D — the same hex as values/colors.xml
WHITE = (255, 255, 255, 255)
SS = 8                          # supersample; anti-aliasing comes from the resize


def cart(size, scale=0.52, cy_shift=-0.02):
    """The mark alone, on transparency. `size` is the final square."""
    S = size * SS
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)

    u = S * scale                      # the mark's own box
    cx, cy = S / 2, S / 2 + S * cy_shift
    x0, y0 = cx - u / 2, cy - u / 2
    w = max(2, int(u * 0.085))         # one stroke weight, everywhere

    # ── The basket: a trapezoid, wider at the top, with a flat base.
    top_y = y0 + u * 0.34
    bot_y = y0 + u * 0.70
    tl, tr = x0 + u * 0.16, x0 + u * 1.00
    bl, br = x0 + u * 0.30, x0 + u * 0.88
    d.polygon([(tl, top_y), (tr, top_y), (br, bot_y), (bl, bot_y)], outline=WHITE, width=w)

    # A single rib, so the basket reads as a basket and not as a bag. One, not
    # three: at 48px three become a grey smudge. Placed at the midpoint, where
    # the eye expects the weight of the shape to be.
    mid = top_y + (bot_y - top_y) * 0.48
    d.line([(x0 + u * 0.225, mid), (x0 + u * 0.945, mid)], fill=WHITE, width=int(w * 0.75))

    # ── The handle. One unbroken stroke — basket corner, up, then a short
    #    horizontal grip. Drawn as a polyline with round joins so the corner
    #    does not read as two separate marks, which is exactly how the first
    #    version failed: a detached stub floating off the top-left.
    hx, hy = x0 + u * 0.05, y0 + u * 0.12
    d.line([(tl, top_y), (hx, hy)], fill=WHITE, width=w, joint="curve")
    d.line([(hx, hy), (x0 - u * 0.06, hy)], fill=WHITE, width=w, joint="curve")
    # The joint itself, filled, because PIL does not cap a polyline corner.
    d.ellipse([hx - w / 2, hy - w / 2, hx + w / 2, hy + w / 2], fill=WHITE)

    # ── Wheels. Filled, because two more outlines at this size is noise.
    r = u * 0.078
    for wx in (x0 + u * 0.42, x0 + u * 0.78):
        wy = bot_y + u * 0.155
        d.ellipse([wx - r, wy - r, wx + r, wy + r], fill=WHITE)

    return im.resize((size, size), Image.LANCZOS)


def legacy(size, round_=False):
    """The pre-Android-8 icon: the shape is baked into the PNG."""
    S = size * SS
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if round_:
        d.ellipse([0, 0, S - 1, S - 1], fill=BRAND)
    else:
        # A squircle, which is what every other icon on the launcher is.
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=BRAND)
    im = im.resize((size, size), Image.LANCZOS)
    im.alpha_composite(cart(size, scale=0.56))
    return im


def foreground(size):
    """
    The adaptive foreground: 108dp of canvas, only the middle 72dp guaranteed
    visible. The mark is sized against the SAFE ZONE, not the canvas, or the
    launcher's circular mask clips the handle off.
    """
    return cart(size, scale=0.56 * (72 / 108))


# ─────────────────────────────────────────────────────────────────────────
# Run me: python3 tools/launcher_icon.py   (from the `mobile` directory)
#
# Regenerates every launcher asset in place. Kept in the repo because the
# alternative is fifteen PNGs with no source — which is how an icon becomes
# something nobody can change, and this one has already been the stock Android
# robot for longer than anybody meant it to be.
#
# Needs only Pillow. There is no SVG renderer on the build machines, which is
# why the mark is drawn with primitives rather than traced from the app's own
# `CartIcon` path.
# ─────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import pathlib

    RES = pathlib.Path(__file__).resolve().parent.parent / "android/app/src/main/res"
    if not RES.is_dir():
        raise SystemExit(f"no res/ at {RES} — run this from the mobile project")

    # bucket -> (legacy px at 48dp, adaptive foreground px at 108dp)
    for bucket, (legacy_px, fg_px) in {
        "mdpi": (48, 108),
        "hdpi": (72, 162),
        "xhdpi": (96, 216),
        "xxhdpi": (144, 324),
        "xxxhdpi": (192, 432),
    }.items():
        out = RES / f"mipmap-{bucket}"
        out.mkdir(parents=True, exist_ok=True)
        legacy(legacy_px).save(out / "ic_launcher.png")
        legacy(legacy_px, round_=True).save(out / "ic_launcher_round.png")
        foreground(fg_px).save(out / "ic_launcher_foreground.png")
        print(f"  {bucket:8} {legacy_px:>3}px legacy · {fg_px:>3}px foreground")

    print("\nThe adaptive XML and ic_launcher_background live in res/ and are not")
    print("generated — one hex and two four-line files, easier read than written.")
