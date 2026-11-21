import base64
import io
import json
import os
import re
import sqlite3
import zipfile
from functools import lru_cache
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from flask import Flask, abort, g, jsonify, request, send_file
from PIL import Image, ImageOps
from werkzeug.exceptions import HTTPException

from animation import MOTIONS, animate, keyframe_gif, puppet_poses, mascot, png
from model import available, DATA, ROOT, load, model_lock, redraw_poses

app = Flask(__name__, static_folder=str(ROOT / "web"), static_url_path="")
app.config.update(
    MAX_CONTENT_LENGTH=8 * 1024 * 1024, TRUSTED_HOSTS=["127.0.0.1", "localhost"]
)
DATA.mkdir(parents=True, exist_ok=True)
KEY = os.environ.get("DEEPSEEK_API_KEY", "")
PORT = int(os.environ.get("POCKETMIME_PORT", "8765"))
SAMPLES = {
    "en": [
        "On it",
        "Still running",
        "Noted",
        "Don't touch it",
        "Never mind",
        "Clocking out",
    ],
    "zh": ["我看看", "在跑了", "收到", "先别碰", "当我没说", "下班了"],
}


def db():
    if "db" not in g:
        g.db = sqlite3.connect(DATA / "pocketmime.sqlite3", timeout=10)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys=ON")
    return g.db


@app.teardown_appcontext
def close(_):
    if "db" in g:
        g.db.close()


with app.app_context():
    db().executescript("""
    CREATE TABLE IF NOT EXISTS projects(id INTEGER PRIMARY KEY, name TEXT NOT NULL, actor BLOB NOT NULL,
        updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS stickers(id INTEGER PRIMARY KEY, project INTEGER NOT NULL REFERENCES projects(id),
        caption TEXT NOT NULL, motion TEXT NOT NULL, speed REAL NOT NULL, version INTEGER NOT NULL DEFAULT 1,
        confirmed INTEGER, gif BLOB);
    """)

    with db():
        db().execute("BEGIN IMMEDIATE")
        existing = {r["name"] for r in db().execute("PRAGMA table_info(stickers)")}
        for name, column_type in [("prompt", "TEXT"), ("sprite", "BLOB"), ("director", "TEXT")]:
            if name not in existing:
                db().execute(f"ALTER TABLE stickers ADD COLUMN {name} {column_type}")
        db().execute(
            "UPDATE stickers SET prompt=caption || ' / ' || motion WHERE prompt IS NULL"
        )
        if "character" not in {
            r["name"] for r in db().execute("PRAGMA table_info(projects)")
        }:
            db().execute(
                "ALTER TABLE projects ADD COLUMN character TEXT NOT NULL DEFAULT ''"
            )


@app.before_request
def local_requests():
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        origin = request.headers.get("Origin")
        if origin and urlparse(origin).netloc != request.host:
            abort(403)
        if request.headers.get("X-PocketMime") != "local":
            abort(403)


@app.errorhandler(HTTPException)
def error(exc):
    return jsonify(
        error=exc.description if exc.code == 422 else str(exc.code)
    ), exc.code


def fail(code):
    abort(422, description=code)


def short(value, limit):
    if not isinstance(value, str) or not 0 < len(value.strip()) <= limit:
        fail("input")
    return value.strip()


def fields(item):
    if not isinstance(item, dict):
        fail("input")
    caption = short(item.get("caption"), 32)
    if not re.fullmatch(r"[ -~’‘“”…–—]+", caption) or not re.search(r"[A-Za-z]", caption):
        fail("caption_language")
    motion = item.get("motion")
    speed = item.get("speed", 1)
    if motion not in MOTIONS or speed not in (0.75, 1, 1.5):
        fail("input")
    return caption, motion, speed


def sticker_values(item, character="", previous=None):
    caption, motion, speed = fields(item)
    prompt = short(
        item.get("prompt", previous["prompt"] if previous else f"{caption} / {motion}"),
        160,
    )
    sprite = previous["sprite"] if previous else None
    if character and (previous is None or previous["prompt"] != prompt):
        model_prompt = visual_prompt(f"{character}, {prompt}")
        try:
            with model_lock:
                image = load().generate(model_prompt, count=1)[0]
                sprite = png(image)
        except (ImportError, OSError, ValueError, RuntimeError):
            fail("model")
    return caption, motion, speed, prompt, sprite


def rows(pid):
    return [
        dict(r)
        for r in db().execute(
            "SELECT id,prompt,caption,motion,speed,version,confirmed,director FROM stickers WHERE project=? ORDER BY id",
            (pid,),
        )
    ]


def project(pid):
    row = db().execute("SELECT * FROM projects WHERE id=?", (pid,)).fetchone()
    if row is None:
        abort(404)
    return row


def touch(pid):
    db().execute("UPDATE projects SET updated=CURRENT_TIMESTAMP WHERE id=?", (pid,))


@app.get("/")
def home():
    return app.send_static_file("index.html")


@app.route("/api/settings", methods=["GET", "POST"])
def settings():
    global KEY
    if request.method == "POST":
        key = request.json.get("key")
        if (
            not isinstance(key, str)
            or len(key) > 512
            or (key and not key.isascii())
            or any(c.isspace() for c in key)
        ):
            fail("key")
        KEY = key
    return jsonify(configured=bool(KEY))


def deepseek_json(instruction, brief):
    payload = {
        "model": os.getenv("DEEPSEEK_MODEL", "deepseek-flash"),
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": instruction},
            {"role": "user", "content": brief},
        ],
    }
    req = Request(
        "https://api.deepseek.com/chat/completions",
        json.dumps(payload).encode(),
        {"Authorization": "Bearer " + KEY, "Content-Type": "application/json"},
    )
    try:
        with urlopen(req, timeout=60) as res:
            content = json.load(res)["choices"][0]["message"]["content"]
        return json.loads(content)
    except HTTPError as exc:
        fail("auth" if exc.code in (401, 403) else "ai_unavailable")
    except (ValueError, TypeError, KeyError, IndexError, URLError, TimeoutError):
        fail("ai_unavailable")


@app.post("/api/ideas")
def ideas():
    data = request.json
    count = data.get("count")
    if type(count) != int or not 1 <= count <= 15:
        fail("input")
    lang = "zh" if data.get("lang") == "zh" else "en"
    if not KEY:
        fail("nokey")
    brief = short(data.get("brief"), 500)
    instruction = f"Create exactly {count} varied animated chat sticker ideas in {lang}. Return JSON object with items, an array of objects with prompt (a distinct editable description in the requested language naming a chat situation and a short visual progression with distinct facial expressions or limb poses and a compatible movement, maximum 160 characters), caption (always a short English chat reply in Latin letters, 1-32 characters, even when the description is Chinese) and motion (one of {', '.join(MOTIONS)})."
    try:
        items = deepseek_json(instruction, brief)["items"]
        if not isinstance(items, list) or len(items) != count:
            fail("ai_format")
        prompts = set()
        for item in items:
            fields(item)
            prompt = short(item.get("prompt"), 160)
            prompts.add(" ".join(prompt.casefold().split()))
        if len(prompts) != count:
            fail("ai_format")
    except HTTPError as exc:
        fail("auth" if exc.code in (401, 403) else "ai_unavailable")
    except (ValueError, TypeError, KeyError, IndexError, URLError, TimeoutError):
        fail("ai_unavailable")
    return jsonify(items=items)


@app.get("/api/model-status")
def model_status():
    return jsonify(available=available())


HAN = re.compile(r"[㐀-鿿豈-﫿]")


def visual_prompt(text, from_brief=False):
    if not KEY or not (from_brief or HAN.search(text)):
        return text
    instruction = (
        "Convert the user's sticker description into a compact English image prompt. "
        "Return JSON with one string field named prompt. Put the subject first, then "
        "its distinguishing colors, markings, clothing and visible pose or expression. "
        "Preserve explicit details in priority order. Use common concrete words, "
        "aim for 6 to 12 words. Omit backstory, dialogue and lettering. "
        "Do not invent props or change the species."
    )
    result = deepseek_json(instruction, text)
    prompt = result.get("prompt") if isinstance(result, dict) else None
    if (not isinstance(prompt, str) or not 0 < len(prompt.strip()) <= 240
            or HAN.search(prompt) or not re.search(r"[a-zA-Z]", prompt)):
        fail("ai_format")
    return prompt.strip()


@app.post("/api/characters")
def characters():
    prompt = visual_prompt(short(request.json.get("prompt"), 500), request.json.get("fromBrief"))
    try:
        with model_lock:
            sprites = load().generate(prompt, count=3)
    except (ImportError, OSError, ValueError, RuntimeError) as exc:
        app.logger.info("Character generation unavailable: %s", type(exc).__name__)
        fail("model")
    return jsonify(
        images=[
            "data:image/png;base64," + base64.b64encode(png(im)).decode()
            for im in sprites
        ]
    )


def normalize_actor(encoded):
    if not encoded:
        return png(mascot())
    try:
        raw = base64.b64decode(encoded.split(",", 1)[1], validate=True)
        im = Image.open(io.BytesIO(raw))
        if im.format not in ("PNG", "JPEG") or im.width * im.height > 20_000_000:
            fail("image")
        im = ImageOps.exif_transpose(im).convert("RGBA")
        im.thumbnail((512, 512))
        if not im.getchannel("A").getbbox():
            fail("image")
        return png(im)
    except (
        ValueError,
        IndexError,
        AttributeError,
        OSError,
        Image.DecompressionBombError,
    ):
        fail("image")


LOCAL_BEATS = {
    "peek": ("eyes looking left", "wide curious eyes", "eyes looking right"),
    "nod": ("eyelids lowered", "eyes closed smiling", "eyes half open"),
    "shake": ("frowning mouth", "mouth open startled", "tight worried mouth"),
    "jump": ("arms bent low", "both arms raised", "arms opening outward"),
    "sway": ("left arm raised", "both arms extended", "right arm raised"),
    "sink": ("wide round eyes", "narrow sleepy eyes", "eyes closed"),
}


def storyboards(items, subject):
    if not KEY:
        return [[(pose, "arms" if motion in ("jump", "sway") else "face")
                 for pose in LOCAL_BEATS[motion]] for _, motion, _, _, _ in items]
    brief = [{"description": prompt, "caption": caption, "motion": motion}
             for caption, motion, _, prompt, _ in items]
    result = deepseek_json(
        "Storyboard each reaction in order for a looping pixel sticker. The first frame "
        "is the confirmed neutral character. Design three additional visually distinct "
        "keyframes: anticipation, expressive peak, recovery. Follow each description "
        "and caption. Prefer visible changes of eyes, mouth, limbs or posture. Return "
        'JSON {"shots":[[{"pose":"short concrete English visual phrase","region":"face"}]]}. '
        "Exactly three beats per shot. Choose region from eyes, face, arms, body for each beat.",
        json.dumps({"subject": subject, "reactions": brief}, ensure_ascii=False),
    )
    shots = result.get("shots") if isinstance(result, dict) else None
    if not isinstance(shots, list) or len(shots) != len(items):
        fail("ai_format")
    plans = []
    for beats in shots:
        if not isinstance(beats, list) or len(beats) != 3:
            fail("ai_format")
        plan = []
        for beat in beats:
            if not isinstance(beat, dict) or beat.get("region") not in ("eyes", "face", "arms", "body"):
                fail("ai_format")
            pose = beat.get("pose")
            if not isinstance(pose, str) or not 0 < len(pose.strip()) <= 160 or HAN.search(pose):
                fail("ai_format")
            plan.append((pose.strip(), beat["region"]))
        plans.append(plan)
    return plans


def render_stickers(values, actor, subject):
    if not available():
        rendered = []
        for caption, motion, speed, _, sprite in values:
            with Image.open(io.BytesIO(sprite or actor)) as source:
                rendered.append(keyframe_gif(puppet_poses(source, motion), caption, speed))
        return rendered, "puppet"
    director = "deepseek" if KEY else "preset"
    plans = storyboards(values, subject)
    rendered = []
    for (caption, _, speed, _, sprite), plan in zip(values, plans, strict=True):
        with Image.open(io.BytesIO(sprite or actor)) as source:
            try:
                with model_lock:
                    poses = redraw_poses(source, plan)
            except (ImportError, OSError, RuntimeError):
                fail("model")
        rendered.append(keyframe_gif(poses, caption, speed))
    return rendered, director


@app.route("/api/projects", methods=["GET", "POST"])
def projects():
    if request.method == "GET":
        return jsonify(
            [
                dict(r)
                for r in db().execute("""SELECT p.id,p.name,p.updated,count(s.id) AS count,
        count(CASE WHEN s.confirmed=s.version THEN s.gif END) AS ready FROM projects p LEFT JOIN stickers s ON s.project=p.id GROUP BY p.id ORDER BY p.updated DESC,p.id DESC""")
            ]
        )
    d = request.json
    name = short(d.get("name"), 64)
    actor = normalize_actor(d.get("actor"))
    items = d.get("items")
    if not isinstance(items, list) or not 1 <= len(items) <= 15:
        fail("limit")
    character = short(d["character"], 80) if d.get("character") else ""
    values = [sticker_values(i, character) for i in items]
    complete = d.get("renderPack") is True
    rendered = []
    if complete:
        try:
            rendered, director = render_stickers(values, actor, name)
        except ValueError:
            fail("static")
    with db():
        pid = (
            db()
            .execute(
                "INSERT INTO projects(name,actor,character) VALUES(?,?,?)",
                (name, actor, character),
            )
            .lastrowid
        )
        db().executemany(
            "INSERT INTO stickers(project,caption,motion,speed,prompt,sprite) VALUES(?,?,?,?,?,?)",
            [(pid, *v) for v in values],
        )
        if complete:
            ids = rows(pid)
            db().executemany(
                "UPDATE stickers SET gif=?,director=?,confirmed=version WHERE id=?",
                [(gif, director, row["id"]) for gif, row in zip(rendered, ids, strict=True)],
            )
    return jsonify(id=pid), 201


@app.get("/api/projects/<int:pid>")
def detail(pid):
    return jsonify(id=pid, name=project(pid)["name"], items=rows(pid))


@app.get("/api/projects/<int:pid>/actor.png")
def actor(pid):
    return send_file(io.BytesIO(project(pid)["actor"]), mimetype="image/png")


@app.post("/api/projects/<int:pid>/items")
def append(pid):
    items = request.json.get("items")
    if not isinstance(items, list) or not items:
        fail("input")
    if len(rows(pid)) + len(items) > 15:
        fail("limit")
    values = [sticker_values(i, project(pid)["character"]) for i in items]
    with db():
        db().execute("BEGIN IMMEDIATE")
        project(pid)
        if len(rows(pid)) + len(items) > 15:
            fail("limit")
        db().executemany(
            "INSERT INTO stickers(project,caption,motion,speed,prompt,sprite) VALUES(?,?,?,?,?,?)",
            [(pid, *v) for v in values],
        )
        touch(pid)
    return detail(pid)


def sticker(sid):
    row = db().execute("SELECT * FROM stickers WHERE id=?", (sid,)).fetchone()
    if row is None:
        abort(404)
    return row


@app.route("/api/items/<int:sid>", methods=["PATCH", "DELETE"])
def edit(sid):
    prior = sticker(sid)
    if prior["version"] != request.json.get("version"):
        abort(409)
    if request.method == "PATCH":
        values = sticker_values(
            request.json, project(prior["project"])["character"], prior
        )
    with db():
        db().execute("BEGIN IMMEDIATE")
        row = sticker(sid)
        if row["version"] != request.json.get("version"):
            abort(409)
        if request.method == "DELETE":
            if len(rows(row["project"])) <= 1:
                fail("minimum")
            db().execute("DELETE FROM stickers WHERE id=?", (sid,))
        else:
            db().execute(
                "UPDATE stickers SET caption=?,motion=?,speed=?,prompt=?,sprite=?,version=version+1 WHERE id=?",
                (*values, sid),
            )
        touch(row["project"])
    return detail(row["project"])


@app.get("/api/items/<int:sid>/draft.gif")
def draft_gif(sid):
    row = sticker(sid)
    if row["confirmed"] == row["version"]:
        gif = row["gif"]
    else:
        pack = project(row["project"])
        with Image.open(io.BytesIO(row["sprite"] or pack["actor"])) as source:
            try:
                gif = keyframe_gif(puppet_poses(source, row["motion"]), row["caption"], row["speed"])
            except ValueError:
                gif = row["gif"] or png(source)
    return send_file(io.BytesIO(gif), mimetype="image/gif" if gif.startswith(b"GIF") else "image/png")


@app.post("/api/items/<int:sid>/confirm")
def confirm(sid):
    row = sticker(sid)
    if row["version"] != request.json.get("version"):
        abort(409)
    pack = project(row["project"])
    try:
        values = (*fields(dict(row)), row["prompt"], row["sprite"])
        gifs, director = render_stickers([values], pack["actor"], pack["name"])
    except ValueError:
        fail("static")
    with db():
        changed = db().execute(
            "UPDATE stickers SET gif=?,director=?,confirmed=version WHERE id=? AND version=?",
            (gifs[0], director, sid, row["version"]),
        )
        if not changed.rowcount:
            abort(409)
        touch(row["project"])
    return detail(row["project"])


@app.get("/api/items/<int:sid>/frames.png")
def frames_strip(sid):
    gif = sticker(sid)["gif"]
    if not gif:
        abort(404)
    with Image.open(io.BytesIO(gif)) as animation:
        count = animation.n_frames
        strip = Image.new("RGB", (count * 80, 80))
        for i in range(count):
            animation.seek(i)
            tile = animation.convert("RGB").crop((48, 28, 208, 188))
            strip.paste(tile.resize((80, 80), Image.Resampling.NEAREST), (i * 80, 0))
    return send_file(io.BytesIO(png(strip)), mimetype="image/png")


@app.get("/api/items/<int:sid>/sticker.gif")
def download(sid):
    data = sticker(sid)["gif"]
    if not data:
        abort(404)
    return send_file(
        io.BytesIO(data),
        mimetype="image/gif",
        as_attachment=True,
        download_name=f"sticker-{sid}.gif",
    )


@app.get("/api/projects/<int:pid>/stickers.zip")
def archive(pid):
    project(pid)
    files = (
        db()
        .execute(
            "SELECT id,version,confirmed,gif FROM stickers WHERE project=? ORDER BY id",
            (pid,),
        )
        .fetchall()
    )
    if not files:
        fail("empty")
    versions = ",".join(f"{row['id']}-{row['version']}" for row in files)
    if any(row["confirmed"] != row["version"] or not row["gif"] for row in files):
        abort(409)
    if request.args.get("versions", versions) != versions:
        abort(409)
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        for row in files:
            z.writestr(f"sticker-{row['id']}.gif", row["gif"])
    out.seek(0)
    return send_file(
        out,
        mimetype="application/zip",
        as_attachment=True,
        download_name=f"pocketmime-{pid}.zip",
    )


@app.get("/api/sample/<motion>.gif")
def sample(motion):
    if motion not in MOTIONS:
        abort(404)
    lang = "zh" if request.args.get("lang") == "zh" else "en"
    return send_file(
        io.BytesIO(sample_gif(motion, lang)), mimetype="image/gif", max_age=86400
    )


@lru_cache(maxsize=12)
def sample_gif(motion, lang):
    return animate(png(mascot()), SAMPLES["en"][MOTIONS.index(motion)], motion, 1)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=PORT, debug=False)
