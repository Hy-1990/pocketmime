import io
import math
import os
from functools import lru_cache
from pathlib import Path
from PIL import Image, ImageColor, ImageDraw, ImageFont, ImageOps

MOTIONS = ("peek", "nod", "shake", "jump", "sway", "sink")
INK = "#24322e"
PAPER = "#f6f2e7"


def mascot():
    # PocketMime's original frog, drawn on a square pixel grid.
    art = [
        "    gggg    gggg    ",
        "   gllllg  gllllg   ",
        "   glwwlgggglwwlg   ",
        "   glwklgggglwklg   ",
        "  ggllllllllllllgg  ",
        " gllllllllllllllllg ",
        " glpppllllllllppplg ",
        " glllllkllllklllllg ",
        "  glllllkkkklllllg  ",
        "   gggllllllllggg   ",
        "    gyyyyyyyyyyg    ",
        "   ggoyyoyyoyyogg   ",
        "  gllgyyyyyyyygllg  ",
        "   gggooooooooggg   ",
        "     gggggggggg     ",
        "    glllg  glllg    ",
    ]
    colors = dict(
        g="#293b32",
        l="#9ac979",
        w="#fff8db",
        k="#293b32",
        p="#ef9a70",
        y="#efb640",
        o="#c97934",
    )
    im = Image.new("RGBA", (20, 16))
    for y, row in enumerate(art):
        for x, c in enumerate(row[:20]):
            if c in colors:
                im.putpixel((x, y), ImageColor.getcolor(colors[c], "RGBA"))
    return im


def png(im):
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()


@lru_cache(maxsize=80)
def font(size):
    path = os.environ.get("POCKETMIME_FONT") or Path(__file__).parent / "assets/fonts/Bangers-Regular.ttf"
    return ImageFont.truetype(str(path), size)


def caption_style(caption):
    face = font(36)
    while face.getlength(caption) > 222 and face.size > 8:
        face = font(face.size - 1)
    return face


def letter(frame, caption, face):
    draw = ImageDraw.Draw(frame)
    draw.text((130, 219), caption, font=face, anchor="mm", fill=INK, stroke_width=2, stroke_fill=INK)
    draw.text((128, 216), caption, font=face, anchor="mm", fill="#ffe399", stroke_width=2, stroke_fill=INK)



def animate(asset, caption, motion, speed):
    src = Image.open(io.BytesIO(asset)).convert("RGBA")
    sprite = ImageOps.contain(
        src,
        (154, 139),
        Image.Resampling.NEAREST if max(src.size) <= 32 else Image.Resampling.LANCZOS,
    )
    frames = []
    face = caption_style(caption)
    for i in range(20):
        phase = i * math.tau / 20
        wave = math.sin(phase)
        ease = (1 - math.cos(phase)) / 2
        x, y, angle = 0, 0, 0
        if motion == "peek":
            y = 94 * max(0, (ease - 0.25) / 0.75)
        elif motion == "sink":
            y = 128 * ease
        elif motion == "jump":
            y = -28 * abs(wave)
        elif motion == "shake":
            x = 12 * math.sin(phase * 3)
        elif motion == "sway":
            angle = wave * 16
        elif motion == "nod":
            angle, y = wave * 6, 7 * ease
        frame = Image.new("RGBA", (256, 256), PAPER)
        pose = sprite.rotate(angle, Image.Resampling.NEAREST, expand=True)
        frame.alpha_composite(
            pose, (round(128 - pose.width / 2 + x), round(180 - pose.height + y))
        )
        draw = ImageDraw.Draw(frame)
        draw.rectangle((0, 184, 256, 256), fill=PAPER)
        letter(frame, caption, face)
        frames.append(frame.convert("RGB"))
    out = io.BytesIO()
    frames[0].save(
        out,
        "GIF",
        save_all=True,
        append_images=frames[1:],
        duration=round(90 / speed / 10) * 10,
        loop=0,
        disposal=2,
    )
    out.seek(0)
    if getattr(Image.open(out), "n_frames", 1) < 2:
        raise ValueError("static")
    return out.getvalue()


def keyframe_gif(poses, caption, speed):
    face = caption_style(caption)
    frames = []
    for pose in poses:
        frame = Image.new("RGBA", (256, 256), PAPER)
        frame.alpha_composite(pose.resize((144, 144), Image.Resampling.NEAREST), (56, 36))
        letter(frame, caption, face)
        frames.append(frame.convert("RGB"))
    if len({frame.tobytes() for frame in frames}) < 3:
        raise ValueError("static")
    out = io.BytesIO()
    frames[0].save(out, "GIF", save_all=True, append_images=frames[1:],
                   duration=[round(ms / speed) for ms in (280, 200, 380, 240)],
                   loop=0, disposal=2)
    return out.getvalue()


def puppet_poses(source, motion):
    """Offline poses bend the sprite at the waist while its feet stay planted."""
    base = ImageOps.pad(source.convert("RGBA"), (16, 16), method=Image.Resampling.NEAREST)
    turns = {
        "peek": ((-1, 2), (3, -1), (1, 1)), "nod": ((0, 2), (0, 4), (0, 1)),
        "shake": ((-3, 1), (3, 0), (-1, 0)), "jump": ((0, 3), (1, -2), (0, 1)),
        "sway": ((-2, 0), (3, 1), (1, 0)), "sink": ((1, 2), (0, 5), (0, 3)),
    }
    frames = [base]
    for dx, dy in turns[motion]:
        pose = Image.new("RGBA", base.size)
        for y in range(16):
            weight = max(0, 1 - y / 13)
            src_y = max(0, min(15, round(y - dy * weight)))
            pose.paste(base.crop((0, src_y, 16, src_y + 1)), (round(dx * weight), y))
        frames.append(pose)
    return frames
