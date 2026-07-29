"use strict";

importScripts("helper-config.js");
try {
  importScripts("helper-token.js");
} catch (_error) {
  // Optional file generated locally by install-helper.ps1.
}

const BVID_RE = /^BV[0-9A-Za-z]{10}$/;
const JOB_ID_RE = /^[0-9a-f]{32}$/;
const WHISPER_MODELS = new Set(["tiny", "base", "small"]);
const API_ROOT = "https://api.bilibili.com";
const HELPER_ORIGIN = "http://127.0.0.1:17891";
const HELPER_CONFIG = globalThis.BILI_WHISPER_HELPER || {};
const INSTALLED_HELPER_TOKEN = String(globalThis.BILI_WHISPER_TOKEN || "");
let helperToken = "";
let helperConnected = false;

class RequestError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status || 0;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function validateSender(sender) {
  const raw = sender.url || (sender.tab && sender.tab.url) || "";
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && url.hostname === "www.bilibili.com" && url.pathname.startsWith("/video/");
  } catch (_error) {
    return false;
  }
}

function validateBvid(value) {
  const bvid = String(value || "");
  if (!BVID_RE.test(bvid)) throw new RequestError("INVALID_BVID", "无效的 BV 号");
  return bvid;
}

function validateCid(value) {
  const cid = Number(value);
  if (!Number.isSafeInteger(cid) || cid <= 0) throw new RequestError("INVALID_CID", "无效的 CID");
  return cid;
}

function validateSubtitleUrl(value) {
  const raw = String(value || "");
  let url;
  try {
    url = new URL(raw.startsWith("//") ? `https:${raw}` : raw);
  } catch (_error) {
    throw new RequestError("INVALID_SUBTITLE_URL", "无效的字幕地址");
  }
  if (url.protocol === "http:") url.protocol = "https:";
  const allowedHost = url.hostname === "hdslb.com" || url.hostname.endsWith(".hdslb.com");
  if (url.protocol !== "https:" || !allowedHost) {
    throw new RequestError("INVALID_SUBTITLE_URL", "字幕地址不属于允许的 Bilibili CDN");
  }
  return url.toString();
}

async function fetchOnce(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok) {
      throw new RequestError(`HTTP_${response.status}`, `请求失败（HTTP ${response.status}）`, response.status);
    }
    try {
      return await response.json();
    } catch (_error) {
      throw new RequestError("INVALID_JSON", "服务器返回了无法解析的数据");
    }
  } catch (error) {
    if (error.name === "AbortError") throw new RequestError("TIMEOUT", "请求超时");
    if (error instanceof RequestError) throw error;
    throw new RequestError("NETWORK", error.message || "网络请求失败");
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url) {
  try {
    return await fetchOnce(url);
  } catch (error) {
    const retryable = error.code === "NETWORK" || error.code === "TIMEOUT" || error.status === 429 || error.status >= 500;
    if (!retryable) throw error;
    await sleep(2000);
    return fetchOnce(url);
  }
}

async function fetchApi(path, params) {
  const url = new URL(path, API_ROOT);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const payload = await fetchJson(url.toString());
  if (!payload || payload.code !== 0) {
    const code = payload && payload.code != null ? payload.code : "UNKNOWN";
    throw new RequestError(`BILI_${code}`, (payload && payload.message) || `Bilibili 接口错误（${code}）`);
  }
  return payload.data;
}

function validatePage(value) {
  const page = Number(value);
  if (!Number.isSafeInteger(page) || page <= 0 || page > 10000) {
    throw new RequestError("INVALID_PAGE", "无效的分P序号");
  }
  return page;
}

function validateJobId(value) {
  const jobId = String(value || "");
  if (!JOB_ID_RE.test(jobId)) throw new RequestError("INVALID_JOB_ID", "无效的本机任务编号");
  return jobId;
}

function validateWhisperModel(value) {
  const model = String(value || "");
  if (!WHISPER_MODELS.has(model)) throw new RequestError("INVALID_MODEL", "不支持的 Whisper 模型");
  return model;
}

function helperReady() {
  return HELPER_CONFIG.endpoint === HELPER_ORIGIN;
}

async function connectHelper() {
  if (helperConnected) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const challengeResponse = await fetch(`${HELPER_ORIGIN}/v1/handshake`, {
      cache: "no-store",
      signal: controller.signal
    });
    const challenge = await challengeResponse.json();
    if (!challengeResponse.ok || !challenge || challenge.token_required !== true) {
      throw new RequestError("HELPER_HANDSHAKE", "本机助手握手失败，请重新运行安装脚本");
    }
    if (!/^[0-9a-f]{64}$/.test(INSTALLED_HELPER_TOKEN)) {
      throw new RequestError("HELPER_TOKEN_MISSING", "未找到本机助手令牌，请运行当前扩展目录中的 install-helper.ps1 后重新加载扩展");
    }
    const verifyResponse = await fetch(`${HELPER_ORIGIN}/v1/handshake`, {
      method: "POST",
      headers: { "X-Bili-Helper-Token": INSTALLED_HELPER_TOKEN },
      cache: "no-store",
      signal: controller.signal
    });
    const verification = await verifyResponse.json();
    if (!verifyResponse.ok || !verification || verification.connected !== true) {
      throw new RequestError("HELPER_AUTH", verification && verification.error || "本机助手令牌验证失败，请重新运行安装脚本");
    }
    helperToken = INSTALLED_HELPER_TOKEN;
    helperConnected = true;
  } catch (error) {
    if (error.name === "AbortError") throw new RequestError("HELPER_TIMEOUT", "本机助手响应超时");
    if (error instanceof RequestError) throw error;
    throw new RequestError("HELPER_UNAVAILABLE", "无法连接免费的本机 Whisper 助手，请确认已安装并正在运行");
  } finally {
    clearTimeout(timeout);
  }
}

function validateHelperPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new RequestError("INVALID_JOB", "无效的本机转写任务");
  }
  const bvid = validateBvid(payload.bvid);
  if (!Array.isArray(payload.units) || !payload.units.length || payload.units.length > 500) {
    throw new RequestError("INVALID_JOB", "本机转写队列必须包含 1–500 个分P");
  }
  const units = payload.units.map((unit) => ({
    bvid: unit && validateBvid(unit.bvid),
    cid: unit && validateCid(unit.cid),
    page: unit && validatePage(unit.page),
    index: unit && validatePage(unit.index || unit.page),
    title: String(unit && unit.title || "").slice(0, 500),
    duration: Math.max(0, Math.min(Number(unit && unit.duration) || 0, 86400))
  }));
  return {
    bvid,
    title: String(payload.title || bvid).slice(0, 500),
    model: validateWhisperModel(payload.model),
    units,
    context: payload.context && typeof payload.context === "object" ? payload.context : {}
  };
}

async function helperFetch(path, options) {
  if (!helperReady()) {
    throw new RequestError("HELPER_NOT_INSTALLED", "尚未安装本机 Whisper 助手，请运行扩展目录中的 install-helper.ps1");
  }
  await connectHelper();
  const url = new URL(path, HELPER_ORIGIN);
  if (url.origin !== HELPER_ORIGIN) throw new RequestError("INVALID_HELPER_PATH", "无效的本机助手路径");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options && options.timeout || 10000);
  try {
    const response = await fetch(url.toString(), {
      method: options && options.method || "GET",
      headers: {
        "X-Bili-Helper-Token": helperToken,
        ...(options && options.body ? { "Content-Type": "application/json" } : {})
      },
      body: options && options.body ? JSON.stringify(options.body) : undefined,
      cache: "no-store",
      signal: controller.signal
    });
    let payload;
    try {
      payload = await response.json();
    } catch (_error) {
      throw new RequestError("HELPER_INVALID_JSON", "本机助手返回了无法解析的数据", response.status);
    }
    if (!response.ok || !payload || !payload.ok) {
      if (response.status === 401 && !(options && options.authRetried)) {
        helperToken = "";
        helperConnected = false;
        return helperFetch(path, { ...(options || {}), authRetried: true });
      }
      throw new RequestError("HELPER_ERROR", payload && payload.error || `本机助手错误（HTTP ${response.status}）`, response.status);
    }
    return payload.data;
  } catch (error) {
    if (error.name === "AbortError") throw new RequestError("HELPER_TIMEOUT", "本机助手响应超时");
    if (error instanceof RequestError) throw error;
    throw new RequestError("HELPER_UNAVAILABLE", "无法连接免费的本机 Whisper 助手，请确认已安装并正在运行");
  } finally {
    clearTimeout(timeout);
  }
}

async function handleMessage(message, sender) {
  if (!validateSender(sender)) throw new RequestError("INVALID_SENDER", "请求来源不受信任");
  if (!message || typeof message.action !== "string") throw new RequestError("INVALID_MESSAGE", "无效请求");

  if (message.action === "getVideoMetadata") {
    return fetchApi("/x/web-interface/view", { bvid: validateBvid(message.bvid) });
  }
  if (message.action === "getSubtitleMetadata") {
    return fetchApi("/x/player/wbi/v2", {
      bvid: validateBvid(message.bvid),
      cid: validateCid(message.cid)
    });
  }
  if (message.action === "getSubtitleBody") {
    return fetchJson(validateSubtitleUrl(message.url));
  }
  if (message.action === "helperHealth") {
    return helperFetch("/v1/health", { timeout: 4000 });
  }
  if (message.action === "helperCreateJob") {
    return helperFetch("/v1/jobs", { method: "POST", body: validateHelperPayload(message.payload), timeout: 20000 });
  }
  if (message.action === "helperGetJob") {
    const suffix = message.includeResults ? "?includeResults=1" : "";
    return helperFetch(`/v1/jobs/${validateJobId(message.jobId)}${suffix}`, { timeout: 10000 });
  }
  if (message.action === "helperGetActiveJob") {
    return helperFetch(`/v1/jobs/active?bvid=${encodeURIComponent(validateBvid(message.bvid))}`, { timeout: 5000 });
  }
  if (message.action === "helperCancelJob") {
    return helperFetch(`/v1/jobs/${validateJobId(message.jobId)}/cancel`, { method: "POST", body: {}, timeout: 10000 });
  }
  throw new RequestError("UNKNOWN_ACTION", "不支持的请求类型");
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({
      ok: false,
      error: {
        code: error.code || "UNKNOWN",
        message: error.message || "未知错误",
        status: error.status || 0
      }
    }));
  return true;
});
