"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const core = require("./core.js");

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "manifest.json"), "utf8"));
const workerSource = fs.readFileSync(path.join(__dirname, "service-worker.js"), "utf8");
const contentSource = fs.readFileSync(path.join(__dirname, "content.js"), "utf8");
const helperSource = fs.readFileSync(path.join(__dirname, "helper", "whisper_helper.py"), "utf8");
const requirements = fs.readFileSync(path.join(__dirname, "helper", "requirements.txt"), "utf8");
const installerSource = fs.readFileSync(path.join(__dirname, "install-helper.ps1"), "utf8");
const uninstallerSource = fs.readFileSync(path.join(__dirname, "uninstall-helper.ps1"), "utf8");
const gitignoreSource = fs.readFileSync(path.join(__dirname, ".gitignore"), "utf8");
const readmeSource = fs.readFileSync(path.join(__dirname, "README.md"), "utf8");
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.version, "1.3.1");
assert.equal(manifest.author, "Pond");
assert.deepEqual(manifest.icons, {
  16: "icons/icon-16.png",
  32: "icons/icon-32.png",
  48: "icons/icon-48.png",
  128: "icons/icon-128.png"
});
for (const size of [16, 32, 48, 128]) {
  const png = fs.readFileSync(path.join(__dirname, manifest.icons[size]));
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), size);
  assert.equal(png.readUInt32BE(20), size);
}
assert.deepEqual(manifest.permissions, ["storage"]);
assert.deepEqual(manifest.host_permissions, [
  "https://api.bilibili.com/*",
  "https://*.hdslb.com/*",
  "http://127.0.0.1:17891/*"
]);
assert.match(workerSource, /\/x\/player\/wbi\/v2/);
assert.match(workerSource, /helperCreateJob/);
assert.match(workerSource, /helperGetActiveJob/);
assert.match(workerSource, /authRetried/);
assert.match(workerSource, /127\.0\.0\.1:17891/);
assert.match(workerSource, /importScripts\("helper-token\.js"\)/);
assert.match(workerSource, /\/v1\/handshake/);
assert.match(workerSource, /token_required/);
assert.match(workerSource, /verification\.connected/);
assert.doesNotMatch(workerSource, /\/v1\/pair|X-Bili-Extension-Origin|chrome\.runtime\.getURL/);
assert.match(workerSource, /WHISPER_MODELS = new Set\(\["tiny", "base", "small"\]\)/);
assert.match(workerSource, /model: validateWhisperModel\(payload\.model\)/);
assert.doesNotMatch(workerSource, /correctTranscript|api\.openai\.com|api\.deepseek\.com|localhost:11434/);
assert.match(contentSource, /选择分P批量导出/);
assert.match(contentSource, /每个分P一个 MD/);
assert.match(contentSource, /P\$\{unit\.page\}/);
assert.match(contentSource, /合并自然段/);
assert.match(contentSource, /免费本机补齐/);
assert.match(contentSource, /正在扫描B站字幕/);
assert.match(contentSource, /<select class="model-select"/);
assert.match(contentSource, /<option value="tiny">tiny/);
assert.match(contentSource, /<option value="base">base/);
assert.match(contentSource, /<option value="small" selected>small/);
assert.match(contentSource, /chrome\.storage\.local\.get/);
assert.match(contentSource, /chrome\.storage\.local\.set/);
assert.match(contentSource, /Object\.hasOwn\(WHISPER_MODEL_DETAILS/);
assert.match(contentSource, /model: selectedModel/);
assert.match(contentSource, /ui\.modelSelect\.disabled = true/);
assert.match(contentSource, /health\.supportedModels/);
assert.match(contentSource, /install-helper\.ps1/);
assert.match(contentSource, /WHISPER LIVE/);
assert.match(contentSource, /color-scheme: dark/);
assert.match(contentSource, /--blue: #7de8ff/);
assert.match(contentSource, /linear-gradient\(145deg, #07143f/);
assert.match(contentSource, /button:focus-visible, input:focus-visible, select:focus-visible/);
assert.match(contentSource, /模型 \/ 设备/);
assert.match(contentSource, /已用时间/);
assert.match(contentSource, /预计剩余/);
assert.match(contentSource, /Date\.parse\(job\.createdAt/);
assert.match(contentSource, /GPU CUDA/);
assert.match(contentSource, /CPU int8/);
assert.match(contentSource, /job\.etaSeconds/);
assert.match(contentSource, /transcribing: "识别字幕（分段更新）"/);
assert.doesNotMatch(contentSource, /await wait\(2000\)/);
assert.match(contentSource, /未成功导出的分P/);
assert.match(contentSource, /renderFailures\(failures\)/);
assert.match(contentSource, /failure\.unit\.sourceUrl/);
assert.match(contentSource, /只重试失败项/);
assert.match(contentSource, /retryFailedUnits/);
assert.match(contentSource, /const results = \[\.\.\.cachedResults\]/);
assert.match(contentSource, /cached\.units\.filter/);
assert.doesNotMatch(contentSource, /AI 纠错|ai-enable|ai-endpoint/);
assert.match(helperSource, /HOST = "127\.0\.0\.1"/);
assert.match(helperSource, /language="zh"/);
assert.match(helperSource, /vad_filter=vad_available/);
assert.match(helperSource, /APP_VERSION = "1\.3\.1"/);
assert.match(helperSource, /server_version = "BiliWhisper\/1\.3\.1"/);
assert.match(helperSource, /SUPPORTED_MODELS = \("tiny", "base", "small"\)/);
assert.match(helperSource, /HF_HUB_DISABLE_XET", "1"/);
assert.match(helperSource, /MODEL_FILES = \("config\.json", "model\.bin", "tokenizer\.json", "vocabulary\.txt"\)/);
assert.match(helperSource, /MODEL_BIN_BYTES = \{/);
assert.match(helperSource, /action="append"/);
assert.match(helperSource, /nargs="\?"/);
assert.match(helperSource, /dict\.fromkeys\(arguments\.prepare_model\)/);
assert.match(helperSource, /modelscope\.cn\/models\/Systran\/faster-whisper-/);
assert.match(helperSource, /--retry-all-errors/);
assert.match(helperSource, /--speed-time/);
assert.match(helperSource, /validate_model\(payload\.get\("model"\)\)/);
assert.match(helperSource, /cache_name\(unit, model_name\)/);
assert.match(helperSource, /"token_required": True/);
assert.match(helperSource, /"connected": True/);
assert.match(helperSource, /return token_matches\(provided, expected\)/);
assert.doesNotMatch(helperSource, /extensionOrigin|pairUntil|X-Bili-Extension-Origin|def pair\(/);
assert.doesNotMatch(helperSource, /cookies_from_browser|cookiefile|api\.openai\.com|api\.deepseek\.com/);
assert.match(installerSource, /helper-token\.js/);
assert.match(installerSource, /BILI_WHISPER_TOKEN/);
assert.match(installerSource, /\[string\[\]\]\$Models = @\("tiny", "base", "small"\)/);
assert.match(installerSource, /Minor -ge 10 -and \$details\.Minor -le 12/);
assert.match(installerSource, /Bits -ne "64bit"/);
assert.match(installerSource, /import compileall, ensurepip/);
assert.match(installerSource, /\[IO\.DriveInfo\]::new/);
assert.match(installerSource, /--prepare-model", \$modelName/);
assert.ok(
  installerSource.indexOf("$pythonDetails = Resolve-CompatiblePython") <
    installerSource.indexOf("if (Test-Path -LiteralPath $configPath)"),
  "Python must be validated before the running helper is stopped"
);
assert.match(uninstallerSource, /helper-token\.js/);
assert.match(gitignoreSource, /\/helper-token\.js/);
assert.match(requirements, /faster-whisper==1\.2\.1/);
assert.match(requirements, /ctranslate2==4\.6\.0/);
assert.match(requirements, /numpy==1\.26\.4/);
assert.match(requirements, /setuptools==80\.9\.0/);
assert.match(requirements, /yt-dlp==2026\.7\.4/);
assert.match(readmeSource, /当前版本：`1\.3\.1`/);
assert.match(readmeSource, /64 位 Python 3\.10–3\.12/);
assert.match(readmeSource, /-Models tiny,base/);
assert.match(readmeSource, /-SkipModelDownload/);

const pages = Array.from({ length: 164 }, (_, index) => ({
  cid: 1594645068 + index,
  page: index + 1,
  part: `课程 ${index + 1}`
}));
const metadata = {
  bvid: "BV1qW4y1a7fU",
  cid: pages[0].cid,
  title: "Python 课程",
  pages
};

const units = core.getVideoUnits(metadata);
assert.equal(units.length, 164);
assert.equal(units[0].title, "课程 1");
assert.equal(units[163].page, 164);
assert.equal(core.getCurrentUnit(metadata, `https://www.bilibili.com/video/BV1qW4y1a7fU?p=3`).cid, pages[2].cid);
assert.equal(core.getCurrentUnit(metadata, `https://www.bilibili.com/video/BV1qW4y1a7fU?cid=${pages[8].cid}`).page, 9);
assert.equal(core.getCurrentUnit(metadata, "https://www.bilibili.com/video/BV1qW4y1a7fU?cid=999999999").page, 1);
const resources = [
  { name: `https://api.bilibili.com/x/player/wbi/playurl?bvid=BV1qW4y1a7fU&cid=${pages[0].cid}` },
  { name: `https://api.bilibili.com/x/player/wbi/playurl?bvid=BV1qW4y1a7fU&cid=${pages[3].cid}` }
];
const playbackCid = core.getPlaybackCid(resources, metadata.bvid);
assert.equal(playbackCid, pages[3].cid);
assert.equal(core.getCurrentUnit(metadata, `https://www.bilibili.com/video/BV1qW4y1a7fU?cid=${pages[0].cid}`, playbackCid).page, 4);
assert.equal(core.getPlaybackCid([{ name: "https://example.com/x/player/playurl?cid=4" }], metadata.bvid), 0);

const seasonUnits = core.getSeasonUnits({
  ugc_season: {
    sections: [
      {
        title: "基础",
        episodes: [
          { bvid: "BV1Z54y1d7KY", title: "第一集", pages: [{ cid: 1, page: 1, part: "第一集" }] },
          {
            bvid: "BV1Fv4y1w7JJ",
            title: "第二集",
            pages: [
              { cid: 2, page: 1, part: "上" },
              { cid: 3, page: 2, part: "下" },
              { cid: 3, page: 2, part: "重复项" }
            ]
          }
        ]
      }
    ]
  }
});
assert.equal(seasonUnits.length, 3);
assert.equal(seasonUnits[1].title, "第二集 / 上");
assert.match(seasonUnits[2].sourceUrl, /p=2/);

const track = core.chooseSubtitleTrack([
  { lan: "en-US", lan_doc: "English", subtitle_url: "//i0.hdslb.com/en.json", ai_type: 0 },
  { lan: "ai-zh", lan_doc: "中文（自动生成）", subtitle_url: "//i0.hdslb.com/ai.json", ai_type: 1 },
  { lan: "zh-CN", lan_doc: "中文", subtitle_url: "//i0.hdslb.com/zh.json", subtitle_url_v2: "//i0.hdslb.com/wrong.json", ai_type: 0 }
]);
assert.equal(track.lan, "zh-CN");
assert.equal(track.isAi, false);
assert.equal(track.source, "bili-manual");
assert.equal(track.url, "//i0.hdslb.com/zh.json");

const cues = core.normalizeCues({
  body: [
    { from: 0.4, to: 1.8, content: "第一句" },
    { from: 2, to: 3, content: "" },
    { from: 3, to: 4, content: "第二句" }
  ]
});
assert.equal(cues.length, 2);
assert.equal(core.formatTimestamp(3661.9), "01:01:01");
assert.equal(core.isSuspiciousCoverage(891, [{ from: 0, to: 9 }]), true);
assert.equal(core.isSuspiciousCoverage(891, [{ from: 0, to: 800 }]), false);
assert.equal(core.isSuspiciousCoverage(60, [{ from: 0, to: 5 }]), false);

const paragraphs = core.mergeCues([
  { from: 0, to: 1, content: "欢迎学习" },
  { from: 1.2, to: 2.2, content: "Python课程" },
  { from: 5, to: 6, content: "这是新的一段" },
  { from: 6.2, to: 7, content: "结束。" },
  { from: 7.1, to: 8, content: "下一段" }
]);
assert.equal(paragraphs.length, 3);
assert.equal(paragraphs[0].content, "欢迎学习Python课程");
assert.equal(paragraphs[1].content, "这是新的一段结束。");
assert.equal(paragraphs[2].from, 7.1);
assert.equal(core.mergeCues([
  { from: 0, to: 1, content: "Hello" },
  { from: 1.1, to: 2, content: "world" }
])[0].content, "Hello world");

const markdown = core.buildMarkdown({
  title: "课程 [测试]",
  sourceUrl: units[0].sourceUrl,
  exportedAt: "2026-07-28 12:00",
  results: [{ unit: units[0], track, cues }],
  failures: [{ unit: units[1], reason: "没有字幕", detail: "轨道为空 | 已跳过" }],
  options: { mergeParagraphs: true },
  cancelled: false
});
assert.ok(markdown.startsWith("# 课程 \\[测试\\]"));
assert.match(markdown, /\[00:00:00\]\(https:\/\/www\.bilibili\.com\/video\/BV1qW4y1a7fU\?t=0\)/);
assert.ok(markdown.includes("轨道为空 \\| 已跳过"));
assert.ok(markdown.includes("排版：合并自然段"));
assert.ok(markdown.includes("字幕：B站人工字幕 · 中文"));
assert.doesNotMatch(markdown, /AI纠错/);

for (const model of ["tiny", "base", "small"]) {
  const whisperMarkdown = core.buildMarkdown({
    title: "本机转写",
    sourceUrl: units[0].sourceUrl,
    results: [{ unit: units[0], track: { lanDoc: `本机 Whisper ${model}`, isAi: false, source: "whisper" }, cues }],
    failures: [],
    options: { mergeParagraphs: false }
  });
  assert.ok(whisperMarkdown.includes(`字幕：本机 Whisper ${model}`));
}
assert.equal(core.sanitizeFilename('A:B/C*D?'), "A_B_C_D_");
assert.equal(core.sanitizeFilename("CON"), "_CON");

console.log("core tests passed");
