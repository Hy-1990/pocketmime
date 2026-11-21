import base64
import io
import json
import os
import tempfile
import unittest
import zipfile
from unittest.mock import patch

scratch = tempfile.TemporaryDirectory()
os.environ["POCKETMIME_DATA"] = scratch.name

import app as server
from PIL import Image, ImageSequence


class PackFlow(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.object(server, "available", return_value=False))
        self.client = server.app.test_client()
        self.headers = {"X-PocketMime": "local"}
        self.item = {
            "caption": "On it",
            "motion": "peek",
            "speed": 1,
            "prompt": "Peeking over the desk",
        }

    def post(self, url, data):
        return self.client.post(url, json=data, headers=self.headers)

    def test_lifecycle(self):
        pic = io.BytesIO()
        Image.new("RGB", (32, 48), "blue").save(pic, "JPEG")
        actor = "data:image/jpeg;base64," + base64.b64encode(pic.getvalue()).decode()
        p = self.post(
            "/api/projects", {"name": "test", "actor": actor, "items": [self.item]}
        ).json["id"]
        pack = f"/api/projects/{p}"
        sid = self.client.get(pack).json["items"][0]["id"]
        item = f"/api/items/{sid}"
        self.assertEqual(self.post(item + "/confirm", {"version": 1}).status_code, 200)
        gif = self.client.get(item + "/sticker.gif").data
        im = Image.open(io.BytesIO(gif))
        self.assertEqual(im.info["loop"], 0)
        self.assertGreater(
            len(
                {frame.convert("RGB").tobytes() for frame in ImageSequence.Iterator(im)}
            ),
            1,
        )
        edit = self.client.patch(
            item,
            json={**self.item, "caption": "One moment", "version": 1},
            headers=self.headers,
        )
        self.assertEqual(edit.json["items"][0]["confirmed"], 1)
        self.assertEqual(self.post(item + "/confirm", {"version": 1}).status_code, 409)
        self.assertEqual(self.client.get(item + "/sticker.gif").data, gif)
        self.assertEqual(self.client.get(pack + "/stickers.zip").status_code, 409)
        self.assertEqual(self.post(item + "/confirm", {"version": 2}).status_code, 200)
        latest = self.client.get(item + "/sticker.gif").data
        self.assertNotEqual(latest, gif)
        self.assertEqual(self.client.get(pack + f"/stickers.zip?versions={sid}-1").status_code, 409)
        with zipfile.ZipFile(
            io.BytesIO(self.client.get(pack + "/stickers.zip").data)
        ) as z:
            self.assertEqual(z.read(z.namelist()[0]), latest)
        self.assertEqual(
            self.post(pack + "/items", {"items": [self.item] * 14}).status_code, 200
        )
        self.assertEqual(
            self.post(pack + "/items", {"items": [self.item]}).status_code, 422
        )
        self.assertEqual(len(self.client.get(pack).json["items"]), 15)

    def test_completed_pack_contains_every_animation(self):
        for count in (6, 15):
            items = [
                {**self.item, "caption": f"Reaction {i}", "motion": server.MOTIONS[i % 6]}
                for i in range(count)
            ]
            result = self.post(
                "/api/projects", {"name": "pack", "items": items, "renderPack": True}
            )
            self.assertEqual(result.status_code, 201)
            project = f"/api/projects/{result.json['id']}"
            self.assertTrue(
                all(
                    i["confirmed"] == i["version"]
                    for i in self.client.get(project).json["items"]
                )
            )
            with zipfile.ZipFile(
                io.BytesIO(self.client.get(project + "/stickers.zip").data)
            ) as archive:
                self.assertEqual(len(archive.namelist()), count)
                for name in archive.namelist():
                    im = Image.open(io.BytesIO(archive.read(name)))
                    self.assertGreater(im.n_frames, 1)
                    self.assertEqual(im.info["loop"], 0)

    def test_key_boundary_and_ai(self):
        self.assertEqual(
            self.client.post("/api/settings", json={"key": "fake"}).status_code, 403
        )
        self.assertEqual(
            self.client.post(
                "/api/settings",
                json={"key": "fake"},
                headers={**self.headers, "Origin": "https://example.com"},
            ).status_code,
            403,
        )
        self.post("/api/settings", {"key": "test-only"})
        try:
            answer = json.dumps({"items": [self.item]})
            upstream = io.BytesIO(
                json.dumps({"choices": [{"message": {"content": answer}}]}).encode()
            )
            with patch.object(server, "urlopen", return_value=upstream) as call:
                r = self.post(
                    "/api/ideas", {"brief": "Sleepy frog", "count": 1, "lang": "zh"}
                )
                self.assertEqual(r.json["items"], [self.item])
                self.assertEqual(
                    call.call_args.args[0].get_header("Authorization"),
                    "Bearer test-only",
                )
            self.assertEqual(
                self.client.get("/api/settings").json, {"configured": True}
            )
        finally:
            self.post("/api/settings", {"key": ""})

    def test_directed_poses_reach_export(self):
        poses = [Image.new("RGBA", (16, 16), c) for c in ("red", "blue", "yellow", "green")]
        beats = [{"pose": pose, "region": "face"} for pose in ("eyes narrow", "eyes closed", "eyes open")]
        with patch.object(server, "KEY", "test"), patch.object(server, "available", return_value=True), \
             patch.object(server, "deepseek_json", return_value={"shots": [beats]}) as director, \
             patch.object(server, "redraw_poses", return_value=poses) as redraw:
            result = self.post("/api/projects", {"name": "frog", "items": [self.item], "renderPack": True})
        self.assertEqual(result.status_code, 201)
        self.assertIn(self.item["prompt"], director.call_args.args[1])
        self.assertEqual(redraw.call_args.args[1], [(b["pose"], b["region"]) for b in beats])
        row = self.client.get(f"/api/projects/{result.json['id']}").json["items"][0]
        self.assertEqual(row["director"], "deepseek")
        gif = Image.open(io.BytesIO(self.client.get(f"/api/items/{row['id']}/sticker.gif").data))
        self.assertEqual(gif.n_frames, 4)

    def test_all_motions(self):
        for motion in server.MOTIONS:
            with self.subTest(motion=motion):
                im = Image.open(
                    io.BytesIO(self.client.get(f"/api/sample/{motion}.gif").data)
                )
                self.assertEqual(im.info["loop"], 0)
                self.assertGreater(
                    len(
                        {f.convert("RGB").tobytes() for f in ImageSequence.Iterator(im)}
                    ),
                    1,
                )


if __name__ == "__main__":
    unittest.main()
