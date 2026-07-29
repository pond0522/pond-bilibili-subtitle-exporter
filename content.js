(function () {
  "use strict";

  if (document.getElementById("bili-subtitle-exporter-host")) return;
  const core = globalThis.BiliSubtitleCore;
  if (!core) return;
  const DEFAULT_WHISPER_MODEL = "small";
  const WHISPER_MODEL_DETAILS = Object.freeze({
    tiny: "最快，准确率较低；首次使用会自动下载模型。",
    base: "速度与准确率平衡；首次使用会自动下载模型。",
    small: "更准确、CPU 耗时更长；首次使用会自动下载模型。"
  });

  const CSS = `
    :host { all: initial; color-scheme: dark; }
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    button, input, select { font: inherit; }
    .panel {
      --blue: #00aeec;
      --blue-dark: #0079a8;
      --pink: #fb7299;
      --ink: #182532;
      --muted: #687887;
      --line: #dce5eb;
      position: fixed;
      z-index: 2147483646;
      top: 112px;
      right: 18px;
      width: 380px;
      max-height: calc(100vh - 136px);
      overflow: hidden;
      color: var(--ink);
      background: #fbfdff;
      border: 1px solid #cfdce4;
      border-radius: 14px;
      box-shadow: 0 14px 42px rgb(25 50 70 / 18%);
      font: 14px/1.5 "Microsoft YaHei UI", "PingFang SC", system-ui, sans-serif;
      transition: width 160ms ease;
    }
    .panel::before {
      content: "";
      position: absolute;
      inset: 0 auto 0 0;
      width: 6px;
      background: repeating-linear-gradient(to bottom, var(--blue) 0 2px, transparent 2px 9px);
      opacity: .72;
    }
    .panel[data-collapsed="true"] { width: 48px; }
    .panel[data-collapsed="true"] .body,
    .panel[data-collapsed="true"] .heading-copy { display: none; }
    .panel[data-collapsed="true"] .header { min-height: 148px; padding: 12px 8px; justify-content: center; }
    .panel[data-collapsed="true"] .collapse { writing-mode: vertical-rl; height: auto; }
    .header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 17px 16px 14px 20px; border-bottom: 1px solid var(--line); }
    .eyebrow { color: var(--blue-dark); font: 700 11px/1.2 ui-monospace, Consolas, monospace; letter-spacing: .12em; text-transform: uppercase; }
    h1 { margin: 4px 0 0; font-size: 17px; line-height: 1.3; letter-spacing: -.02em; }
    .collapse { min-width: 32px; height: 32px; padding: 0 8px; color: var(--muted); background: #fff; border: 1px solid var(--line); border-radius: 8px; cursor: pointer; }
    .collapse:hover { color: var(--blue-dark); border-color: #9bcfe2; }
    .body { max-height: calc(100vh - 212px); overflow: auto; padding: 15px 16px 16px 20px; scrollbar-width: thin; }
    .context { margin: 0 0 13px; color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
    .actions { display: grid; gap: 8px; }
    .action { width: 100%; min-height: 42px; padding: 9px 12px; text-align: left; color: var(--ink); background: #fff; border: 1px solid var(--line); border-radius: 10px; cursor: pointer; }
    .action strong { display: block; font-size: 14px; }
    .action span { display: block; margin-top: 1px; color: var(--muted); font-size: 11px; }
    .action:hover:not(:disabled) { border-color: var(--blue); box-shadow: inset 3px 0 var(--blue); }
    .action:disabled { cursor: not-allowed; opacity: .48; }
    .picker, .options { margin-top: 12px; padding: 11px; background: #fff; border: 1px solid var(--line); border-radius: 10px; }
    .picker-head, .picker-tools { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .picker-search { width: 100%; min-height: 34px; padding: 6px 9px; color: var(--ink); background: #fbfdff; border: 1px solid #ccdce5; border-radius: 8px; outline: none; }
    .picker-search { margin-top: 9px; }
    .picker-search:focus { border-color: var(--blue); box-shadow: 0 0 0 3px rgb(0 174 236 / 12%); }
    .picker-tools { justify-content: flex-start; flex-wrap: wrap; margin: 8px 0; }
    .text-button { padding: 2px 4px; color: var(--blue-dark); background: transparent; border: 0; cursor: pointer; font-size: 12px; }
    .selected-count { margin-left: auto; color: var(--muted); font: 700 11px/1 ui-monospace, Consolas, monospace; }
    .picker-list { max-height: 210px; overflow: auto; border-block: 1px solid #edf2f5; scrollbar-width: thin; }
    .pick-item { display: grid; grid-template-columns: auto 32px 1fr auto; align-items: center; gap: 7px; min-height: 42px; padding: 6px 3px; border-bottom: 1px solid #edf2f5; cursor: pointer; }
    .pick-item:last-child { border-bottom: 0; }
    .pick-item:hover { background: #f5fbfd; }
    .pick-index, .pick-duration { color: var(--muted); font: 11px/1 ui-monospace, Consolas, monospace; }
    .pick-main { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .file-mode { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; margin-top: 9px; }
    .file-mode label { display: flex; align-items: center; gap: 6px; padding: 7px; color: var(--muted); background: #f7fafc; border: 1px solid #e1eaf0; border-radius: 8px; cursor: pointer; font-size: 11px; }
    .file-mode input { accent-color: var(--blue-dark); }
    .selected-run { width: 100%; margin-top: 9px; color: #fff; background: var(--blue-dark); border: 1px solid var(--blue-dark); }
    .options-title { margin-bottom: 8px; color: var(--blue-dark); font: 700 11px/1 ui-monospace, Consolas, monospace; letter-spacing: .08em; text-transform: uppercase; }
    .option-row { display: grid; grid-template-columns: auto 1fr; align-items: start; gap: 8px; padding: 5px 0; cursor: pointer; }
    .option-row input { margin-top: 3px; accent-color: var(--blue-dark); }
    .option-copy strong, .option-copy span { display: block; }
    .option-copy span { color: var(--muted); font-size: 11px; }
    .fallback-card { margin-top: 14px; padding: 12px; background: #fffaf4; border: 1px solid #eadbc8; border-radius: 10px; }
    .fallback-title { color: #8a5a1f; font: 700 11px/1 ui-monospace, Consolas, monospace; letter-spacing: .08em; text-transform: uppercase; }
    .scan-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 10px; }
    .scan-stat { padding: 8px 5px; text-align: center; background: #fff; border: 1px solid #eee3d5; border-radius: 8px; }
    .scan-stat strong, .scan-stat span { display: block; }
    .scan-stat strong { color: var(--ink); font: 700 16px/1 ui-monospace, Consolas, monospace; }
    .scan-stat span { margin-top: 4px; color: var(--muted); font-size: 10px; }
    .fallback-detail { margin: 9px 0 0; color: var(--muted); font-size: 11px; }
    .model-field { display: grid; gap: 5px; margin-top: 10px; }
    .model-label { color: var(--blue-dark); font: 700 11px/1.2 ui-monospace, Consolas, monospace; letter-spacing: .06em; text-transform: uppercase; }
    .model-select { width: 100%; min-height: 44px; padding: 8px 10px; color: var(--ink); background: #fff; border: 1px solid #d8c8b5; border-radius: 9px; cursor: pointer; outline: none; }
    .model-help { color: var(--muted); font-size: 11px; }
    .confirm-actions { display: grid; grid-template-columns: 1fr 1.4fr; gap: 7px; margin-top: 10px; }
    .secondary { color: var(--ink); background: #fff; border: 1px solid #d8c8b5; }
    .whisper-start { color: #fff; background: #8a5a1f; border: 1px solid #8a5a1f; }
    .helper-note { margin: 8px 0 0; color: #8a5a1f; font-size: 10px; overflow-wrap: anywhere; }
    .run-card { margin-top: 14px; padding: 12px; background: #f2f7fa; border: 1px solid #dbe8ee; border-radius: 10px; }
    .status-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .status { font-weight: 700; }
    .counter { color: var(--blue-dark); font: 700 12px/1 ui-monospace, Consolas, monospace; }
    .progress { height: 5px; margin-top: 10px; overflow: hidden; background: #dce7ed; border-radius: 999px; }
    .progress > i { display: block; width: 0; height: 100%; background: var(--blue); transition: width 180ms ease; }
    .detail { min-height: 36px; margin: 9px 0 0; color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
    .whisper-live { position: relative; isolation: isolate; margin-top: 10px; padding: 11px; overflow: hidden; color: #eefbff; background: linear-gradient(135deg, #07143f, #111966 64%, #24106f); border: 1px solid #526fff; border-radius: 10px; box-shadow: inset 0 0 28px rgb(54 193 255 / 10%); }
    .whisper-live::before { content: ""; position: absolute; z-index: -1; inset: -40% -20%; background: radial-gradient(circle, rgb(28 201 255 / 20%), transparent 55%); }
    .whisper-live-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .whisper-kicker { color: #7de8ff; font: 700 10px/1 ui-monospace, Consolas, monospace; letter-spacing: .12em; }
    .whisper-phase { padding: 3px 7px; color: #061438; background: #7de8ff; border-radius: 999px; font-size: 10px; font-weight: 800; white-space: nowrap; }
    .whisper-unit { display: block; margin-top: 9px; overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
    .whisper-metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 9px; }
    .whisper-metric { min-width: 0; padding: 7px 8px; background: rgb(255 255 255 / 8%); border: 1px solid rgb(145 218 255 / 16%); border-radius: 7px; }
    .whisper-metric small, .whisper-metric b { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .whisper-metric small { color: #9db4d6; font-size: 9px; }
    .whisper-metric b { margin-top: 3px; color: #fff; font: 700 11px/1.2 ui-monospace, Consolas, monospace; }
    .whisper-overall { margin: 8px 0 0; color: #a9c7e8; font-size: 10px; }
    .failure-card { margin-top: 10px; overflow: hidden; background: #fff7f9; border: 1px solid #efc5d1; border-radius: 9px; }
    .failure-card summary { display: flex; align-items: center; gap: 8px; padding: 9px 10px; color: #7d3048; cursor: pointer; font-weight: 700; list-style: none; }
    .failure-card summary::-webkit-details-marker { display: none; }
    .failure-card summary::before { content: "▸"; flex: none; transition: transform 150ms ease; }
    .failure-card[open] summary::before { transform: rotate(90deg); }
    .failure-card summary span { flex: 1; }
    .failure-count { min-width: 24px; padding: 1px 6px; border-radius: 999px; background: #a84763; color: #fff; text-align: center; font-size: 11px; }
    .failure-list { max-height: 190px; overflow: auto; padding: 0 7px 7px; scrollbar-width: thin; }
    .failure-item { display: grid; grid-template-columns: 38px minmax(0, 1fr); gap: 8px; align-items: center; padding: 8px; border-top: 1px solid #f3dce3; background: #fff; color: var(--ink); text-decoration: none; }
    .failure-item:first-child { border-radius: 7px 7px 0 0; }
    .failure-item:last-child { border-radius: 0 0 7px 7px; }
    .failure-item:hover { background: #fff0f4; }
    .failure-index { color: #a84763; font-weight: 800; font-size: 12px; }
    .failure-copy { min-width: 0; display: grid; gap: 2px; }
    .failure-copy strong, .failure-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .failure-copy strong { font-size: 12px; }
    .failure-copy small { color: var(--muted); font-size: 11px; }
    .footer { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; }
    .small-button { min-height: 36px; padding: 7px 10px; border-radius: 9px; cursor: pointer; }
    .cancel { color: #8c3c53; background: #fff; border: 1px solid #efc5d1; }
    .download { color: #fff; background: var(--blue-dark); border: 1px solid var(--blue-dark); }
    .failure-retry { width: calc(100% - 14px); margin: 0 7px 7px; color: #fff; background: #a84763; border: 1px solid #a84763; }
    .small-button:disabled, input:disabled, select:disabled { cursor: not-allowed; opacity: .42; }
    .notice { margin: 12px 0 0; padding-left: 9px; color: var(--muted); border-left: 2px solid var(--pink); font-size: 11px; }

    .panel {
      --blue: #7de8ff;
      --blue-dark: #55cbff;
      --pink: #9a55ff;
      --ink: #eefbff;
      --muted: #9db4d6;
      --line: rgb(125 232 255 / 18%);
      background: radial-gradient(circle at 18% 8%, rgb(28 201 255 / 14%), transparent 28%), radial-gradient(circle at 88% 82%, rgb(154 85 255 / 18%), transparent 32%), linear-gradient(145deg, #07143f, #0b174c 58%, #160d55);
      border-color: #526fff;
      box-shadow: 0 16px 48px rgb(3 8 35 / 42%), inset 0 0 34px rgb(54 193 255 / 5%);
    }
    .header { background: rgb(5 12 47 / 74%); }
    h1 { color: #fff; }
    .collapse { color: var(--muted); background: rgb(255 255 255 / 7%); border-color: var(--line); }
    .collapse:hover { color: var(--blue); background: rgb(125 232 255 / 10%); border-color: var(--blue); }
    .body { scrollbar-color: #526fff rgb(255 255 255 / 6%); }
    .action, .picker, .options, .run-card { color: var(--ink); background: rgb(255 255 255 / 6%); border-color: var(--line); }
    .action:hover:not(:disabled) { background: rgb(125 232 255 / 9%); border-color: var(--blue); box-shadow: inset 3px 0 var(--blue); }
    .picker-search { color: var(--ink); background: rgb(2 9 38 / 64%); border-color: var(--line); }
    .picker-search::placeholder { color: #7188ad; }
    .picker-search:focus { border-color: var(--blue); box-shadow: 0 0 0 3px rgb(125 232 255 / 13%); }
    .picker-list { border-color: var(--line); scrollbar-color: #526fff rgb(255 255 255 / 6%); }
    .pick-item { border-color: var(--line); }
    .pick-item:hover { background: rgb(125 232 255 / 8%); }
    .file-mode label { color: var(--muted); background: rgb(2 9 38 / 48%); border-color: var(--line); }
    .file-mode input, .option-row input { accent-color: var(--blue); }
    .selected-run, .download, .whisper-start { color: #061438; background: linear-gradient(100deg, #7de8ff, #7488ff); border-color: #7de8ff; font-weight: 800; }
    .fallback-card { background: linear-gradient(145deg, rgb(38 32 105 / 70%), rgb(11 23 76 / 82%)); border-color: rgb(154 85 255 / 42%); }
    .fallback-title, .helper-note, .options-title, .text-button, .counter { color: var(--blue); }
    .scan-stat, .whisper-metric { background: rgb(255 255 255 / 8%); border-color: var(--line); }
    .secondary { color: var(--ink); background: rgb(255 255 255 / 7%); border-color: var(--line); }
    .model-select { color: var(--ink); background: rgb(2 9 38 / 64%); border-color: var(--line); }
    .progress { background: rgb(255 255 255 / 12%); }
    .progress > i { background: linear-gradient(90deg, #27d1ff, #8567ff); }
    .whisper-live { border-color: #7de8ff; box-shadow: 0 0 0 1px rgb(125 232 255 / 10%), inset 0 0 34px rgb(54 193 255 / 12%); }
    .failure-card { background: rgb(82 21 72 / 38%); border-color: rgb(255 106 167 / 38%); }
    .failure-card summary { color: #ffb2d0; }
    .failure-count { background: #c3427d; }
    .failure-item { color: var(--ink); background: rgb(255 255 255 / 6%); border-color: rgb(255 106 167 / 20%); }
    .failure-item:hover { background: rgb(255 106 167 / 10%); }
    .failure-index { color: #ff8cba; }
    .cancel { color: #ffb2c7; background: rgb(255 255 255 / 6%); border-color: rgb(255 122 170 / 55%); }
    .failure-retry { color: #fff; background: linear-gradient(100deg, #c3427d, #7d4de8); border-color: #d967a0; }
    .notice { border-color: var(--pink); }
    button:focus-visible, input:focus-visible, select:focus-visible, .failure-item:focus-visible { outline: 3px solid rgb(125 232 255 / 36%); outline-offset: 2px; }
    @media (max-width: 680px) {
      .panel { top: 72px; right: 8px; width: min(380px, calc(100vw - 16px)); max-height: calc(100vh - 88px); }
      .body { max-height: calc(100vh - 164px); }
    }
    @media (prefers-reduced-motion: reduce) { .panel, .progress > i { transition: none; } }
  `;

  const host = document.createElement("div");
  host.id = "bili-subtitle-exporter-host";
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = CSS;
  shadow.append(style);

  const panel = document.createElement("aside");
  panel.className = "panel";
  panel.dataset.collapsed = "false";
  panel.innerHTML = `
    <header class="header">
      <div class="heading-copy"><div class="eyebrow">Transcript rail</div><h1>Bilibili 字幕导出</h1></div>
      <button class="collapse" type="button" aria-label="收起面板">收起</button>
    </header>
    <div class="body">
      <p class="context">正在识别当前视频…</p>
      <div class="actions">
        <button class="action current" type="button" disabled><strong>当前分集</strong><span>识别中</span></button>
        <button class="action video" type="button" disabled><strong>本视频全部分P</strong><span>识别中</span></button>
        <button class="action custom" type="button" disabled><strong>选择分P批量导出</strong><span>识别中</span></button>
        <button class="action season" type="button" disabled><strong>整个合集</strong><span>当前视频不属于合集</span></button>
      </div>
      <section class="picker" hidden>
        <div class="picker-head"><strong>选择分P</strong><button class="text-button picker-close" type="button">关闭</button></div>
        <input class="picker-search" type="search" placeholder="搜索分P标题" aria-label="搜索分P标题">
        <div class="picker-tools">
          <button class="text-button select-visible" type="button">全选搜索结果</button>
          <button class="text-button clear-selected" type="button">清空</button>
          <span class="selected-count">已选 0</span>
        </div>
        <div class="picker-list"></div>
        <div class="file-mode" aria-label="分P文件输出方式">
          <label><input class="combined-mode" type="radio" name="bili-file-mode" checked>合并为一个 MD</label>
          <label><input class="split-mode" type="radio" name="bili-file-mode">每个分P一个 MD</label>
        </div>
        <button class="small-button selected-run" type="button" disabled>提取已选分P</button>
      </section>
      <section class="options">
        <div class="options-title">导出处理</div>
        <label class="option-row">
          <input class="merge" type="checkbox" checked>
          <span class="option-copy"><strong>合并自然段</strong><span>把连续字幕合并为更适合笔记的段落</span></span>
        </label>
      </section>
      <section class="fallback-card" hidden>
        <div class="fallback-title">扫描结果 · 本机补齐</div>
        <div class="scan-grid">
          <div class="scan-stat"><strong class="bili-count">0</strong><span>B站字幕</span></div>
          <div class="scan-stat"><strong class="whisper-count">0</strong><span>需Whisper</span></div>
          <div class="scan-stat"><strong class="blocked-count">0</strong><span>暂不可处理</span></div>
        </div>
        <p class="fallback-detail"></p>
        <label class="model-field">
          <span class="model-label">Whisper 模型</span>
          <select class="model-select" aria-describedby="bili-whisper-model-help">
            <option value="tiny">tiny · 最快</option>
            <option value="base">base · 平衡</option>
            <option value="small" selected>small · 更准确（默认）</option>
          </select>
          <span class="model-help" id="bili-whisper-model-help">更准确、CPU 耗时更长；首次使用会自动下载模型。</span>
        </label>
        <div class="confirm-actions">
          <button class="small-button secondary bili-only" type="button">仅导出B站字幕</button>
          <button class="small-button whisper-start" type="button">免费本机补齐</button>
        </div>
        <p class="helper-note">音频仅在本机处理；不使用 API 密钥，不上传，不产生费用。</p>
      </section>
      <section class="run-card" aria-live="polite">
        <div class="status-row"><span class="status">准备就绪</span><span class="counter">0 / 0</span></div>
        <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div>
        <p class="detail">选择上方范围开始提取。</p>
        <section class="whisper-live" hidden aria-label="Whisper 实时状态">
          <div class="whisper-live-head"><span class="whisper-kicker">WHISPER LIVE</span><span class="whisper-phase">等待</span></div>
          <strong class="whisper-unit">等待本机任务</strong>
          <div class="whisper-metrics">
            <span class="whisper-metric"><small>模型 / 设备</small><b class="whisper-device">small · 检测中</b></span>
            <span class="whisper-metric"><small>当前阶段进度</small><b class="whisper-unit-progress">0%</b></span>
            <span class="whisper-metric"><small>已用时间</small><b class="whisper-elapsed">00:00:00</b></span>
            <span class="whisper-metric"><small>预计剩余</small><b class="whisper-eta">首P后估算</b></span>
          </div>
          <p class="whisper-overall">整体 0 / 0</p>
        </section>
        <details class="failure-card" hidden>
          <summary><span>未成功导出的分P</span><strong class="failure-count">0</strong></summary>
          <div class="failure-list"></div>
          <button class="small-button failure-retry" type="button">只重试失败项</button>
        </details>
        <div class="footer">
          <button class="small-button cancel" type="button" disabled>取消</button>
          <button class="small-button download" type="button" disabled>下载 Markdown</button>
        </div>
      </section>
      <p class="notice">B站字幕优先；无字幕、空字幕或明显错配时可用免费本机 Whisper 模型补齐。登录与权限失败不会自动转写。</p>
    </div>`;
  shadow.append(panel);
  (document.body || document.documentElement).append(host);

  const $ = (selector) => panel.querySelector(selector);
  const ui = {
    collapse: $(".collapse"),
    context: $(".context"),
    current: $(".current"),
    video: $(".video"),
    custom: $(".custom"),
    season: $(".season"),
    picker: $(".picker"),
    pickerClose: $(".picker-close"),
    pickerSearch: $(".picker-search"),
    selectVisible: $(".select-visible"),
    clearSelected: $(".clear-selected"),
    selectedCount: $(".selected-count"),
    pickerList: $(".picker-list"),
    combinedMode: $(".combined-mode"),
    splitMode: $(".split-mode"),
    selectedRun: $(".selected-run"),
    merge: $(".merge"),
    fallbackCard: $(".fallback-card"),
    biliCount: $(".bili-count"),
    whisperCount: $(".whisper-count"),
    blockedCount: $(".blocked-count"),
    fallbackDetail: $(".fallback-detail"),
    modelSelect: $(".model-select"),
    modelHelp: $(".model-help"),
    biliOnly: $(".bili-only"),
    whisperStart: $(".whisper-start"),
    helperNote: $(".helper-note"),
    status: $(".status"),
    counter: $(".counter"),
    progress: $(".progress"),
    progressFill: $(".progress > i"),
    detail: $(".detail"),
    whisperLive: $(".whisper-live"),
    whisperPhase: $(".whisper-phase"),
    whisperUnit: $(".whisper-unit"),
    whisperDevice: $(".whisper-device"),
    whisperUnitProgress: $(".whisper-unit-progress"),
    whisperElapsed: $(".whisper-elapsed"),
    whisperEta: $(".whisper-eta"),
    whisperOverall: $(".whisper-overall"),
    failures: $(".failure-card"),
    failureCount: $(".failure-count"),
    failureList: $(".failure-list"),
    retryFailures: $(".failure-retry"),
    cancel: $(".cancel"),
    download: $(".download")
  };

  const state = {
    bvid: "",
    metadata: null,
    running: false,
    cancelled: false,
    markdown: "",
    filename: "",
    downloads: [],
    phase: "idle",
    pending: null,
    activeJobId: "",
    whisperModel: DEFAULT_WHISPER_MODEL,
    runSerial: 0,
    selectedKeys: new Set(),
    lastRun: null,
    lastHref: location.href,
    lastPlaybackCid: 0
  };

  function normalizeWhisperModel(value) {
    const model = String(value || "");
    return Object.hasOwn(WHISPER_MODEL_DETAILS, model) ? model : DEFAULT_WHISPER_MODEL;
  }

  function applyWhisperModel(value, persist) {
    const model = normalizeWhisperModel(value);
    state.whisperModel = model;
    ui.modelSelect.value = model;
    ui.modelHelp.textContent = WHISPER_MODEL_DETAILS[model];
    if (persist) chrome.storage.local.set({ whisperModel: model }).catch(() => {});
    return model;
  }

  async function restoreWhisperModel() {
    try {
      const saved = await chrome.storage.local.get("whisperModel");
      applyWhisperModel(saved.whisperModel, false);
    } catch (_error) {
      applyWhisperModel(DEFAULT_WHISPER_MODEL, false);
    }
  }

  function unitKey(unit) {
    return `${unit.bvid}:${unit.cid}`;
  }

  function setButton(button, count, detail, enabled) {
    button.querySelector("span").textContent = detail;
    button.disabled = !enabled;
    if (count != null) button.dataset.count = String(count);
  }

  function setProgress(done, total, status, detail, counterText) {
    const percent = total ? Math.round((done / total) * 100) : 0;
    ui.status.textContent = status;
    ui.counter.textContent = counterText || `${done} / ${total}`;
    ui.progress.setAttribute("aria-valuenow", String(percent));
    ui.progressFill.style.width = `${percent}%`;
    ui.detail.textContent = detail;
  }

  function extractBvid(href) {
    try {
      const match = new URL(href).pathname.match(/\/video\/(BV[0-9A-Za-z]{10})/);
      return match ? match[1] : "";
    } catch (_error) {
      return "";
    }
  }

  function playbackCid() {
    return core.getPlaybackCid(performance.getEntriesByType("resource"), state.bvid);
  }

  function currentUnit() {
    return core.getCurrentUnit(state.metadata, location.href, playbackCid());
  }

  function send(action, data) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action, ...data }, (response) => {
        if (chrome.runtime.lastError) {
          reject({ code: "EXTENSION", message: chrome.runtime.lastError.message });
          return;
        }
        if (!response || !response.ok) {
          reject((response && response.error) || { code: "UNKNOWN", message: "扩展后台没有返回结果" });
          return;
        }
        resolve(response.data);
      });
    });
  }

  function updateSelectionUi() {
    const total = state.metadata ? core.getVideoUnits(state.metadata).length : 0;
    ui.selectedCount.textContent = `已选 ${state.selectedKeys.size}`;
    ui.selectedRun.disabled = state.running || state.selectedKeys.size === 0;
    ui.custom.querySelector("span").textContent = `${state.selectedKeys.size} / ${total} 个分P已选`;
  }

  function filterPicker() {
    const query = ui.pickerSearch.value.trim().toLocaleLowerCase();
    for (const item of ui.pickerList.querySelectorAll(".pick-item")) {
      item.hidden = Boolean(query) && !item.dataset.search.includes(query);
    }
  }

  function renderPicker() {
    if (!state.metadata) return;
    const units = core.getVideoUnits(state.metadata);
    const validKeys = new Set(units.map(unitKey));
    for (const key of state.selectedKeys) {
      if (!validKeys.has(key)) state.selectedKeys.delete(key);
    }
    if (!state.selectedKeys.size) {
      const current = currentUnit();
      if (current) state.selectedKeys.add(unitKey(current));
    }

    ui.pickerList.replaceChildren();
    for (const unit of units) {
      const label = document.createElement("label");
      label.className = "pick-item";
      label.dataset.search = `${unit.index} ${unit.title}`.toLocaleLowerCase();
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = state.selectedKeys.has(unitKey(unit));
      checkbox.disabled = state.running;
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) state.selectedKeys.add(unitKey(unit));
        else state.selectedKeys.delete(unitKey(unit));
        updateSelectionUi();
      });
      const index = document.createElement("span");
      index.className = "pick-index";
      index.textContent = `P${unit.page}`;
      const title = document.createElement("span");
      title.className = "pick-main";
      title.textContent = unit.title;
      title.title = unit.title;
      const duration = document.createElement("span");
      duration.className = "pick-duration";
      duration.textContent = core.formatTimestamp(unit.duration).replace(/^00:/, "");
      label.append(checkbox, index, title, duration);
      ui.pickerList.append(label);
    }
    filterPicker();
    updateSelectionUi();
  }

  function refreshScopeButtons() {
    if (!state.metadata || state.running) return;
    const current = currentUnit();
    const videoUnits = core.getVideoUnits(state.metadata);
    const seasonUnits = core.getSeasonUnits(state.metadata);
    ui.context.textContent = current ? `${state.metadata.title} · 当前：${current.title}` : state.metadata.title;
    setButton(ui.current, current ? 1 : 0, current ? current.title : "无法识别当前分集", Boolean(current));
    setButton(ui.video, videoUnits.length, `${videoUnits.length} 个分P`, videoUnits.length > 0);
    setButton(ui.custom, videoUnits.length, `${state.selectedKeys.size} / ${videoUnits.length} 个分P已选`, videoUnits.length > 0);
    setButton(ui.season, seasonUnits.length, seasonUnits.length ? `${seasonUnits.length} 个分集/分P` : "当前视频不属于合集", seasonUnits.length > 0);
  }

  function setBusy(busy) {
    [ui.current, ui.video, ui.custom, ui.season].forEach((button) => { button.disabled = busy; });
    [ui.pickerSearch, ui.selectVisible, ui.clearSelected, ui.combinedMode, ui.splitMode]
      .forEach((control) => { control.disabled = busy; });
    ui.merge.disabled = busy;
    ui.retryFailures.disabled = busy || !state.lastRun || !state.lastRun.failures.length;
    if (busy) ui.selectedRun.disabled = true;
    for (const checkbox of ui.pickerList.querySelectorAll('input[type="checkbox"]')) checkbox.disabled = busy;
    if (!busy) {
      refreshScopeButtons();
      updateSelectionUi();
    }
  }

  async function loadPage() {
    const bvid = extractBvid(location.href);
    if (!bvid) return;
    if (state.running && state.phase === "scan") state.cancelled = true;
    state.runSerial += 1;
    state.bvid = bvid;
    state.metadata = null;
    state.markdown = "";
    state.downloads = [];
    state.phase = "idle";
    state.pending = null;
    state.activeJobId = "";
    state.selectedKeys.clear();
    state.lastRun = null;
    ui.download.disabled = true;
    ui.fallbackCard.hidden = true;
    ui.whisperLive.hidden = true;
    renderFailures([]);
    ui.picker.hidden = true;
    [ui.current, ui.video, ui.custom, ui.season].forEach((button) => { button.disabled = true; });
    setProgress(0, 0, "正在识别", "读取视频与合集信息…");
    try {
      const metadata = await send("getVideoMetadata", { bvid });
      if (state.bvid !== bvid) return;
      state.metadata = metadata;
      state.lastPlaybackCid = playbackCid();
      renderPicker();
      refreshScopeButtons();
      setProgress(0, 0, "准备就绪", "选择提取范围和处理方式。");
      await tryResumeJob(bvid);
    } catch (error) {
      setProgress(0, 0, "识别失败", error.message || "无法读取视频信息");
    }
  }

  function failureReason(error) {
    if (!error) return { reason: "未知错误", detail: "-" };
    if (error.code === "BILI_-101") return { reason: "需要登录", detail: "请登录 B 站后刷新页面" };
    if (error.code === "HTTP_403" || error.code === "BILI_-403") return { reason: "无权访问", detail: error.message };
    if (error.code === "HTTP_429") return { reason: "请求过于频繁", detail: error.message };
    return { reason: "提取失败", detail: error.message || String(error.code || "未知错误") };
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function formatDuration(seconds) {
    const whole = Math.max(0, Math.round(Number(seconds) || 0));
    const hours = Math.floor(whole / 3600);
    const minutes = Math.floor((whole % 3600) / 60);
    if (hours) return `${hours} 小时 ${minutes} 分钟`;
    return `${Math.max(1, minutes)} 分钟`;
  }

  function updateWhisperStatus(job, phase, unitPercent, overallPercent) {
    const rawDevice = String(job.device || "").toLowerCase();
    const model = normalizeWhisperModel(job.model);
    const startedAt = Date.parse(job.createdAt || "");
    const elapsedSeconds = Number.isFinite(startedAt) ? Math.max(0, (Date.now() - startedAt) / 1000) : 0;
    ui.whisperLive.hidden = false;
    ui.whisperPhase.textContent = phase;
    ui.whisperUnit.textContent = job.current ? `P${job.current.page} · ${job.current.title}` : (job.status === "queued" ? "任务排队中" : "等待下一分P");
    ui.whisperUnit.title = ui.whisperUnit.textContent;
    const device = rawDevice === "cuda" ? "GPU CUDA" : (rawDevice === "cpu" ? "CPU int8" : "检测中");
    ui.whisperDevice.textContent = `${model} · ${device}`;
    ui.whisperUnitProgress.textContent = `${unitPercent}%`;
    ui.whisperElapsed.textContent = core.formatTimestamp(elapsedSeconds);
    ui.whisperEta.textContent = job.etaSeconds == null ? "首P后估算" : core.formatTimestamp(job.etaSeconds);
    ui.whisperOverall.textContent = `整体 ${job.finished} / ${job.total} · ${overallPercent}% · ${job.completed}成功 / ${job.failed}失败`;
  }

  function renderFailures(failures) {
    const items = Array.isArray(failures) ? failures : [];
    ui.failureList.replaceChildren();
    ui.failureCount.textContent = String(items.length);
    ui.failures.hidden = items.length === 0;
    ui.failures.open = items.length > 0;
    ui.retryFailures.textContent = `只重试失败项（${items.length}）`;
    ui.retryFailures.disabled = state.running || items.length === 0;

    for (const failure of items) {
      const link = document.createElement("a");
      link.className = "failure-item";
      link.href = failure.unit.sourceUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";

      const index = document.createElement("span");
      index.className = "failure-index";
      index.textContent = `P${failure.unit.page}`;

      const copy = document.createElement("span");
      copy.className = "failure-copy";
      const title = document.createElement("strong");
      title.textContent = failure.unit.title;
      title.title = failure.unit.title;
      const reason = document.createElement("small");
      reason.textContent = `${failure.reason} · ${failure.detail || "无详细信息"}`;
      reason.title = reason.textContent;
      copy.append(title, reason);
      link.append(index, copy);
      ui.failureList.append(link);
    }
  }

  function buildDownloads(context, results, failures, cancelled) {
    const order = new Map(context.units.map((unit, index) => [unitKey(unit), index]));
    results.sort((a, b) => order.get(unitKey(a.unit)) - order.get(unitKey(b.unit)));
    failures.sort((a, b) => order.get(unitKey(a.unit)) - order.get(unitKey(b.unit)));
    const exportedAt = new Date().toLocaleString("zh-CN");
    const markdownOptions = { mergeParagraphs: context.mergeParagraphs };
    if (context.splitFiles) {
      state.downloads = context.units.flatMap((unit) => {
        const key = unitKey(unit);
        const result = results.find((item) => unitKey(item.unit) === key);
        const failure = failures.find((item) => unitKey(item.unit) === key);
        if (!result && !failure) return [];
        const oneUnit = { ...unit, index: 1 };
        return [{
          filename: `P${unit.page}-${core.sanitizeFilename(unit.title)}-完整字幕.md`,
          markdown: core.buildMarkdown({
            title: unit.title,
            sourceUrl: unit.sourceUrl,
            exportedAt,
            results: result ? [{ ...result, unit: oneUnit }] : [],
            failures: failure ? [{ ...failure, unit: oneUnit }] : [],
            options: markdownOptions,
            cancelled
          })
        }];
      });
      state.markdown = state.downloads[0] ? state.downloads[0].markdown : "";
      state.filename = state.downloads[0] ? state.downloads[0].filename : "";
    } else {
      state.markdown = core.buildMarkdown({
        title: context.title,
        sourceUrl: context.sourceUrl,
        exportedAt,
        results,
        failures,
        options: markdownOptions,
        cancelled
      });
      state.filename = `${core.sanitizeFilename(context.title)}-完整字幕.md`;
      state.downloads = [{ filename: state.filename, markdown: state.markdown }];
    }
  }

  function finishRun(context, helperItems, cancelled, whisperModel = DEFAULT_WHISPER_MODEL) {
    const results = [...(context.results || [])];
    const failures = [...(context.failures || [])];
    if (Array.isArray(helperItems)) {
      for (const item of helperItems) {
        const unit = item.unit;
        if (item.status === "success" && Array.isArray(item.cues) && item.cues.length) {
          results.push({
            unit,
            track: { lan: "zh", lanDoc: `本机 Whisper ${normalizeWhisperModel(whisperModel)}`, isAi: false, source: "whisper" },
            cues: context.mergeParagraphs ? core.mergeCues(item.cues) : item.cues
          });
        } else {
          failures.push({
            unit,
            reason: item.status === "failed" ? "本机Whisper失败" : "本机转写未完成",
            detail: item.error || (cancelled ? "任务已取消" : "未获得转写结果")
          });
        }
      }
    } else {
      failures.push(...(context.fallbackFailures || []));
    }
    buildDownloads(context, results, failures, cancelled);
    state.lastRun = {
      bvid: context.bvid,
      title: context.title,
      sourceUrl: context.sourceUrl,
      units: context.units,
      splitFiles: context.splitFiles,
      mergeParagraphs: context.mergeParagraphs,
      results,
      failures
    };
    state.running = false;
    state.phase = "idle";
    state.pending = null;
    state.activeJobId = "";
    renderFailures(failures);
    ui.fallbackCard.hidden = true;
    ui.whisperLive.hidden = true;
    ui.cancel.disabled = true;
    ui.modelSelect.disabled = false;
    ui.download.disabled = !state.downloads.length;
    ui.download.textContent = state.downloads.length > 1 ? `下载 ${state.downloads.length} 个 MD` : "下载 Markdown";
    setBusy(false);
    const multiDownload = state.downloads.length > 1 ? " · 下载时请允许多个文件" : "";
    setProgress(context.units.length, context.units.length, cancelled ? "已取消" : "处理完成", `${results.length} 成功 · ${failures.length} 失败${multiDownload}${cancelled ? " · 已保留完成内容" : ""}`);
  }

  function showConfirmation(context) {
    state.pending = context;
    state.phase = "confirm";
    const duration = context.fallbackUnits.reduce((sum, unit) => sum + (Number(unit.duration) || 0), 0);
    ui.biliCount.nextElementSibling.textContent = context.retrying ? "已成功" : "B站字幕";
    ui.biliCount.textContent = String(context.results.length);
    ui.whisperCount.textContent = String(context.fallbackUnits.length);
    ui.blockedCount.textContent = String(context.failures.length);
    ui.fallbackDetail.textContent = `${context.retrying ? `已复用 ${context.cachedCount} 个成功结果；` : ""}${context.fallbackUnits.length} 个分P、约 ${formatDuration(duration)} 需要本机转写。确认后按顺序一次处理一个，可关闭页面后继续。`;
    ui.helperNote.textContent = "音频仅在本机处理；不使用 API 密钥，不上传，不产生费用。";
    ui.biliOnly.disabled = false;
    ui.whisperStart.disabled = false;
    ui.modelSelect.disabled = false;
    ui.fallbackCard.hidden = false;
    ui.cancel.disabled = false;
    const resultLabel = context.retrying ? "已成功" : "B站字幕";
    setProgress(context.units.length, context.units.length, "扫描完成，等待确认", `${context.results.length} 个${resultLabel} · ${context.fallbackUnits.length} 个需本机补齐 · ${context.failures.length} 个暂不可处理`);
  }

  async function startWhisper(context) {
    if (!context || !context.fallbackUnits.length) return finishRun(context, [], false);
    const selectedModel = applyWhisperModel(state.whisperModel, false);
    ui.whisperStart.disabled = true;
    ui.biliOnly.disabled = true;
    ui.modelSelect.disabled = true;
    ui.helperNote.textContent = `正在检查免费本机助手与 Whisper ${selectedModel} 模型…`;
    ui.whisperLive.hidden = false;
    ui.whisperPhase.textContent = "连接助手";
    ui.whisperUnit.textContent = "正在创建本机任务";
    ui.whisperDevice.textContent = `${selectedModel} · 检测中`;
    ui.whisperUnitProgress.textContent = "0%";
    ui.whisperElapsed.textContent = "00:00:00";
    ui.whisperEta.textContent = "首P后估算";
    ui.whisperOverall.textContent = `整体 0 / ${context.fallbackUnits.length}`;
    try {
      const health = await send("helperHealth", {});
      if (!health || !health.freeLocalOnly) throw new Error("本机助手状态异常");
      if (!Array.isArray(health.supportedModels) || !health.supportedModels.includes(selectedModel)) {
        throw new Error("本机助手版本过旧或不支持所选模型，请重新运行 install-helper.ps1");
      }
      const job = await send("helperCreateJob", {
        payload: {
          bvid: context.bvid,
          title: context.title,
          model: selectedModel,
          units: context.fallbackUnits,
          context
        }
      });
      const jobModel = applyWhisperModel(job.model, false);
      state.activeJobId = job.id;
      state.phase = "whisper";
      ui.helperNote.textContent = `Whisper ${jobModel} 已连接 · ${health.device === "未加载" ? "将自动选择GPU或CPU int8" : health.device}`;
      await pollJob(job.id);
    } catch (error) {
      ui.whisperStart.disabled = false;
      ui.biliOnly.disabled = false;
      ui.modelSelect.disabled = false;
      ui.helperNote.textContent = error.message || "无法启动本机转写";
      ui.whisperPhase.textContent = "启动失败";
      ui.whisperUnit.textContent = error.message || "无法连接本机助手";
      setProgress(context.units.length, context.units.length, "本机助手不可用", `${error.message || "请运行 install-helper.ps1"}；仍可仅导出B站字幕。`);
    }
  }

  async function pollJob(jobId) {
    while (state.activeJobId === jobId) {
      let job;
      try {
        job = await send("helperGetJob", { jobId });
      } catch (error) {
        ui.whisperLive.hidden = false;
        ui.whisperPhase.textContent = "重新连接";
        setProgress(0, 0, "等待本机助手", `${error.message || "连接中断"}；任务仍在后台，可刷新页面恢复。`);
        await wait(3000);
        continue;
      }
      const phaseNames = {
        queued: "等待队列",
        preparing: "准备音频",
        downloading: "下载音频",
        loading_model: `加载 Whisper ${normalizeWhisperModel(job.model)} 模型`,
        transcribing: "识别字幕（分段更新）",
        cached: "读取本机缓存",
        completed: "处理完成",
        cancelled: "任务已取消",
        failed: "任务失败"
      };
      const unitPercent = Math.max(0, Math.min(100, Number(job.progress && job.progress.percent) || 0));
      const phase = phaseNames[job.progress && job.progress.phase] || "处理中";
      const detail = job.current
        ? `P${job.current.page} ${job.current.title} · ${phase} ${unitPercent}%${job.etaSeconds != null ? ` · 预计剩余 ${formatDuration(job.etaSeconds)}` : ""}`
        : "任务已排队，等待本机模型。";
      const overallDone = Math.min(job.total, job.finished + (job.current ? unitPercent / 100 : 0));
      const overallPercent = job.total ? Math.round(overallDone / job.total * 100) : 0;
      updateWhisperStatus(job, phase, unitPercent, overallPercent);
      setProgress(overallDone, job.total, job.status === "queued" ? "等待本机转写" : "本机Whisper转写中", `${detail} · ${job.completed} 成功 / ${job.failed} 失败`, `${job.finished} / ${job.total} · ${overallPercent}%`);
      if (["completed", "cancelled", "failed"].includes(job.status)) {
        let complete;
        try {
          complete = await send("helperGetJob", { jobId, includeResults: true });
        } catch (error) {
          setProgress(job.finished, job.total, "正在读取本机结果", `${error.message || "读取失败"}；将自动重试。`);
          await wait(3000);
          continue;
        }
        const context = complete.context || state.pending;
        if (!context) throw new Error("任务缺少导出上下文，请重新扫描");
        finishRun(context, complete.items || [], complete.status === "cancelled", complete.model);
        return;
      }
      await wait(1000);
    }
  }

  async function tryResumeJob(bvid) {
    try {
      const job = await send("helperGetActiveJob", { bvid });
      if (!job) return;
      if (!Object.hasOwn(WHISPER_MODEL_DETAILS, String(job.model || ""))) {
        throw new Error("本机助手版本过旧，请重新运行 install-helper.ps1 后恢复任务");
      }
      applyWhisperModel(job.model, false);
      state.running = true;
      state.phase = "whisper";
      state.activeJobId = job.id;
      setBusy(true);
      ui.cancel.disabled = false;
      ui.fallbackCard.hidden = false;
      ui.biliCount.textContent = "—";
      ui.whisperCount.textContent = String(job.total);
      ui.blockedCount.textContent = String(job.failed);
      ui.fallbackDetail.textContent = "已恢复此 BV 的本机转写任务。完成后可直接下载 Markdown。";
      ui.biliOnly.disabled = true;
      ui.whisperStart.disabled = true;
      ui.modelSelect.disabled = true;
      ui.helperNote.textContent = "任务数据和字幕缓存在本机，关闭浏览器不会丢失。";
      await pollJob(job.id);
    } catch (error) {
      if (state.activeJobId) {
        state.running = false;
        state.phase = "idle";
        state.activeJobId = "";
        ui.cancel.disabled = true;
        ui.modelSelect.disabled = false;
        ui.fallbackCard.hidden = true;
        ui.whisperLive.hidden = true;
        setBusy(false);
      }
      if (error.code !== "HELPER_NOT_INSTALLED" && error.code !== "HELPER_UNAVAILABLE") {
        setProgress(0, 0, "恢复失败", error.message || "检查本机任务失败");
      }
    }
  }

  async function run(units, title, sourceUrl, splitFiles, cached) {
    if (state.running || !units.length) return;
    const serial = ++state.runSerial;
    const cachedResults = cached && Array.isArray(cached.results) ? cached.results : [];
    const allUnits = cached && Array.isArray(cached.units) ? cached.units : units;
    const mergeParagraphs = cached ? cached.mergeParagraphs : ui.merge.checked;
    if (!cached) state.lastRun = null;
    state.running = true;
    state.phase = "scan";
    state.cancelled = false;
    state.pending = null;
    state.activeJobId = "";
    state.markdown = "";
    state.downloads = [];
    ui.fallbackCard.hidden = true;
    ui.whisperLive.hidden = true;
    renderFailures([]);
    ui.download.textContent = "下载 Markdown";
    ui.download.disabled = true;
    ui.cancel.disabled = false;
    setBusy(true);
    const results = [...cachedResults];
    const failures = [];
    const fallbackFailures = [];
    const scanStatus = cached ? "正在重试失败分P" : "正在扫描B站字幕";

    for (let index = 0; index < units.length; index += 1) {
      if (state.cancelled || serial !== state.runSerial) break;
      const unit = units[index];
      setProgress(index, units.length, scanStatus, `${unit.index}. ${unit.title}${cachedResults.length ? ` · 已复用 ${cachedResults.length} 个成功结果` : ""}`);
      try {
        const player = await send("getSubtitleMetadata", { bvid: unit.bvid, cid: unit.cid });
        const tracks = player && player.subtitle && Array.isArray(player.subtitle.subtitles) ? player.subtitle.subtitles : [];
        const track = core.chooseSubtitleTrack(tracks);
        if (!track) {
          const failure = {
            unit,
            reason: player && player.need_login_subtitle ? "需要登录" : "没有字幕",
            detail: player && player.need_login_subtitle ? "请登录 B 站后刷新页面" : "该分集没有 B 站字幕轨道"
          };
          (failure.reason === "没有字幕" ? fallbackFailures : failures).push(failure);
        } else {
          const payload = await send("getSubtitleBody", { url: track.url });
          const rawCues = core.normalizeCues(payload);
          if (!rawCues.length) {
            fallbackFailures.push({ unit, reason: "字幕为空", detail: "字幕轨道未包含有效文本" });
          } else if (core.isSuspiciousCoverage(unit.duration, rawCues)) {
            const subtitleEnd = Math.ceil(Math.max(...rawCues.map((cue) => cue.to || cue.from)));
            fallbackFailures.push({ unit, reason: "字幕疑似错配", detail: `字幕仅覆盖前 ${subtitleEnd} 秒，视频时长 ${unit.duration} 秒` });
          } else {
            results.push({ unit, track, cues: mergeParagraphs ? core.mergeCues(rawCues) : rawCues });
          }
        }
      } catch (error) {
        failures.push({ unit, ...failureReason(error) });
      }
      const newSuccesses = results.length - cachedResults.length;
      setProgress(index + 1, units.length, scanStatus, `${cachedResults.length ? `${cachedResults.length} 个缓存 · ` : ""}${newSuccesses} 个本轮成功 · ${fallbackFailures.length} 个待补齐 · ${failures.length} 个暂不可处理`);
      if (index < units.length - 1 && !state.cancelled) await wait(1000);
    }

    const context = {
      bvid: cached ? cached.bvid : state.bvid,
      title,
      sourceUrl,
      units: allUnits,
      splitFiles: Boolean(splitFiles),
      mergeParagraphs,
      cachedCount: cachedResults.length,
      retrying: Boolean(cached),
      results,
      failures,
      fallbackFailures,
      fallbackUnits: fallbackFailures.map((failure) => failure.unit)
    };
    if (state.cancelled || serial !== state.runSerial) {
      finishRun(context, null, true);
    } else if (context.fallbackUnits.length) {
      showConfirmation(context);
    } else {
      finishRun(context, [], false);
    }
  }

  function retryFailedUnits() {
    const cached = state.lastRun;
    if (state.running || !cached || !cached.failures.length) return;
    const failedKeys = new Set(cached.failures.map((failure) => unitKey(failure.unit)));
    const units = cached.units.filter((unit) => failedKeys.has(unitKey(unit)));
    if (!units.length) return;
    run(units, cached.title, cached.sourceUrl, cached.splitFiles, cached);
  }

  ui.current.addEventListener("click", () => {
    const unit = currentUnit();
    if (unit) run([{ ...unit, index: 1 }], unit.title, unit.sourceUrl);
  });
  ui.video.addEventListener("click", () => {
    const units = core.getVideoUnits(state.metadata);
    run(units, state.metadata.title, `https://www.bilibili.com/video/${state.metadata.bvid}`);
  });
  ui.custom.addEventListener("click", () => {
    ui.picker.hidden = !ui.picker.hidden;
    if (!ui.picker.hidden) {
      renderPicker();
      ui.pickerSearch.focus();
    }
  });
  ui.pickerClose.addEventListener("click", () => { ui.picker.hidden = true; });
  ui.pickerSearch.addEventListener("input", filterPicker);
  ui.selectVisible.addEventListener("click", () => {
    for (const item of ui.pickerList.querySelectorAll(".pick-item:not([hidden])")) {
      const checkbox = item.querySelector('input[type="checkbox"]');
      checkbox.checked = true;
      const units = core.getVideoUnits(state.metadata);
      const unit = units[Array.from(ui.pickerList.children).indexOf(item)];
      if (unit) state.selectedKeys.add(unitKey(unit));
    }
    updateSelectionUi();
  });
  ui.clearSelected.addEventListener("click", () => {
    state.selectedKeys.clear();
    for (const checkbox of ui.pickerList.querySelectorAll('input[type="checkbox"]')) checkbox.checked = false;
    updateSelectionUi();
  });
  ui.selectedRun.addEventListener("click", () => {
    const units = core.getVideoUnits(state.metadata)
      .filter((unit) => state.selectedKeys.has(unitKey(unit)))
      .map((unit, index) => ({ ...unit, index: index + 1 }));
    run(units, `${state.metadata.title}（已选分P）`, `https://www.bilibili.com/video/${state.metadata.bvid}`, ui.splitMode.checked);
  });
  ui.season.addEventListener("click", () => {
    const units = core.getSeasonUnits(state.metadata);
    const season = state.metadata.ugc_season;
    run(units, season.title, `https://space.bilibili.com/${season.mid}/lists/${season.id}`);
  });
  ui.biliOnly.addEventListener("click", () => {
    if (state.pending) finishRun(state.pending, null, false);
  });
  ui.whisperStart.addEventListener("click", () => {
    if (state.pending) startWhisper(state.pending);
  });
  ui.modelSelect.addEventListener("change", () => {
    applyWhisperModel(ui.modelSelect.value, true);
  });
  ui.retryFailures.addEventListener("click", retryFailedUnits);
  ui.cancel.addEventListener("click", async () => {
    ui.cancel.disabled = true;
    if (state.phase === "whisper" && state.activeJobId) {
      ui.detail.textContent = "正在通知本机助手取消；已完成的分P会保留。";
      try {
        await send("helperCancelJob", { jobId: state.activeJobId });
      } catch (error) {
        ui.detail.textContent = `${error.message || "取消请求失败"}；可稍后刷新页面恢复任务。`;
      }
      return;
    }
    if (state.phase === "confirm" && state.pending) {
      finishRun(state.pending, null, true);
      return;
    }
    state.cancelled = true;
    ui.detail.textContent = "将在当前扫描请求结束后停止。";
  });
  ui.download.addEventListener("click", () => {
    if (!state.downloads.length) return;
    for (const file of state.downloads) {
      const url = URL.createObjectURL(new Blob([file.markdown], { type: "text/markdown;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = file.filename;
      link.style.display = "none";
      (document.body || document.documentElement).append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  });
  ui.collapse.addEventListener("click", () => {
    const collapsed = panel.dataset.collapsed !== "true";
    panel.dataset.collapsed = String(collapsed);
    ui.collapse.textContent = collapsed ? "字幕" : "收起";
    ui.collapse.setAttribute("aria-label", collapsed ? "展开字幕导出面板" : "收起字幕导出面板");
  });

  setInterval(() => {
    const liveCid = playbackCid();
    if (location.href === state.lastHref && liveCid === state.lastPlaybackCid) return;
    state.lastHref = location.href;
    state.lastPlaybackCid = liveCid;
    const bvid = extractBvid(location.href);
    if (bvid && bvid !== state.bvid) loadPage();
    else {
      refreshScopeButtons();
      renderPicker();
    }
  }, 1000);

  restoreWhisperModel().finally(loadPage);
})();
