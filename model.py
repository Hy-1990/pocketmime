"""Optional Tessera CPU inference. The upstream sampler stays outside the repository."""

import hashlib
import importlib.util
import json
import os
import threading
from functools import lru_cache
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get("POCKETMIME_DATA", ROOT / "data")).resolve()
REV = "bef21be58afea4d16be21f5fbe85eaa0cae69290"
SAMPLER_HASH = "fbca8733cdae78ce4caf5f24e8f2c96e6ca36fca37619c4a7c51d68153f9b18f"
model_lock = threading.Lock()


def model_folder():
    return Path(
        os.environ.get(
            "POCKETMIME_MODEL_DIR", ROOT.parent / "models/tessera-small-onnx"
        )
    )


def available():
    from importlib.util import find_spec

    files = ("tessera_w8.onnx", "clip_text_w8.onnx", "tokenizer.json", "palette.json")
    return all((model_folder() / f).is_file() for f in files) and all(
        find_spec(m) for m in ("numpy", "onnxruntime", "tokenizers", "huggingface_hub")
    )


@lru_cache(maxsize=1)
def load():
    import numpy as np
    import onnxruntime as ort
    from tokenizers import Tokenizer

    folder = model_folder()
    sampler = DATA / "model/tessera_onnx.py"
    if not sampler.exists():
        with urlopen(
            f"https://huggingface.co/cfahlgren1/tessera-small-onnx/raw/{REV}/python/tessera_onnx.py",
            timeout=30,
        ) as res:
            code = res.read()
        if hashlib.sha256(code).hexdigest() != SAMPLER_HASH:
            raise ValueError("sampler")
        sampler.parent.mkdir(parents=True, exist_ok=True)
        sampler.write_bytes(code)
    if hashlib.sha256(sampler.read_bytes()).hexdigest() != SAMPLER_HASH:
        raise ValueError("sampler")
    spec = importlib.util.spec_from_file_location("tessera_sampler", sampler)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    def session(name):
        return ort.InferenceSession(
            str(folder / name), providers=["CPUExecutionProvider"]
        )

    return mod.Tessera(
        session("tessera_w8.onnx"),
        session("clip_text_w8.onnx"),
        Tokenizer.from_file(str(folder / "tokenizer.json")),
        np.array(
            json.loads((folder / "palette.json").read_text())["palette_rgba"],
            dtype=np.uint8,
        ),
    )


def redraw_poses(actor, beats):
    """Condition each 16x16 pose on the same subject by locking pixels outside the edit."""
    import numpy as np
    from PIL import Image, ImageOps

    sampler = load()
    image = ImageOps.pad(actor.convert("RGBA"), (16, 16), method=Image.Resampling.NEAREST)
    rgba = np.asarray(image).reshape(256, 4).astype(np.int32)
    palette = sampler.palette.astype(np.int32)
    # Alpha distinguishes transparent pixels even when hidden RGB values differ.
    diff = rgba[:, None] - palette
    diff[:, :, :3] *= (rgba[:, None, 3:4] > 0)
    indices = np.argmin((diff ** 2).sum(axis=2), axis=1)
    regions = {"face": (3, 2, 13, 9), "arms": (0, 7, 16, 12),
               "body": (2, 8, 14, 15), "eyes": (3, 3, 13, 8)}
    frames = [image]
    for prompt, region in beats:
        left, top, right, bottom = regions[region]
        x = indices.reshape(16, 16).copy()
        foreground = rgba[:, 3].reshape(16, 16) > 48
        edit = np.zeros((16, 16), dtype=bool)
        edit[top:bottom, left:right] = True
        if region in ("eyes", "face"):
            edit &= foreground
        if not edit.any():
            raise ValueError("empty edit region")
        x[edit] = 512
        x = x.reshape(1, 256)
        states, pooled = sampler.encode_text(prompt)
        sc = np.zeros((1, 256, 512), dtype=np.float32)
        for step in range(4):
            mask = x[0] == 512
            logits = sampler.denoiser.run(None, {
                "x": x, "text_states": states, "text_pooled": pooled,
                "mask_ratio": np.array([mask.mean()], dtype=np.float32),
                "sc_probs": sc, "drop_text": np.array([False]),
            })[0]
            logits -= logits.max(axis=-1, keepdims=True)
            sc = np.exp(logits)
            sc /= sc.sum(axis=-1, keepdims=True)
            if not np.isfinite(sc).all():
                raise RuntimeError("invalid pose probabilities")
            positions = np.flatnonzero(mask)
            count = (len(positions) + 3 - step) // (4 - step)
            best = positions[np.argsort(sc[0, positions].max(axis=1))[-count:]]
            x[0, best] = sc[0, best].argmax(axis=1)
        pixels = rgba.astype(np.uint8).copy()
        pixels[edit.ravel()] = sampler.palette[x[0, edit.ravel()]]
        frames.append(Image.fromarray(pixels.reshape(16, 16, 4)))
    if len({frame.tobytes() for frame in frames}) < 3:
        raise ValueError("insufficient distinct poses")
    return frames
