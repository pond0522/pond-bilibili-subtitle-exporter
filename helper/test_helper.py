import json
import logging
import os
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest import mock

from whisper_helper import (
    DEFAULT_MODEL,
    MODEL_BIN_BYTES,
    MODEL_FILES,
    SUPPORTED_MODELS,
    ApiHandler,
    HelperState,
    LocalTranscriber,
    ValidationError,
    atomic_json,
    cache_name,
    has_onnxruntime,
    main,
    token_matches,
    validate_bvid,
    validate_model,
    validate_unit,
)


class FakeTranscriber:
    device = "cpu"
    model = object()
    model_name = ""
    model_error = ""

    def __init__(self, gate=None):
        self.downloads = 0
        self.models = []
        self.gate = gate

    def download_audio(self, unit, temp_dir, progress_hook=None):
        self.downloads += 1
        if progress_hook:
            progress_hook("downloading", 100)
        path = temp_dir / "audio.m4a"
        path.write_bytes(b"test")
        return path

    def transcribe(self, audio_path, cancel_check, progress_hook=None, duration=0, model_name=DEFAULT_MODEL):
        self.models.append(model_name)
        self.model_name = model_name
        if progress_hook:
            progress_hook("transcribing", 50)
        if self.gate:
            self.gate.wait(5)
        if cancel_check():
            raise InterruptedError("cancelled")
        if progress_hook:
            progress_hook("transcribing", 100)
        return [{"from": 0.5, "to": 2.0, "content": "Python 课程"}]


class FailingTranscriber(FakeTranscriber):
    def transcribe(self, audio_path, cancel_check, progress_hook=None, duration=0, model_name=DEFAULT_MODEL):
        raise RuntimeError("模拟模型异常")


def payload(bvid="BV1qW4y1a7fU", cid=100, page=4, model=None):
    result = {
        "bvid": bvid,
        "title": "测试课程",
        "units": [{"bvid": bvid, "cid": cid, "page": page, "index": page, "title": "测试", "duration": 60}],
        "context": {"title": "保留的导出上下文"},
    }
    if model is not None:
        result["model"] = model
    return result


def wait_for(state, job_id, statuses, timeout=4):
    deadline = time.time() + timeout
    while time.time() < deadline:
        job = state.get_job(job_id)
        if job["status"] in statuses:
            return job
        time.sleep(0.02)
    raise AssertionError(f"job did not reach {statuses}")


class HelperTests(unittest.TestCase):
    def test_model_path_reuses_complete_local_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            snapshot = root / "models" / "models--Systran--faster-whisper-tiny" / "snapshots" / "commit"
            snapshot.mkdir(parents=True)
            for filename in MODEL_FILES:
                (snapshot / filename).write_bytes(b"ready")
            transcriber = LocalTranscriber(root, logging.getLogger("test-model-path"))
            with mock.patch.dict(MODEL_BIN_BYTES, {"tiny": len(b"ready")}), mock.patch(
                "whisper_helper.subprocess.run"
            ) as download:
                self.assertEqual(transcriber.model_path("tiny"), snapshot)
            download.assert_not_called()

    def test_atomic_json_retries_windows_file_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "state.json"
            real_replace = os.replace
            attempts = 0

            def flaky_replace(source, destination):
                nonlocal attempts
                attempts += 1
                if attempts < 3:
                    raise PermissionError("temporarily locked")
                return real_replace(source, destination)

            with mock.patch("whisper_helper.os.replace", side_effect=flaky_replace):
                atomic_json(path, {"ok": True})
            self.assertEqual(attempts, 3)
            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), {"ok": True})

    def test_validation(self):
        self.assertEqual(os.environ.get("HF_HUB_DISABLE_XET"), "1")
        self.assertEqual(validate_bvid("BV1qW4y1a7fU"), "BV1qW4y1a7fU")
        with self.assertRaises(ValidationError):
            validate_bvid("https://example.com/video")
        with self.assertRaises(ValidationError):
            validate_unit({"bvid": "BV1qW4y1a7fU", "cid": 1, "page": 0}, "BV1qW4y1a7fU")
        with self.assertRaises(ValidationError):
            validate_unit({"bvid": "BV1qW4y1a7fU", "cid": "bad", "page": 1}, "BV1qW4y1a7fU")
        self.assertTrue(token_matches("a" * 64, "a" * 64))
        self.assertFalse(token_matches("a" * 64, "b" * 64))
        self.assertFalse(has_onnxruntime(lambda _name: (_ for _ in ()).throw(ImportError("missing"))))
        self.assertEqual(validate_model(None), DEFAULT_MODEL)
        self.assertEqual(validate_model(""), DEFAULT_MODEL)
        for model_name in SUPPORTED_MODELS:
            self.assertEqual(validate_model(model_name), model_name)
        with self.assertRaises(ValidationError):
            validate_model("large")

    def test_prepare_model_cli_default_single_repeat_deduplicate_and_invalid(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / "config.json"
            config.write_text(json.dumps({"token": "d" * 64, "port": 17891}), encoding="utf-8")
            with mock.patch("whisper_helper.configure_logging"), mock.patch.object(
                LocalTranscriber, "load_model"
            ) as load_model:
                self.assertEqual(main(["--config", str(config), "--prepare-model"]), 0)
                load_model.assert_called_once_with(DEFAULT_MODEL)

                load_model.reset_mock()
                self.assertEqual(main(["--config", str(config), "--prepare-model", "tiny"]), 0)
                load_model.assert_called_once_with("tiny")

                load_model.reset_mock()
                self.assertEqual(
                    main([
                        "--config", str(config),
                        "--prepare-model", "tiny",
                        "--prepare-model", "base",
                        "--prepare-model", "tiny",
                        "--prepare-model", "small",
                    ]),
                    0,
                )
                self.assertEqual(
                    load_model.call_args_list,
                    [mock.call("tiny"), mock.call("base"), mock.call("small")],
                )

                with self.assertRaises(SystemExit):
                    main(["--config", str(config), "--prepare-model", "large"])

    def test_queue_cache_and_temp_cleanup(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fake = FakeTranscriber()
            state = HelperState(root, {"token": "test", "port": 17891}, fake)
            with self.assertRaises(ValidationError):
                state.create_job(payload(model="large"))
            created = state.create_job(payload())
            job = wait_for(state, created["id"], {"completed"})
            self.assertEqual(job["model"], DEFAULT_MODEL)
            self.assertEqual(job["items"][0]["status"], "success")
            self.assertEqual(job["items"][0]["cues"][0]["content"], "Python 课程")
            self.assertFalse(any((root / "temp").iterdir()))
            self.assertTrue((root / "results" / cache_name(job["items"][0]["unit"])).exists())
            self.assertTrue(cache_name(job["items"][0]["unit"]).endswith("_small.json"))

            second = state.create_job(payload(cid=100, page=4))
            wait_for(state, second["id"], {"completed"})
            self.assertEqual(fake.downloads, 1)

            third = state.create_job(payload(cid=100, page=4, model="base"))
            third_job = wait_for(state, third["id"], {"completed"})
            self.assertEqual(third_job["model"], "base")
            self.assertEqual(fake.downloads, 2)
            self.assertEqual(fake.models, [DEFAULT_MODEL, "base"])
            self.assertTrue((root / "results" / cache_name(third_job["items"][0]["unit"], "base")).exists())
            self.assertNotEqual(
                cache_name(third_job["items"][0]["unit"], DEFAULT_MODEL),
                cache_name(third_job["items"][0]["unit"], "base"),
            )
            health = state.health()
            self.assertEqual(health["supportedModels"], list(SUPPORTED_MODELS))
            self.assertEqual(health["defaultModel"], DEFAULT_MODEL)
            self.assertEqual(health["loadedModel"], "base")
            state.job_queue.join()
            state.shutdown_event.set()

    def test_cancel_and_persistence(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            gate = threading.Event()
            state = HelperState(root, {"token": "test", "port": 17891}, FakeTranscriber(gate))
            created = state.create_job(payload(cid=101, page=5))
            wait_for(state, created["id"], {"running"})
            deadline = time.time() + 2
            progress = {}
            while time.time() < deadline and progress.get("phase") != "transcribing":
                progress = state.public_job(state.get_job(created["id"]), False)["progress"]
                time.sleep(0.01)
            self.assertEqual(progress, {"phase": "transcribing", "percent": 50})
            state.cancel(created["id"])
            gate.set()
            job = wait_for(state, created["id"], {"cancelled"})
            self.assertTrue(job["cancelRequested"])
            state.job_queue.join()
            state.shutdown_event.set()

            stored = json.loads((root / "jobs" / f"{created['id']}.json").read_text(encoding="utf-8"))
            self.assertEqual(stored["status"], "cancelled")
            reloaded = HelperState(root, {"token": "test", "port": 17891}, FakeTranscriber())
            self.assertEqual(reloaded.get_job(created["id"])["status"], "cancelled")
            reloaded.shutdown_event.set()

    def test_restart_resume_failure_and_token_config(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            jobs = root / "jobs"
            jobs.mkdir(parents=True)
            job_id = "a" * 32
            unit = validate_unit(payload(cid=102, page=6)["units"][0], "BV1qW4y1a7fU")
            stored = {
                "id": job_id,
                "bvid": "BV1qW4y1a7fU",
                "title": "重启任务",
                "status": "running",
                "createdAt": "2026-07-28T00:00:00Z",
                "updatedAt": "2026-07-28T00:00:00Z",
                "cancelRequested": False,
                "current": unit,
                "workElapsed": 0,
                "processedDuration": 0,
                "context": {"title": "恢复"},
                "items": [{"unit": unit, "status": "running", "error": "", "cues": []}],
            }
            (jobs / f"{job_id}.json").write_text(json.dumps(stored), encoding="utf-8")
            config = {"token": "b" * 64, "port": 17891, "model": DEFAULT_MODEL}
            state = HelperState(root, config, FailingTranscriber())
            failed = wait_for(state, job_id, {"completed"})
            self.assertEqual(failed["model"], DEFAULT_MODEL)
            self.assertEqual(failed["items"][0]["status"], "failed")
            self.assertIn("模拟模型异常", failed["items"][0]["error"])
            self.assertFalse(any((root / "temp").iterdir()))
            self.assertTrue(token_matches("b" * 64, config["token"]))
            self.assertFalse(token_matches("a" * 64, config["token"]))
            self.assertEqual(state.active_job("BV1qW4y1a7fU")["id"], job_id)
            state.job_queue.join()
            state.shutdown_event.set()

    def test_http_handshake_uses_token_not_extension_id(self):
        with tempfile.TemporaryDirectory() as directory:
            token = "c" * 64
            state = HelperState(Path(directory), {"token": token, "port": 17891, "model": DEFAULT_MODEL}, FakeTranscriber())
            server = ThreadingHTTPServer(("127.0.0.1", 0), ApiHandler)
            server.state = state
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            base = f"http://127.0.0.1:{server.server_address[1]}"

            def request(method, path, provided="", origin="chrome-extension://abcdefghijklmnopabcdefghijklmnop"):
                headers = {"Origin": origin}
                if provided:
                    headers["X-Bili-Helper-Token"] = provided
                value = urllib.request.Request(base + path, data=b"" if method == "POST" else None, headers=headers, method=method)
                try:
                    with urllib.request.urlopen(value, timeout=2) as response:
                        return response.status, json.loads(response.read().decode("utf-8")), response.headers
                except urllib.error.HTTPError as error:
                    return error.code, json.loads(error.read().decode("utf-8")), error.headers

            try:
                status, challenge, _headers = request("GET", "/v1/handshake")
                self.assertEqual(status, 200)
                self.assertEqual(challenge, {"token_required": True})

                status, denied, _headers = request("POST", "/v1/handshake", "a" * 64)
                self.assertEqual(status, 401)
                self.assertFalse(denied["ok"])

                status, connected, _headers = request("POST", "/v1/handshake", token)
                self.assertEqual(status, 200)
                self.assertEqual(connected, {"connected": True})

                second_origin = "chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba"
                status, health, headers = request("GET", "/v1/health", token, second_origin)
                self.assertEqual(status, 200)
                self.assertTrue(health["ok"])
                self.assertEqual(headers["Access-Control-Allow-Origin"], second_origin)
            finally:
                server.shutdown()
                server.server_close()
                state.shutdown_event.set()
                state.worker.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
