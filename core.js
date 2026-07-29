(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BiliSubtitleCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const BVID_RE = /^BV[0-9A-Za-z]{10}$/;

  function isValidBvid(value) {
    return BVID_RE.test(String(value || ""));
  }

  function videoUrl(bvid, page) {
    const url = new URL(`https://www.bilibili.com/video/${bvid}`);
    if (Number(page) > 1) url.searchParams.set("p", String(page));
    return url.toString();
  }

  function dedupeUnits(units) {
    const seen = new Set();
    return units
      .filter((unit) => {
        const key = `${unit.bvid}:${unit.cid}`;
        if (!isValidBvid(unit.bvid) || !Number.isSafeInteger(unit.cid) || unit.cid <= 0 || seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      })
      .map((unit, index) => ({ ...unit, index: index + 1 }));
  }

  function unitFromPage(bvid, page, fallbackTitle, sectionTitle) {
    const pageNo = Number(page && page.page) || 1;
    return {
      bvid,
      cid: Number(page && page.cid),
      title: String((page && page.part) || fallbackTitle || bvid),
      page: pageNo,
      duration: Number(page && page.duration) || 0,
      sectionTitle: String(sectionTitle || ""),
      sourceUrl: videoUrl(bvid, pageNo)
    };
  }

  function getVideoUnits(metadata) {
    if (!metadata || !isValidBvid(metadata.bvid)) return [];
    const pages = Array.isArray(metadata.pages) && metadata.pages.length
      ? metadata.pages
      : [{ cid: metadata.cid, page: 1, part: metadata.title }];
    return dedupeUnits(pages.map((page) => unitFromPage(metadata.bvid, page, metadata.title)));
  }

  function getSeasonUnits(metadata) {
    const sections = metadata && metadata.ugc_season && Array.isArray(metadata.ugc_season.sections)
      ? metadata.ugc_season.sections
      : [];
    const units = [];

    for (const section of sections) {
      for (const episode of Array.isArray(section.episodes) ? section.episodes : []) {
        const bvid = episode.bvid;
        if (!isValidBvid(bvid)) continue;
        let pages = Array.isArray(episode.pages) && episode.pages.length ? episode.pages : [];
        if (!pages.length && episode.page) pages = [episode.page];
        if (!pages.length && episode.cid) {
          pages = [{ cid: episode.cid, page: 1, part: episode.title }];
        }
        for (const page of pages) {
          const pageTitle = String(page.part || "");
          const episodeTitle = String(episode.title || "");
          const title = pageTitle && episodeTitle && pageTitle !== episodeTitle
            ? `${episodeTitle} / ${pageTitle}`
            : pageTitle || episodeTitle;
          units.push({ ...unitFromPage(bvid, page, title, section.title), title });
        }
      }
    }
    return dedupeUnits(units);
  }

  function getPlaybackCid(entries, bvid) {
    const resources = Array.isArray(entries) ? entries : [];
    for (let index = resources.length - 1; index >= 0; index -= 1) {
      const raw = typeof resources[index] === "string" ? resources[index] : resources[index] && resources[index].name;
      try {
        const url = new URL(raw);
        if (url.hostname !== "api.bilibili.com" || !/^\/x\/player\/(?:wbi\/)?playurl$/.test(url.pathname)) continue;
        const resourceBvid = url.searchParams.get("bvid");
        if (resourceBvid && resourceBvid !== bvid) continue;
        const cid = Number(url.searchParams.get("cid"));
        if (Number.isSafeInteger(cid) && cid > 0) return cid;
      } catch (_error) {
        // Ignore unrelated or malformed performance entries.
      }
    }
    return 0;
  }

  function getCurrentUnit(metadata, href, playbackCid) {
    const units = getVideoUnits(metadata);
    if (!units.length) return null;
    const liveCid = Number(playbackCid);
    if (Number.isSafeInteger(liveCid) && liveCid > 0) {
      const playing = units.find((unit) => unit.cid === liveCid);
      if (playing) return playing;
    }
    let url;
    try {
      url = new URL(href);
    } catch (_error) {
      return units[0];
    }
    const cid = Number(url.searchParams.get("cid"));
    if (Number.isSafeInteger(cid) && cid > 0) {
      const byCid = units.find((unit) => unit.cid === cid);
      if (byCid) return byCid;
    }
    const page = Number(url.searchParams.get("p"));
    if (Number.isSafeInteger(page) && page > 0) {
      const byPage = units.find((unit) => unit.page === page);
      if (byPage) return byPage;
    }
    const metadataCid = Number(metadata && metadata.cid);
    return units.find((unit) => unit.cid === metadataCid) || units[0];
  }

  function isChineseTrack(track) {
    const text = `${track.lan || ""} ${track.lan_doc || ""}`;
    return /(^|\s)(zh(?:-|_|\b)|ai-zh)/i.test(text) || /中文|汉语|简体|繁体/.test(text);
  }

  function isAiTrack(track) {
    const text = `${track.lan || ""} ${track.lan_doc || ""}`;
    return Number(track.ai_type) > 0 || /^ai-/i.test(String(track.lan || "")) || /AI|自动生成|自动字幕/i.test(text);
  }

  function normalizeTrack(track) {
    if (!track) return null;
    const url = track.subtitle_url || track.subtitle_url_v2 || "";
    if (!url) return null;
    return {
      lan: String(track.lan || "unknown"),
      lanDoc: String(track.lan_doc || track.lan || "未知语言"),
      isAi: isAiTrack(track),
      source: isAiTrack(track) ? "bili-ai" : "bili-manual",
      url: String(url)
    };
  }

  function chooseSubtitleTrack(tracks) {
    const ranked = (Array.isArray(tracks) ? tracks : [])
      .map((track, order) => ({ track, order }))
      .filter(({ track }) => track && (track.subtitle_url_v2 || track.subtitle_url))
      .map(({ track, order }) => ({
        track,
        order,
        score: isChineseTrack(track) ? (isAiTrack(track) ? 1 : 0) : (isAiTrack(track) ? 3 : 2)
      }))
      .sort((a, b) => a.score - b.score || a.order - b.order);
    return ranked.length ? normalizeTrack(ranked[0].track) : null;
  }

  function normalizeCues(payload) {
    const body = payload && Array.isArray(payload.body) ? payload.body : [];
    return body.flatMap((cue) => {
      const content = String(cue && cue.content != null ? cue.content : "").trim();
      const from = Number(cue && cue.from);
      const to = Number(cue && cue.to);
      if (!content || !Number.isFinite(from) || from < 0) return [];
      return [{ from, to: Number.isFinite(to) ? to : from, content }];
    });
  }

  function isSuspiciousCoverage(duration, cues) {
    const videoDuration = Number(duration) || 0;
    if (videoDuration < 120 || !Array.isArray(cues) || !cues.length) return false;
    const subtitleEnd = Math.max(...cues.map((cue) => Number(cue.to) || Number(cue.from) || 0));
    return subtitleEnd < 30 && subtitleEnd < videoDuration * 0.05;
  }

  function mergeCues(cues, options) {
    const settings = {
      gapSeconds: 1.8,
      maxSeconds: 30,
      maxChars: 180,
      ...(options || {})
    };
    const source = Array.isArray(cues) ? cues : [];
    const paragraphs = [];
    let current = null;

    function flush() {
      if (current) paragraphs.push(current);
      current = null;
    }

    for (const cue of source) {
      const content = String(cue && cue.content || "").trim();
      if (!content) continue;
      const from = Number(cue.from) || 0;
      const to = Number(cue.to) || from;
      if (!current) {
        current = { from, to, content };
        continue;
      }
      const gap = Math.max(0, from - current.to);
      const span = to - current.from;
      const endsSentence = /[。！？!?；;]$/.test(current.content);
      const tooLong = current.content.length + content.length > settings.maxChars;
      if (gap >= settings.gapSeconds || span > settings.maxSeconds || endsSentence || tooLong) {
        flush();
        current = { from, to, content };
        continue;
      }
      const separator = /[A-Za-z0-9]$/.test(current.content) && /^[A-Za-z0-9]/.test(content) ? " " : "";
      current.content += `${separator}${content}`;
      current.to = Math.max(current.to, to);
    }
    flush();
    return paragraphs;
  }

  function formatTimestamp(seconds) {
    const whole = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(whole / 3600);
    const minutes = Math.floor((whole % 3600) / 60);
    const secs = whole % 60;
    return [hours, minutes, secs].map((value) => String(value).padStart(2, "0")).join(":");
  }

  function timestampUrl(unit, seconds) {
    const url = new URL(unit.sourceUrl);
    url.searchParams.set("t", String(Math.max(0, Math.floor(Number(seconds) || 0))));
    return url.toString();
  }

  function escapeMarkdown(value) {
    return String(value == null ? "" : value)
      .replace(/\r?\n|\r/g, " ")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\\/g, "\\\\")
      .replace(/\[/g, "\\[")
      .replace(/\]/g, "\\]")
      .trim();
  }

  function escapeTable(value) {
    return escapeMarkdown(value).replace(/\|/g, "\\|");
  }

  function sanitizeFilename(value) {
    const cleaned = String(value || "Bilibili")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
      .replace(/[.\s]+$/g, "")
      .trim();
    const safe = (cleaned || "Bilibili").slice(0, 120);
    return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe) ? `_${safe}` : safe;
  }

  function buildMarkdown({ title, sourceUrl, exportedAt, results, failures, options, cancelled }) {
    const successful = Array.isArray(results) ? results : [];
    const failed = Array.isArray(failures) ? failures : [];
    const exportOptions = options || {};
    const lines = [
      `# ${escapeMarkdown(title || "Bilibili 字幕")}`,
      "",
      `- 来源：${sourceUrl}`,
      `- 导出时间：${escapeMarkdown(exportedAt || new Date().toLocaleString("zh-CN"))}`,
      `- 结果：成功 ${successful.length} 集，跳过/失败 ${failed.length} 集${cancelled ? "（任务已取消）" : ""}`,
      `- 排版：${exportOptions.mergeParagraphs ? "合并自然段" : "逐条字幕"}`,
      ""
    ];

    for (const result of successful) {
      const unit = result.unit;
      lines.push(
        `## ${String(unit.index).padStart(3, "0")}. ${escapeMarkdown(unit.title)}`,
        "",
        `- 视频：[${unit.bvid}](${unit.sourceUrl}) · CID ${unit.cid}`,
        `- 字幕：${escapeMarkdown(result.track.source === "whisper" ? (result.track.lanDoc || "本机 Whisper") : `${result.track.isAi ? "B站AI字幕" : "B站人工字幕"} · ${result.track.lanDoc}`)}`,
        ""
      );
      for (const cue of result.cues) {
        lines.push(`[${formatTimestamp(cue.from)}](${timestampUrl(unit, cue.from)}) ${escapeMarkdown(cue.content)}`);
      }
      lines.push("");
    }

    if (failed.length) {
      lines.push("## 未导出的分集", "", "| 序号 | 标题 | 原因 | 详情 |", "| ---: | --- | --- | --- |");
      for (const failure of failed) {
        lines.push(`| ${failure.unit.index} | ${escapeTable(failure.unit.title)} | ${escapeTable(failure.reason)} | ${escapeTable(failure.detail || "-")} |`);
      }
      lines.push("");
    }
    return `${lines.join("\n").trimEnd()}\n`;
  }

  return {
    isValidBvid,
    getVideoUnits,
    getSeasonUnits,
    getPlaybackCid,
    getCurrentUnit,
    chooseSubtitleTrack,
    normalizeCues,
    isSuspiciousCoverage,
    mergeCues,
    formatTimestamp,
    timestampUrl,
    escapeMarkdown,
    sanitizeFilename,
    buildMarkdown
  };
});
