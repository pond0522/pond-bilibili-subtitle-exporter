"""Local-only Bilibili audio transcription helper.

The HTTP surface is intentionally tiny, token protected, and bound to 127.0.0.1.
It accepts only validated BVID/page pairs and constructs Bilibili URLs itself.
"""

from __future__ import annotations

import argparse
import gc
import json
import logging
import os
import queue
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")


APP_VERSION = "1.3.0"
DEFAULT_MODEL = "small"
SUPPORTED_MODELS = ("tiny", "base", "small")
MODEL_FILES = ("config.json", "model.bin", "tokenizer.json", "vocabulary.txt")
MODEL_BIN_BYTES = {
    "tiny": 75_538_270,
    "base": 145_217_532,
    "small": 483_546_902,
}
MODEL_DOWNLOAD_URL = "https://modelscope.cn/models/Systran/faster-whisper-{model}/resolve/master/{filename}"
HOST = "127.0.0.1"
DEFAULT_PORT = 17891
BVID_RE = re.compile(r"^BV[0-9A-Za-z]{10}$")
EXTENSION_ORIGIN_RE = re.compile(r"^chrome-extension://[a-p]{32}$")
MAX_UNITS = 500
MAX_BODY = 32 * 1024 * 1024
TERMS_PROMPT = (
    "Python, PyCharm, pip, Conda, Anaconda, Jupyter, NumPy, Pandas, Matplotlib, "
    "Flask, Django, FastAPI, HTML, CSS, JavaScript, SQL, MySQL, Linux, Git, "
    "变量, 函数, 类, 对象, 模块, 包, 虚拟环境, 数据分析, 人工智能, 机器学习"
)


class ValidationError(ValueError):
    pass


def has_onnxruntime(importer=__import__) -> bool:
    try:
        importer("onnxruntime")
        return True
    except Exception:
        return False


def utc_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def default_root() -> Path:
    base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
    return Path(base) / "BiliSubtitleWhisper"


def atomic_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    for attempt in range(20):
        try:
            os.replace(temporary, path)
            return
        except PermissionError:
            if attempt == 19:
                raise
            time.sleep(0.1)


def read_json(path: Path, default=None):
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        return default


def validate_bvid(value: object) -> str:
    bvid = str(value or "")
    if not BVID_RE.fullmatch(bvid):
        raise ValidationError("无效的 BV 号")
    return bvid


def validate_model(value: object) -> str:
    model = str(value or DEFAULT_MODEL)
    if model not in SUPPORTED_MODELS:
        raise ValidationError("不支持的 Whisper 模型")
    return model


def token_matches(provided: object, expected: object) -> bool:
    expected_text = str(expected or "")
    return bool(expected_text) and secrets.compare_digest(str(provided or ""), expected_text)


def validate_positive_int(value: object, label: str, maximum: int | None = None) -> int:
    if isinstance(value, bool):
        raise ValidationError(f"无效的 {label}")
    try:
        result = int(value)
    except (TypeError, ValueError) as error:
        raise ValidationError(f"无效的 {label}") from error
    if result <= 0 or (maximum is not None and result > maximum):
        raise ValidationError(f"无效的 {label}")
    return result


def validate_unit(raw: object, _job_bvid: str) -> dict:
    if not isinstance(raw, dict):
        raise ValidationError("无效的分P数据")
    bvid = validate_bvid(raw.get("bvid"))
    cid = validate_positive_int(raw.get("cid"), "CID")
    page = validate_positive_int(raw.get("page"), "P号", 10000)
    duration = max(0, min(float(raw.get("duration") or 0), 24 * 3600))
    return {
        "bvid": bvid,
        "cid": cid,
        "page": page,
        "index": validate_positive_int(raw.get("index") or page, "序号", 10000),
        "title": str(raw.get("title") or f"P{page}")[:500],
        "duration": duration,
        "sourceUrl": f"https://www.bilibili.com/video/{bvid}?p={page}",
    }


def cache_name(unit: dict, model_name: str = DEFAULT_MODEL) -> str:
    return f"{unit['bvid']}_{unit['cid']}_{validate_model(model_name)}.json"


class LocalTranscriber:
    def __init__(self, root: Path, logger: logging.Logger):
        self.root = root
        self.logger = logger
        self.model = None
        self.model_name = ""
        self.device = "未加载"
        self.compute_type = ""
        self.model_error = ""
        self.model_lock = threading.Lock()

    def model_path(self, model_name: str) -> Path:
        model_name = validate_model(model_name)

        def is_complete(path: Path) -> bool:
            for filename in MODEL_FILES:
                file_path = path / filename
                if not file_path.is_file() or file_path.stat().st_size <= 0:
                    return False
                if filename == "model.bin" and file_path.stat().st_size != MODEL_BIN_BYTES[model_name]:
                    return False
            return True

        direct = self.root / "models" / f"faster-whisper-{model_name}"
        candidates = [direct]
        snapshots = self.root / "models" / f"models--Systran--faster-whisper-{model_name}" / "snapshots"
        if snapshots.is_dir():
            candidates.extend(path for path in snapshots.iterdir() if path.is_dir())
        for path in candidates:
            if is_complete(path):
                return path

        direct.mkdir(parents=True, exist_ok=True)
        curl = shutil.which("curl.exe") or shutil.which("curl")
        if not curl:
            raise RuntimeError("未找到 Windows curl，无法下载 Whisper 模型")
        for filename in MODEL_FILES:
            target = direct / filename
            expected_size = MODEL_BIN_BYTES[model_name] if filename == "model.bin" else None
            if target.is_file() and target.stat().st_size > 0 and (expected_size is None or target.stat().st_size == expected_size):
                continue
            partial = target.with_suffix(target.suffix + ".part")
            url = MODEL_DOWNLOAD_URL.format(model=model_name, filename=filename)
            self.logger.info("下载 Whisper %s：%s", model_name, filename)
            completed = subprocess.run(
                [curl, "--fail", "--location", "--silent", "--show-error", "--retry", "10", "--retry-all-errors", "--retry-delay", "2", "--speed-limit", "1024", "--speed-time", "30", "--continue-at", "-", "--output", str(partial), url],
                capture_output=True,
                text=True,
                timeout=1800,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            if completed.returncode != 0:
                raise RuntimeError(f"Whisper {model_name} 下载失败：{completed.stderr.strip()[-500:]}")
            if expected_size is not None and partial.stat().st_size != expected_size:
                raise RuntimeError(
                    f"Whisper {model_name} model.bin size mismatch: "
                    f"expected {expected_size}, got {partial.stat().st_size}"
                )
            os.replace(partial, target)
        if not is_complete(direct):
            raise RuntimeError(f"Whisper {model_name} model files are incomplete")
        return direct

    def load_model(self, model_name=DEFAULT_MODEL):
        model_name = validate_model(model_name)
        with self.model_lock:
            if self.model is not None and self.model_name == model_name:
                return self.model
            if self.model is not None:
                self.model = None
                self.model_name = ""
                gc.collect()
            try:
                import ctranslate2
                from faster_whisper import WhisperModel

                has_gpu = ctranslate2.get_cuda_device_count() > 0
                device = "cuda" if has_gpu else "cpu"
                compute_type = "float16" if has_gpu else "int8"
                model_path = self.model_path(model_name)
                try:
                    model = WhisperModel(
                        str(model_path),
                        device=device,
                        compute_type=compute_type,
                    )
                except Exception:
                    if device != "cuda":
                        raise
                    self.logger.exception("GPU 模型加载失败，改用 CPU int8")
                    device, compute_type = "cpu", "int8"
                    model = WhisperModel(
                        str(model_path),
                        device=device,
                        compute_type=compute_type,
                    )
                self.model = model
                self.model_name = model_name
                self.device = device
                self.compute_type = compute_type
                self.model_error = ""
                return model
            except Exception as error:
                self.model_error = str(error)
                raise

    def download_audio(self, unit: dict, temp_dir: Path, progress_hook=None) -> Path:
        from yt_dlp import YoutubeDL

        url = f"https://www.bilibili.com/video/{unit['bvid']}?p={unit['page']}"
        template = str(temp_dir / "audio.%(ext)s")
        options = {
            "format": "bestaudio/best",
            "outtmpl": template,
            "noplaylist": True,
            "quiet": True,
            "no_warnings": True,
            "socket_timeout": 30,
            "retries": 2,
            "fragment_retries": 2,
            "continuedl": True,
        }
        if progress_hook:
            def report_download(data):
                if data.get("status") == "finished":
                    progress_hook("downloading", 100)
                    return
                if data.get("status") != "downloading":
                    return
                total = float(data.get("total_bytes") or data.get("total_bytes_estimate") or 0)
                downloaded = float(data.get("downloaded_bytes") or 0)
                progress_hook("downloading", round(downloaded / total * 100) if total > 0 else 0)
            options["progress_hooks"] = [report_download]
        with YoutubeDL(options) as downloader:
            info = downloader.extract_info(url, download=True)
            candidates = info.get("requested_downloads") or []
            filename = candidates[0].get("filepath") if candidates else downloader.prepare_filename(info)
        path = Path(filename).resolve()
        root = temp_dir.resolve()
        if root not in path.parents or not path.is_file():
            matches = [candidate.resolve() for candidate in temp_dir.glob("audio.*") if candidate.is_file()]
            if not matches:
                raise RuntimeError("公开音频下载完成但未找到临时文件")
            path = matches[0]
        return path

    def transcribe(self, audio_path: Path, cancel_check, progress_hook=None, duration=0, model_name=DEFAULT_MODEL) -> list[dict]:
        if progress_hook:
            progress_hook("loading_model", 0)
        model = self.load_model(model_name)
        if progress_hook:
            progress_hook("transcribing", 0)
        vad_available = has_onnxruntime()
        if not vad_available:
            self.logger.warning("onnxruntime 无法加载，关闭 VAD 后继续转写")
        segments, _info = model.transcribe(
            str(audio_path),
            language="zh",
            beam_size=5,
            vad_filter=vad_available,
            initial_prompt=TERMS_PROMPT,
            condition_on_previous_text=True,
        )
        cues = []
        for segment in segments:
            if cancel_check():
                raise InterruptedError("任务已取消")
            content = str(segment.text or "").strip()
            if content:
                cues.append({
                    "from": max(0.0, float(segment.start)),
                    "to": max(float(segment.start), float(segment.end)),
                    "content": content,
                })
            if progress_hook:
                total = max(float(duration or 0), float(getattr(_info, "duration", 0) or 0), 1.0)
                progress_hook("transcribing", min(99, round(float(segment.end) / total * 100)))
        if not cues:
            raise RuntimeError("Whisper 未识别出有效文本")
        if progress_hook:
            progress_hook("transcribing", 100)
        return cues


class HelperState:
    def __init__(self, root: Path, config: dict, transcriber=None):
        self.root = root
        self.config = config
        self.config_path = root / "config.json"
        self.jobs_dir = root / "jobs"
        self.results_dir = root / "results"
        self.temp_dir = root / "temp"
        for directory in (self.jobs_dir, self.results_dir, self.temp_dir, root / "models", root / "logs"):
            directory.mkdir(parents=True, exist_ok=True)
        self.logger = logging.getLogger("bili-whisper")
        self.transcriber = transcriber or LocalTranscriber(root, self.logger)
        self.lock = threading.RLock()
        self.job_queue: queue.Queue[str] = queue.Queue()
        self.jobs: dict[str, dict] = {}
        self.shutdown_event = threading.Event()
        self._load_jobs()
        self.worker = threading.Thread(target=self._worker_loop, name="whisper-worker", daemon=True)
        self.worker.start()

    def _job_path(self, job_id: str) -> Path:
        return self.jobs_dir / f"{job_id}.json"

    def _save(self, job: dict) -> None:
        job["updatedAt"] = utc_now()
        atomic_json(self._job_path(job["id"]), job)

    def _load_jobs(self) -> None:
        for path in sorted(self.jobs_dir.glob("*.json")):
            job = read_json(path)
            if not isinstance(job, dict) or not job.get("id"):
                continue
            try:
                job["model"] = validate_model(job.get("model"))
            except ValidationError:
                continue
            if job.get("status") in {"running", "queued"}:
                job["status"] = "queued"
                job["current"] = None
                job["progress"] = {"phase": "queued", "percent": 0}
                for item in job.get("items", []):
                    if item.get("status") == "running":
                        item["status"] = "pending"
                atomic_json(path, job)
            self.jobs[job["id"]] = job
        for job in sorted(self.jobs.values(), key=lambda item: item.get("createdAt", "")):
            if job.get("status") == "queued":
                self.job_queue.put(job["id"])

    def create_job(self, payload: object) -> dict:
        if not isinstance(payload, dict):
            raise ValidationError("无效的任务数据")
        bvid = validate_bvid(payload.get("bvid"))
        model_name = validate_model(payload.get("model"))
        raw_units = payload.get("units")
        if not isinstance(raw_units, list) or not raw_units or len(raw_units) > MAX_UNITS:
            raise ValidationError(f"转写队列必须包含 1–{MAX_UNITS} 个分P")
        units = [validate_unit(raw, bvid) for raw in raw_units]
        seen = set()
        unique_units = []
        for unit in units:
            key = f"{unit['bvid']}:{unit['cid']}"
            if key not in seen:
                seen.add(key)
                unique_units.append(unit)
        units = unique_units
        with self.lock:
            for job in self.jobs.values():
                if job.get("bvid") == bvid and job.get("status") in {"queued", "running"}:
                    return self.public_job(job, False)
            now = utc_now()
            job_id = uuid.uuid4().hex
            job = {
                "id": job_id,
                "version": APP_VERSION,
                "bvid": bvid,
                "title": str(payload.get("title") or bvid)[:500],
                "model": model_name,
                "status": "queued",
                "createdAt": now,
                "updatedAt": now,
                "cancelRequested": False,
                "current": None,
                "progress": {"phase": "queued", "percent": 0},
                "workElapsed": 0.0,
                "processedDuration": 0.0,
                "context": payload.get("context") if isinstance(payload.get("context"), dict) else {},
                "items": [{"unit": unit, "status": "pending", "error": "", "cues": []} for unit in units],
            }
            self.jobs[job_id] = job
            self._save(job)
            self.job_queue.put(job_id)
            return self.public_job(job, False)

    def get_job(self, job_id: str) -> dict:
        if not re.fullmatch(r"[0-9a-f]{32}", job_id or ""):
            raise ValidationError("无效的任务编号")
        with self.lock:
            job = self.jobs.get(job_id)
            if not job:
                raise KeyError("未找到任务")
            return job

    def active_job(self, bvid: str) -> dict | None:
        validate_bvid(bvid)
        with self.lock:
            candidates = [job for job in self.jobs.values() if job.get("bvid") == bvid and isinstance(job.get("context"), dict) and job.get("context")]
            return max(candidates, key=lambda job: job.get("createdAt", "")) if candidates else None

    def cancel(self, job_id: str) -> dict:
        with self.lock:
            job = self.get_job(job_id)
            if job.get("status") in {"queued", "running"}:
                job["cancelRequested"] = True
                self._save(job)
            return self.public_job(job, False)

    def public_job(self, job: dict, include_results: bool) -> dict:
        items = job.get("items", [])
        completed = sum(item.get("status") == "success" for item in items)
        failed = sum(item.get("status") == "failed" for item in items)
        finished = completed + failed
        total_duration = sum(float(item.get("unit", {}).get("duration") or 0) for item in items)
        remaining_duration = sum(float(item.get("unit", {}).get("duration") or 0) for item in items if item.get("status") in {"pending", "running"})
        processed_duration = float(job.get("processedDuration") or 0)
        work_elapsed = float(job.get("workElapsed") or 0)
        eta = round(remaining_duration * work_elapsed / processed_duration) if processed_duration > 0 else None
        public = {
            "id": job["id"],
            "bvid": job["bvid"],
            "title": job.get("title", ""),
            "model": validate_model(job.get("model")),
            "status": job.get("status"),
            "createdAt": job.get("createdAt"),
            "updatedAt": job.get("updatedAt"),
            "total": len(items),
            "completed": completed,
            "failed": failed,
            "finished": finished,
            "totalDuration": total_duration,
            "etaSeconds": eta,
            "current": job.get("current"),
            "progress": job.get("progress") or {"phase": "queued", "percent": 0},
            "fatalError": job.get("fatalError", ""),
            "device": getattr(self.transcriber, "device", "test"),
        }
        if include_results:
            public["context"] = job.get("context", {})
            public["items"] = items
        return public

    def health(self) -> dict:
        loaded_model = str(getattr(self.transcriber, "model_name", "") or "")
        return {
            "version": APP_VERSION,
            "model": loaded_model or DEFAULT_MODEL,
            "defaultModel": DEFAULT_MODEL,
            "supportedModels": list(SUPPORTED_MODELS),
            "loadedModel": loaded_model or None,
            "modelStatus": "error" if getattr(self.transcriber, "model_error", "") else ("ready" if getattr(self.transcriber, "model", None) is not None else "installed"),
            "modelError": getattr(self.transcriber, "model_error", ""),
            "device": getattr(self.transcriber, "device", "未加载"),
            "activeJobs": sum(job.get("status") in {"queued", "running"} for job in self.jobs.values()),
            "freeLocalOnly": True,
        }

    def _worker_loop(self) -> None:
        while not self.shutdown_event.is_set():
            try:
                job_id = self.job_queue.get(timeout=0.5)
            except queue.Empty:
                continue
            try:
                self._run_job(job_id)
            except Exception as error:
                self.logger.exception("任务处理发生未捕获错误")
                with self.lock:
                    job = self.jobs.get(job_id)
                    if job and job.get("status") in {"queued", "running"}:
                        job["status"] = "failed"
                        job["current"] = None
                        job["fatalError"] = str(error)[:1000]
                        job["progress"] = {"phase": "failed", "percent": 0}
                        try:
                            self._save(job)
                        except Exception:
                            self.logger.exception("失败状态无法写入任务文件")
            finally:
                self.job_queue.task_done()

    def _run_job(self, job_id: str) -> None:
        with self.lock:
            job = self.jobs.get(job_id)
            if not job or job.get("status") != "queued":
                return
            if job.get("cancelRequested"):
                job["status"] = "cancelled"
                self._save(job)
                return
            job["status"] = "running"
            job["progress"] = {"phase": "preparing", "percent": 0}
            self._save(job)

        for item in job.get("items", []):
            with self.lock:
                if job.get("cancelRequested"):
                    break
                if item.get("status") not in {"pending", "running"}:
                    continue
                unit = item["unit"]
                model_name = validate_model(job.get("model"))
                item["status"] = "running"
                job["current"] = unit
                job["progress"] = {"phase": "preparing", "percent": 0}
                self._save(job)

            started = time.monotonic()
            temp = self.temp_dir / f"{job_id}-{unit['cid']}"
            try:
                cache_path = self.results_dir / cache_name(unit, model_name)
                cached = read_json(cache_path)
                if isinstance(cached, dict) and isinstance(cached.get("cues"), list) and cached["cues"]:
                    with self.lock:
                        job["progress"] = {"phase": "cached", "percent": 100}
                    cues = cached["cues"]
                else:
                    temp.mkdir(parents=True, exist_ok=True)
                    def update_progress(phase, percent):
                        with self.lock:
                            job["progress"] = {
                                "phase": str(phase),
                                "percent": max(0, min(100, int(percent or 0))),
                            }
                            job["updatedAt"] = utc_now()

                    audio = self.transcriber.download_audio(unit, temp, update_progress)
                    cues = self.transcriber.transcribe(
                        audio,
                        lambda: bool(job.get("cancelRequested")),
                        update_progress,
                        unit.get("duration") or 0,
                        model_name,
                    )
                    atomic_json(cache_path, {"unit": unit, "model": model_name, "createdAt": utc_now(), "cues": cues})
                elapsed = time.monotonic() - started
                with self.lock:
                    item.update({"status": "success", "error": "", "cues": cues, "elapsedSeconds": elapsed})
                    job["processedDuration"] = float(job.get("processedDuration") or 0) + float(unit.get("duration") or 0)
                    job["workElapsed"] = float(job.get("workElapsed") or 0) + elapsed
                    self._save(job)
            except InterruptedError:
                with self.lock:
                    item["status"] = "pending"
                    item["error"] = "任务已取消"
                    self._save(job)
                break
            except Exception as error:
                elapsed = time.monotonic() - started
                self.logger.exception("P%s 转写失败", unit.get("page"))
                with self.lock:
                    item.update({"status": "failed", "error": str(error)[:1000], "cues": [], "elapsedSeconds": elapsed})
                    job["processedDuration"] = float(job.get("processedDuration") or 0) + float(unit.get("duration") or 0)
                    job["workElapsed"] = float(job.get("workElapsed") or 0) + elapsed
                    self._save(job)
            finally:
                shutil.rmtree(temp, ignore_errors=True)

        with self.lock:
            job["current"] = None
            job["status"] = "cancelled" if job.get("cancelRequested") else "completed"
            job["progress"] = {"phase": job["status"], "percent": 100}
            self._save(job)


class ApiHandler(BaseHTTPRequestHandler):
    server_version = "BiliWhisper/1.3"

    def log_message(self, message, *args):
        self.server.state.logger.info("%s - %s", self.client_address[0], message % args)

    def _headers(self, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        origin = self.headers.get("Origin", "")
        if EXTENSION_ORIGIN_RE.fullmatch(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Bili-Helper-Token")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def _json(self, status, value):
        self._headers(status)
        self.wfile.write(json.dumps(value, ensure_ascii=False).encode("utf-8"))

    def _authorized(self) -> bool:
        provided = self.headers.get("X-Bili-Helper-Token", "")
        expected = str(self.server.state.config.get("token") or "")
        return token_matches(provided, expected)

    def _require_auth(self) -> bool:
        if self._authorized():
            return True
        self._json(401, {"ok": False, "error": "本机助手令牌无效，请重新运行安装脚本"})
        return False

    def _body(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as error:
            raise ValidationError("无效的请求长度") from error
        if length <= 0 or length > MAX_BODY:
            raise ValidationError("请求数据为空或过大")
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ValidationError("无效的 JSON") from error

    def do_OPTIONS(self):
        if not EXTENSION_ORIGIN_RE.fullmatch(self.headers.get("Origin", "")):
            return self._json(403, {"ok": False, "error": "不允许的网页来源"})
        self._headers(204)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/v1/handshake":
            return self._json(200, {"token_required": True})
        if not self._require_auth():
            return
        try:
            if parsed.path == "/v1/health":
                return self._json(200, {"ok": True, "data": self.server.state.health()})
            if parsed.path == "/v1/jobs/active":
                bvid = (parse_qs(parsed.query).get("bvid") or [""])[0]
                job = self.server.state.active_job(bvid)
                return self._json(200, {"ok": True, "data": self.server.state.public_job(job, False) if job else None})
            match = re.fullmatch(r"/v1/jobs/([0-9a-f]{32})", parsed.path)
            if match:
                include = (parse_qs(parsed.query).get("includeResults") or ["0"])[0] == "1"
                job = self.server.state.get_job(match.group(1))
                return self._json(200, {"ok": True, "data": self.server.state.public_job(job, include)})
            return self._json(404, {"ok": False, "error": "未找到接口"})
        except ValidationError as error:
            return self._json(400, {"ok": False, "error": str(error)})
        except KeyError as error:
            return self._json(404, {"ok": False, "error": str(error)})
        except Exception as error:
            self.server.state.logger.exception("GET 请求失败")
            return self._json(500, {"ok": False, "error": str(error)})

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/v1/handshake":
            if self._require_auth():
                return self._json(200, {"connected": True})
            return
        if not self._require_auth():
            return
        try:
            if parsed.path == "/v1/jobs":
                result = self.server.state.create_job(self._body())
                return self._json(201, {"ok": True, "data": result})
            match = re.fullmatch(r"/v1/jobs/([0-9a-f]{32})/cancel", parsed.path)
            if match:
                result = self.server.state.cancel(match.group(1))
                return self._json(200, {"ok": True, "data": result})
            if parsed.path == "/v1/shutdown":
                self._json(200, {"ok": True, "data": {"stopping": True}})
                self.server.state.shutdown_event.set()
                threading.Thread(target=self.server.shutdown, daemon=True).start()
                return
            return self._json(404, {"ok": False, "error": "未找到接口"})
        except ValidationError as error:
            return self._json(400, {"ok": False, "error": str(error)})
        except KeyError as error:
            return self._json(404, {"ok": False, "error": str(error)})
        except Exception as error:
            self.server.state.logger.exception("POST 请求失败")
            return self._json(500, {"ok": False, "error": str(error)})


def configure_logging(root: Path) -> None:
    log_path = root / "logs" / "helper.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=[logging.FileHandler(log_path, encoding="utf-8")],
    )


def load_config(path: Path) -> dict:
    config = read_json(path)
    if not isinstance(config, dict) or not config.get("token"):
        raise RuntimeError(f"本机助手配置无效：{path}")
    port = int(config.get("port") or DEFAULT_PORT)
    if not 1024 <= port <= 65535:
        raise RuntimeError("本机助手端口无效")
    config["port"] = port
    return config


def main(argv=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, default=default_root() / "config.json")
    parser.add_argument("--prepare-model", action="store_true")
    parser.add_argument("--serve", action="store_true")
    arguments = parser.parse_args(argv)
    config = load_config(arguments.config)
    root = arguments.config.resolve().parent
    configure_logging(root)
    transcriber = LocalTranscriber(root, logging.getLogger("bili-whisper"))
    if arguments.prepare_model:
        transcriber.load_model(DEFAULT_MODEL)
        print(f"Whisper {DEFAULT_MODEL} ready ({transcriber.device}/{transcriber.compute_type})")
        return 0
    if not arguments.serve:
        parser.error("请使用 --serve 或 --prepare-model")
    state = HelperState(root, config, transcriber)
    server = ThreadingHTTPServer((HOST, config["port"]), ApiHandler)
    server.state = state
    logging.getLogger("bili-whisper").info("本机助手启动于 http://%s:%s", HOST, config["port"])
    try:
        server.serve_forever(poll_interval=0.5)
    finally:
        state.shutdown_event.set()
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
