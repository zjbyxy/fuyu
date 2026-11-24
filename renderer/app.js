/* 灵动岛 渲染层逻辑 */
'use strict';

const islandEl = document.getElementById('island');
const collapsedEl = document.getElementById('collapsed');
const $ = (id) => document.getElementById(id);

let config = null;
let pinnedLocal = false;
let curPage = 'chat';
let dragHoldUntil = 0;
let lastClipCount = 0;
let zenMode = false; // 全屏应用覆盖时自动缩成顶部小横条
let shelfItems = [];
let shelfView = localStorage.getItem('island_shelf_view') === 'list' ? 'list' : 'icon';
let shelfCat = 'all';
let shelfSelPath = '';
let internalDragging = false;

/* ==================== 岛：展开 / 收起 & 按功能自适应尺寸 ==================== */
function expand() {
  if (!islandEl.classList.contains('expanded')) {
    islandEl.classList.add('expanded');
  }
  updateIslandSize();
}
function collapse() {
  if (Date.now() < dragHoldUntil) return;
  if (islandEl.classList.contains('expanded')) {
    islandEl.classList.remove('expanded');
  }
  updateIslandSize();
}
const isExpanded = () => islandEl.classList.contains('expanded');

function computePageSize(page) {
  switch (page) {
    case 'music':
      return [356, 318];
    case 'weather':
      return [346, 312];
    case 'pomo':
      return [342, 372];
    case 'monitor':
      return monView === 'mem' ? [400, 566] : [400, 500];
    case 'shelf': {
      const n = getFilteredShelfItems().length;
      if (n === 0) return [380, 232];
      if (shelfView === 'icon') {
        if (n <= 4) return [388, 296];
        if (n <= 8) return [388, 368];
        return [388, 428];
      } else {
        if (n === 1) return [388, 274];
        if (n === 2) return [388, 328];
        if (n === 3) return [388, 380];
        return [388, 428];
      }
    }
    case 'notes': {
      const n = typeof notesOn === 'function' && typeof selDate === 'string' ? notesOn(selDate).length : 0;
      if (n <= 1) return [368, 352];
      if (n === 2) return [368, 386];
      return [368, 420];
    }
    case 'clips': {
      if (lastClipCount <= 1) return [368, 236];
      if (lastClipCount === 2) return [368, 290];
      if (lastClipCount === 3) return [368, 344];
      return [368, 398];
    }
    case 'chat':
    default:
      return [396, 424];
  }
}

function updateIslandSize() {
  if (!isExpanded()) {
    islandEl.style.width = '';
    islandEl.style.height = '';
    fitCollapsedWidth();
    return;
  }
  const [w, h] = computePageSize(curPage);
  islandEl.style.width = w + 'px';
  islandEl.style.height = h + 'px';
}

// 全屏收缩模式：被全屏窗口覆盖时缩成顶部小横条，悬停仍可展开
function setZen(v) {
  const nv = !!v;
  if (zenMode === nv) return;
  zenMode = nv;
  islandEl.classList.toggle('zen', nv);
  if (nv) {
    if (isExpanded()) collapse();
    else updateIslandSize();
  } else {
    updateIslandSize();
  }
}
window.island.onFullscreen((v) => setZen(v));

// 收起态：胶囊宽度随显示内容多少自适应
function fitCollapsedWidth() {
  if (isExpanded() || !collapsedEl) return;
  if (zenMode) {
    // 全屏收缩：顶部小横条
    islandEl.style.width = '76px';
    islandEl.style.height = '8px';
    return;
  }
  let w = 28; // 左右 padding
  const kids = Array.from(collapsedEl.children);
  let first = true;
  for (const el of kids) {
    if (el.classList.contains('hidden') || el.offsetWidth <= 0) continue;
    let cw = el.offsetWidth;
    if (el.id === 'cMusic') {
      const song = document.getElementById('cSong');
      cw = ((song && song.offsetWidth) || 90) + 122;
    }
    w += cw + (first ? 0 : 8);
    first = false;
  }
  w = Math.max(200, Math.min(640, Math.round(w)));
  if (islandEl.style.width !== w + 'px') islandEl.style.width = w + 'px';
}

window.island.onIsland((s) => {
  if (s === 'enter') expand();
  else if (s === 'leave') { if (!pinnedLocal) collapse(); }
  else if (s === 'togglePin') {
    if (!isExpanded()) { expand(); pinnedLocal = true; window.island.setPin(true); }
    else { pinnedLocal = false; window.island.setPin(false); collapse(); }
  }
});

// DOM 事件兜底（窗口可交互时由浏览器直接触发）
islandEl.addEventListener('mouseenter', () => expand());
islandEl.addEventListener('mouseleave', () => { if (!pinnedLocal) collapse(); });

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
  if (pinnedLocal) { pinnedLocal = false; window.island.setPin(false); }
  collapse();
});

// 岛矩形上报给主进程（用于鼠标穿透判定）
new ResizeObserver(() => {
  const r = islandEl.getBoundingClientRect();
  if (r.width > 4) {
    window.island.sendRect({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) });
  }
}).observe(islandEl);

/* ==================== 时钟 ==================== */
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
function pad(n) { return n < 10 ? '0' + n : '' + n; }
function tickClock() {
  const d = new Date();
  const hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
  $('mTime').textContent = hm;
  $('timeBig').textContent = hm;
  $('dateBig').textContent = (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + WEEK[d.getDay()];
}
tickClock();
setInterval(tickClock, 1000);

/* ==================== Tabs ==================== */
const tabs = document.querySelectorAll('.tab');
function switchTab(pageName) {
  if (!pageName) return;
  curPage = pageName;
  tabs.forEach((b) => b.classList.toggle('active', b.dataset.page === pageName));
  document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.id === 'page-' + pageName));
  if (pageName === 'monitor') refreshStats(true);
  if (pageName === 'clips') renderClips();
  if (pageName === 'weather') loadWeather(false);
  if (pageName === 'shelf') renderShelf();
  updateIslandSize();
}
tabs.forEach((btn) => btn.addEventListener('click', () => {
  switchTab(btn.dataset.page);
}));

/* ==================== Markdown（安全渲染） ==================== */
function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function renderMarkdown(src) {
  const codeBlocks = [];
  let t = escapeHtml(src || '');
  t = t.replace(/```([^\n`]*)\n([\s\S]*?)(?:```|$)/g, (m, lang, code) => {
    codeBlocks.push({ lang: lang.trim(), safe: code });
    return '\u0000CODE' + (codeBlocks.length - 1) + '\u0000';
  });
  t = t.replace(/`([^`\n]+)`/g, '<code class="inline">$1</code>');
  t = t.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
  t = t.replace(/^### (.+)$/gm, '<div class="md-h3">$1</div>');
  t = t.replace(/^## (.+)$/gm, '<div class="md-h2">$1</div>');
  t = t.replace(/^# (.+)$/gm, '<div class="md-h1">$1</div>');
  t = t.replace(/^\s*[-*] (.+)$/gm, '<div class="md-li">$1</div>');
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  t = t.replace(/\n/g, '<br>');
  t = t.replace(/\u0000CODE(\d+)\u0000/g, (m, i) => {
    const b = codeBlocks[i];
    const esc2 = b.safe.replace(/\n+$/, '');
    return '<div class="md-code"><div class="md-code-bar"><span>' + (b.lang || 'code') +
      '</span><span class="md-copy" data-raw-idx="' + i + '">复制</span></div><pre>' + esc2 + '</pre></div>';
  });
  return t;
}

/* ==================== AI 对话 ==================== */
let chats = [];
let curChatId = null;
let generating = false;
let streamText = '';
let streamThink = '';
let renderTimer = null;
const msgsEl = $('chatMsgs');

function loadChats() {
  try { chats = JSON.parse(localStorage.getItem('island_chats') || '[]'); } catch (e) { chats = []; }
}
function saveChats() { localStorage.setItem('island_chats', JSON.stringify(chats)); }
function curChat() { return chats.find(c => c.id === curChatId) || null; }
function newChat() {
  const c = { id: Date.now() + '' + Math.floor(Math.random() * 999), title: '新对话', messages: [], updated: Date.now() };
  chats.unshift(c);
  curChatId = c.id;
  saveChats(); renderChatSel(); renderMsgs();
}
function renderChatSel() {
  const sel = $('chatSessions');
  sel.innerHTML = '';
  chats.forEach(c => {
    const o = document.createElement('option');
    o.value = c.id; o.textContent = c.title || '对话';
    sel.appendChild(o);
  });
  sel.value = curChatId;
}
function renderMsgs() {
  msgsEl.innerHTML = '';
  const c = curChat();
  if (c) c.messages.forEach(m => appendMsg(m.role, m.content, m.think || ''));
  scrollBottom(true);
}
function appendMsg(role, content, think) {
  const c = curChat();
  if (c) {
    c.messages.push({ role, content, think });
    c.updated = Date.now();
    saveChats();
  }
  const msg = addMsgDom(role, content, think);
  scrollBottom();
  return msg;
}
function addMsgDom(role, content, think) {
  if (think) {
    const th = document.createElement('div');
    th.className = 'think';
    th.textContent = '思考：' + think;
    msgsEl.appendChild(th);
  }
  const div = document.createElement('div');
  div.className = 'msg ' + (role === 'user' ? 'user' : 'bot');
  div.innerHTML = role === 'user' ? escapeHtml(content) : renderMarkdown(content);
  msgsEl.appendChild(div);
  return div;
}
function scrollBottom(force) {
  const nearBottom = msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight < 60;
  if (force || nearBottom) msgsEl.scrollTop = msgsEl.scrollHeight;
}

function updateStreamDom() {
  if (renderTimer) return;
  renderTimer = setTimeout(() => {
    renderTimer = null;
    if (!streamDom) return;
    streamDom.innerHTML = renderMarkdown(streamText);
    const t = document.querySelector('.stream-think');
    if (t) t.textContent = '思考：' + streamThink;
    scrollBottom();
  }, 90);
}
let streamDom = null;
let streamThinkDom = null;

function sendChat() {
  const input = $('chatInput');
  const text = input.value.trim();
  if (!text || generating) return;
  if (!(config && config.deepseek && config.deepseek.apiKey)) {
    $('chatHint').textContent = '尚未配置 DeepSeek API Key：到「设置」页填写后即可对话（支持后续接入任意模型版本）。';
    $('chatHint').classList.remove('hidden');
    return;
  }
  $('chatHint').classList.add('hidden');
  input.value = '';
  let c = curChat();
  if (!c) { newChat(); c = curChat(); }
  if (c.messages.length === 0) {
    c.title = text.slice(0, 14);
    renderChatSel();
  }
  appendMsg('user', text);

  streamText = ''; streamThink = '';
  generating = true;
  $('btnSend').disabled = true;
  $('btnStopGen').classList.remove('hidden');

  streamThinkDom = document.createElement('div');
  streamThinkDom.className = 'think stream-think';
  msgsEl.appendChild(streamThinkDom);
  streamDom = document.createElement('div');
  streamDom.className = 'msg bot';
  msgsEl.appendChild(streamDom);
  scrollBottom(true);

  const history = c.messages.map(m => ({ role: m.role, content: m.content }));
  window.island.aiSend([{ role: 'system', content: config.deepseek.systemPrompt || '' }].concat(history));
}

$('btnSend').addEventListener('click', sendChat);
$('chatInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendChat(); }
});
$('btnStopGen').addEventListener('click', () => window.island.aiStop());
$('btnNewChat').addEventListener('click', () => { if (!generating) { newChat(); } });
$('chatSessions').addEventListener('change', (e) => {
  curChatId = e.target.value; saveChats(); renderMsgs();
});

window.island.onAi('start', () => {});
window.island.onAi('chunk', (d) => {
  streamText += d;
  updateStreamDom();
});
window.island.onAi('reasoning', (d) => {
  streamThink += d;
  if (streamThinkDom) { streamThinkDom.textContent = '思考：' + streamThink; scrollBottom(); }
});
window.island.onAi('done', () => {
  const c = curChat();
  if (c && streamText) {
    c.messages.push({ role: 'assistant', content: streamText, think: streamThink });
    c.updated = Date.now(); saveChats();
  }
  if (streamDom) streamDom.innerHTML = renderMarkdown(streamText);
  if (!streamThink && streamThinkDom) streamThinkDom.remove();
  streamDom = null; streamThinkDom = null;
  streamText = ''; streamThink = '';
  generating = false;
  $('btnSend').disabled = false;
  $('btnStopGen').classList.add('hidden');
  scrollBottom();
});
window.island.onAi('error', (d) => {
  const div = document.createElement('div');
  div.className = 'msg bot';
  div.style.color = 'var(--warn)';
  div.textContent = '[出错] ' + d;
  msgsEl.appendChild(div);
  if (streamThinkDom) streamThinkDom.remove();
  if (streamDom) streamDom.remove();
  streamDom = null; streamThinkDom = null;
  generating = false;
  $('btnSend').disabled = false;
  $('btnStopGen').classList.add('hidden');
  scrollBottom();
});

msgsEl.addEventListener('click', (e) => {
  const el = e.target;
  if (el.classList && el.classList.contains('md-copy')) {
    const idx = el.getAttribute('data-raw-idx');
    const c = curChat();
    if (c) {
      const last = c.messages[c.messages.length - 1];
      if (last && last.role === 'assistant') {
        // 从流文本里还原代码
        const m = (streamText || last.content).match(/```([^\n`]*)\n([\s\S]*?)```/g);
        // 简化：直接从 DOM pre 里取纯文本
      }
    }
    const pre = el.closest('.md-code').querySelector('pre');
    if (pre) window.island.copyClip(pre.textContent);
    el.textContent = '已复制';
    setTimeout(() => { el.textContent = '复制'; }, 1200);
  }
});

/* ==================== 系统状态 ==================== */
const cpuHist = [], memHist = [], gpuHist = [];
function fmtBytes(n) {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0; while (n >= 1024 && i < 4) { n /= 1024; i++; }
  return n.toFixed(i > 1 ? 1 : 0) + ' ' + u[i];
}
function fmtUptime(s) {
  if (s < 60) return Math.floor(s) + ' 秒';
  if (s < 3600) return Math.floor(s / 60) + ' 分 ' + Math.floor(s % 60) + ' 秒';
  if (s < 86400) return Math.floor(s / 3600) + ' 小时 ' + Math.floor((s % 3600) / 60) + ' 分';
  return Math.floor(s / 86400) + ' 天 ' + Math.floor((s % 86400) / 3600) + ' 小时';
}
function drawChart(canvas, arr, color) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (!arr.length) return;
  const n = 90;
  const start = Math.max(0, arr.length - n);
  const step = w / (n - 1);
  ctx.beginPath();
  for (let i = 0; i < arr.length - start; i++) {
    const x = i * step;
    const y = h - (arr[start + i] / 100) * (h - 6) - 3;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.stroke();
}
let procSort = 'cpu';
let monView = 'cpu';
let lastProcsData = [];
let lastMemUsed = 0;
let lastMemTotal = 0;
let waterState = { enabled: false, left: 0, intervalMin: 0 };
const powerHist = [];

function buildCoreBars(n) {
  const box = $('coreBars');
  box.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const col = document.createElement('div');
    col.className = 'core-col';
    col.title = '核心 ' + (i + 1);
    for (let k = 0; k < 5; k++) {
      const dash = document.createElement('div');
      dash.className = 'core-dash';
      col.appendChild(dash);
    }
    box.appendChild(col);
  }
}
function updateCoreBars(pcts) {
  const box = $('coreBars');
  const cols = box.children;
  for (let i = 0; i < cols.length; i++) {
    const pct = pcts && pcts[i] != null ? pcts[i] : 0;
    const lit = Math.max(0, Math.min(5, Math.ceil(pct / 20)));
    const dashes = cols[i].children;
    for (let k = 0; k < dashes.length; k++) {
      dashes[k].classList.toggle('lit', k < lit);
      dashes[k].classList.toggle('hot', k < lit && pct > 85);
    }
  }
}
function fmtRate(bps) {
  if (bps == null || bps < 0) return '--';
  if (bps < 1024) return Math.round(bps) + 'B';
  if (bps < 1024 * 1024) return (bps / 1024).toFixed(1) + 'K';
  return (bps / 1024 / 1024).toFixed(2) + 'M';
}
function renderProcs(procs) {
  const list = $('procList');
  list.innerHTML = '';
  const arr = (procs || []).slice();
  if (procSort === 'mem') arr.sort((a, b) => (b.mem || 0) - (a.mem || 0));
  else arr.sort((a, b) => (b.cpu || 0) - (a.cpu || 0));
  arr.slice(0, 7).forEach((p) => {
    const row = document.createElement('div');
    row.className = 'proc-row';
    const ico = document.createElement('div');
    ico.className = 'proc-ico';
    if (p.icon) {
      const img = document.createElement('img');
      img.src = p.icon;
      ico.appendChild(img);
    } else {
      const s = document.createElement('span');
      s.textContent = (p.name || '?').charAt(0).toUpperCase();
      ico.appendChild(s);
    }
    const nm = document.createElement('span');
    nm.className = 'proc-name';
    nm.textContent = p.name || '--';
    const val = document.createElement('span');
    val.className = 'proc-val' + (procSort === 'mem' ? ' mem' : '');
    val.textContent = procSort === 'mem'
      ? ((p.mem || 0).toFixed(1) + ' MB')
      : ((p.cpu || 0).toFixed(1) + '%');
    row.title = p.path || p.name || '';
    row.append(ico, nm, val);
    list.appendChild(row);
  });
  if (!arr.length) {
    const empty = document.createElement('div');
    empty.className = 'mu-lyric-empty';
    empty.textContent = '正在采集进程信息…';
    list.appendChild(empty);
  }
}
function renderMemView() {
  const box = $('memProcBars');
  if (!box) return;
  box.innerHTML = '';
  const arr = (lastProcsData || []).slice().sort((a, b) => (b.mem || 0) - (a.mem || 0)).slice(0, 5);
  const maxMem = Math.max(1, ...arr.map(p => p.mem || 0));
  arr.forEach((p) => {
    const row = document.createElement('div');
    row.className = 'mem-bar-row';
    const nm = document.createElement('span');
    nm.className = 'mem-bar-name';
    nm.textContent = p.name || '--';
    nm.title = p.path || p.name || '';
    const track = document.createElement('div');
    track.className = 'mem-bar-track';
    const fill = document.createElement('div');
    fill.className = 'mem-bar-fill';
    fill.style.width = Math.max(2, Math.round((p.mem || 0) / maxMem * 100)) + '%';
    track.appendChild(fill);
    const val = document.createElement('span');
    val.className = 'mem-bar-val';
    val.textContent = (p.mem || 0).toFixed(1) + ' MB';
    row.append(nm, track, val);
    box.appendChild(row);
  });
  if (!arr.length) {
    const empty = document.createElement('div');
    empty.className = 'mu-lyric-empty';
    empty.textContent = '正在采集内存数据…';
    box.appendChild(empty);
  }
}
function setMonView(v) {
  monView = v === 'mem' ? 'mem' : 'cpu';
  procSort = monView;
  $('monCpuView').classList.toggle('hidden', monView !== 'cpu');
  $('monMemView').classList.toggle('hidden', monView !== 'mem');
  $('chipCpu').classList.toggle('active', monView === 'cpu');
  $('chipMem').classList.toggle('active', monView === 'mem');
  if (monView === 'mem') renderMemView();
  updateIslandSize();
}
$('chipCpu').addEventListener('click', () => setMonView('cpu'));
$('chipMem').addEventListener('click', () => setMonView('mem'));
async function refreshStats(force) {
  let s;
  try { s = await window.island.getStats(); } catch (e) { return; }
  if (!s) return;
  const memPct = Math.round((1 - s.memFree / s.memTotal) * 100);
  const gpu = s.gpu || null;
  const gpuPct = gpu && typeof gpu.util === 'number' ? Math.max(0, Math.min(100, gpu.util)) : 0;
  const gpuValStr = (gpu && typeof gpu.util === 'number') ? (gpu.util + '%') : '--';
  cpuHist.push(s.cpu); memHist.push(memPct); gpuHist.push(gpuPct);
  if (cpuHist.length > 90) cpuHist.shift();
  if (memHist.length > 90) memHist.shift();
  if (gpuHist.length > 90) gpuHist.shift();
  const batt = s.battery && s.battery.percent != null
    ? (s.battery.charging ? '充电 ' : '') + s.battery.percent + '%'
    : (s.battery && s.battery.charging ? '外接电源' : '电池模式');

  // 收起态：科技图标 + 数字（CPU / 内存 / GPU / 网速 / 喝水）
  $('mCpuVal').textContent = s.cpu + '%';
  $('mMemVal').textContent = memPct + '%';
  $('mGpuVal').textContent = gpuValStr;
  const net = s.net || {};
  $('mRx').textContent = fmtRate(net.rx || 0);
  $('mTx').textContent = fmtRate(net.tx || 0);
  const mWater = $('mWater');
  if (waterState && waterState.enabled) {
    mWater.classList.remove('hidden');
    $('mWaterT').textContent = Math.max(0, Math.ceil(waterState.left / 60)) + '分';
  } else {
    mWater.classList.add('hidden');
  }

  // 展开态头部
  $('ehCpu').textContent = s.cpu + '%';
  $('ehGpu').textContent = gpuValStr;
  $('ehMem').textContent = memPct + '%';

  // 监控仪表盘
  $('monCpuPct').textContent = s.cpu + '%';
  drawChart($('monSpark'), cpuHist.slice(-30), '#4c8dff');
  $('monBatt').textContent = batt;
  if ($('coreBars').children.length !== (s.corePcts || []).length) buildCoreBars((s.corePcts || []).length || s.cores);
  updateCoreBars(s.corePcts);
  let vramPct = '--';
  if (gpu && gpu.memUsed != null && gpu.memTotal) vramPct = Math.round(gpu.memUsed / gpu.memTotal * 100) + '%';
  $('monVram').textContent = '显存 ' + vramPct;
  $('monMemPct').textContent = memPct + '%';
  $('monMemTxt').textContent = fmtBytes(s.memTotal - s.memFree) + ' / ' + fmtBytes(s.memTotal);
  $('monMemBar').style.width = memPct + '%';
  $('monRx').textContent = fmtRate(net.rx || 0);
  $('monTx').textContent = fmtRate(net.tx || 0);
  $('monRxTotal').textContent = net.rxTotal ? ('累计 ' + fmtBytes(net.rxTotal)) : '';
  $('monTxTotal').textContent = net.txTotal ? ('累计 ' + fmtBytes(net.txTotal)) : '';
  if (gpu && gpu.powerW != null) {
    powerHist.push(gpu.powerW);
    if (powerHist.length > 12) powerHist.shift();
    const avg = powerHist.reduce((a, b) => a + b, 0) / powerHist.length;
    $('monPower').textContent = gpu.powerW.toFixed(0) + ' W';
    $('monPowerAvg').textContent = '均值 ' + avg.toFixed(0) + ' W';
  } else {
    $('monPower').textContent = '-- W';
    $('monPowerAvg').textContent = '';
  }
  $('monGpuName2').textContent = (gpu && gpu.name ? gpu.name : '') +
    (s.disk ? ' · C盘 ' + s.disk.pct + '%' : '') +
    ' · 开机 ' + fmtUptime(s.uptime);
  renderProcs(s.procs);
  lastProcsData = s.procs || [];
  lastMemUsed = s.memTotal - s.memFree;
  lastMemTotal = s.memTotal;
  $('memAvail').textContent = '可用 ' + fmtBytes(s.memFree);
  if (monView === 'mem') renderMemView();
  fitCollapsedWidth();
}
setInterval(() => { refreshStats(); }, 2000);

/* ==================== 便签 + 日历 ==================== */
let notes = [];
try { notes = JSON.parse(localStorage.getItem('island_notes') || '[]'); } catch (e) { notes = []; }
function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
notes = notes.map(n => Object.assign({}, n, { date: n.date || todayStr() }));
let calY = new Date().getFullYear(), calM = new Date().getMonth();
let selDate = todayStr();

function saveNotes() { localStorage.setItem('island_notes', JSON.stringify(notes)); }
function notesOn(dateStr) { return notes.filter(n => n.date === dateStr); }
function renderCalendar() {
  $('calTitle').textContent = calY + '年' + (calM + 1) + '月';
  const grid = $('calGrid');
  grid.innerHTML = '';
  const first = new Date(calY, calM, 1);
  const lead = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(calY, calM + 1, 0).getDate();
  const prevDays = new Date(calY, calM, 0).getDate();
  const cells = [];
  for (let i = lead - 1; i >= 0; i--) cells.push({ d: prevDays - i, out: true });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ d, out: false, date: calY + '-' + pad(calM + 1) + '-' + pad(d) });
  let nd = 1;
  while (cells.length % 7 !== 0) cells.push({ d: nd++, out: true });
  const today = todayStr();
  cells.forEach(c => {
    const el = document.createElement('button');
    el.className = 'cal-cell';
    el.textContent = c.d;
    if (c.out) {
      el.classList.add('out');
      el.disabled = true;
    } else {
      if (notesOn(c.date).length) {
        const dot = document.createElement('i');
        dot.className = 'cal-dot';
        el.appendChild(dot);
      }
      if (c.date === today) el.classList.add('today');
      if (c.date === selDate) el.classList.add('sel');
      el.addEventListener('click', () => { selDate = c.date; renderCalendar(); renderNotes(); });
    }
    grid.appendChild(el);
  });
}
function renderNotes() {
  const list = $('noteList');
  list.innerHTML = '';
  notesOn(selDate).forEach((n) => {
    const d = document.createElement('div');
    d.className = 'note' + (n.done ? ' done' : '');
    const chk = document.createElement('span');
    chk.textContent = n.done ? '●' : '○';
    chk.style.color = n.done ? 'var(--ok)' : 'var(--txt2)';
    chk.style.cursor = 'pointer';
    chk.addEventListener('click', () => { n.done = !n.done; saveNotes(); renderNotes(); });
    const tx = document.createElement('span');
    tx.className = 'note-text'; tx.textContent = n.text;
    const del = document.createElement('span');
    del.className = 'note-del'; del.textContent = '删除';
    del.addEventListener('click', () => {
      const i = notes.indexOf(n);
      if (i >= 0) notes.splice(i, 1);
      saveNotes(); renderCalendar(); renderNotes();
    });
    d.append(chk, tx, del);
    list.appendChild(d);
  });
  if (!list.children.length) {
    const empty = document.createElement('div');
    empty.className = 'mu-lyric-empty';
    empty.textContent = '这一天还没有待办';
    list.appendChild(empty);
  }
  updateIslandSize();
}
function calShift(delta) {
  const d = new Date(calY, calM + delta, 1);
  calY = d.getFullYear(); calM = d.getMonth();
  renderCalendar();
}
$('calPrev').addEventListener('click', () => calShift(-1));
$('calNext').addEventListener('click', () => calShift(1));
$('calToday').addEventListener('click', () => {
  const d = new Date();
  calY = d.getFullYear(); calM = d.getMonth();
  selDate = todayStr();
  renderCalendar(); renderNotes();
});
function addNote() {
  const inp = $('noteInput');
  const t = inp.value.trim();
  if (!t) return;
  notes.unshift({ text: t, done: false, time: Date.now(), date: selDate });
  inp.value = ''; saveNotes(); renderCalendar(); renderNotes();
}
$('btnAddNote').addEventListener('click', addNote);
$('noteInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') addNote(); });

/* ==================== 计时工具 ==================== */
function fmtTimer(ms) {
  ms = Math.max(0, ms);
  const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000);
  return pad(m) + ':' + pad(s);
}

/* ==================== 番茄钟 ==================== */
const PHASE_TXT = { work: '专注', short: '小憩', long: '长休' };
const pomo = { phase: 'work', round: 1, left: 25 * 60000, running: false, endTs: 0, cfg: { work: 25, short: 5, long: 15, rounds: 4 } };
try {
  const pc = JSON.parse(localStorage.getItem('island_pomo_cfg') || 'null');
  if (pc) for (const k of Object.keys(pomo.cfg)) if (pc[k]) pomo.cfg[k] = +pc[k];
} catch (e) {}
const cfgMs = () => (pomo.cfg[pomo.phase] || 25) * 60000;
try {
  const ps = JSON.parse(localStorage.getItem('island_pomo') || 'null');
  if (ps && PHASE_TXT[ps.phase]) {
    pomo.phase = ps.phase;
    pomo.round = Math.max(1, ps.round | 0);
    if (ps.running && ps.endTs && ps.endTs > Date.now()) {
      pomo.running = true;
      pomo.endTs = ps.endTs;
      pomo.left = ps.endTs - Date.now();
    } else {
      pomo.left = ps.left > 0 ? Math.min(ps.left, cfgMs()) : cfgMs();
    }
  }
} catch (e) {}
function savePomo() {
  localStorage.setItem('island_pomo', JSON.stringify({
    phase: pomo.phase, round: pomo.round, left: pomo.left, running: pomo.running, endTs: pomo.endTs
  }));
}
function notifyUser(title, body) {
  try { new Notification(title, { body: body }); } catch (e) {}
}
const RING_LEN = 2 * Math.PI * 96;
function renderPomo() {
  $('poDisplay').textContent = fmtTimer(pomo.left);
  $('poPhase').textContent = PHASE_TXT[pomo.phase];
  $('poRoundsTxt').textContent = 'ROUND ' + pomo.round + ' / ' + pomo.cfg.rounds;
  const total = cfgMs();
  const frac = Math.max(0, Math.min(1, pomo.left / total));
  const ring = $('poRing');
  ring.style.strokeDasharray = RING_LEN;
  ring.style.strokeDashoffset = RING_LEN * (1 - frac);
  const cls = pomo.phase === 'work' ? 'cy-work' : (pomo.phase === 'short' ? 'cy-short' : 'cy-long');
  $('poDial').className = 'cy-dial ' + cls;
  $('btnPomoStart').textContent = pomo.running ? '计时中' : '开始';
  const cPomo = $('cPomo');
  if (pomo.running) {
    cPomo.classList.remove('hidden');
    cPomo.textContent = PHASE_TXT[pomo.phase] + ' ' + fmtTimer(pomo.left);
  } else {
    cPomo.classList.add('hidden');
  }
}
function pomoNext(silent) {
  if (pomo.phase === 'work') {
    if (pomo.round >= pomo.cfg.rounds) {
      pomo.phase = 'long';
      if (!silent) notifyUser('番茄钟', '已完成 ' + pomo.cfg.rounds + ' 轮专注，长休 ' + pomo.cfg.long + ' 分钟');
    } else {
      pomo.phase = 'short';
      if (!silent) notifyUser('番茄钟', '专注结束，小憩 ' + pomo.cfg.short + ' 分钟');
    }
  } else if (pomo.phase === 'short') {
    pomo.round++;
    pomo.phase = 'work';
    if (!silent) notifyUser('番茄钟', '休息结束，开始第 ' + pomo.round + ' 轮专注');
  } else {
    pomo.phase = 'work';
    pomo.round = 1;
    if (!silent) notifyUser('番茄钟', '长休结束，新一轮开始');
  }
  pomo.left = cfgMs();
  pomo.endTs = Date.now() + pomo.left;
}
setInterval(() => {
  if (pomo.running) {
    pomo.left = Math.max(0, pomo.endTs - Date.now());
    if (pomo.left <= 0) { pomoNext(false); } else savePomo();
  }
  renderPomo();
}, 250);
$('btnPomoStart').addEventListener('click', () => {
  if (pomo.running) return;
  if (pomo.left <= 0) pomo.left = cfgMs();
  pomo.endTs = Date.now() + pomo.left;
  pomo.running = true;
  savePomo();
});
$('btnPomoPause').addEventListener('click', () => {
  if (!pomo.running) return;
  pomo.left = Math.max(0, pomo.endTs - Date.now());
  pomo.running = false;
  savePomo();
});
$('btnPomoSkip').addEventListener('click', () => { pomoNext(false); savePomo(); });
$('btnPomoReset').addEventListener('click', () => {
  pomo.phase = 'work';
  pomo.round = 1;
  pomo.running = false;
  pomo.left = cfgMs();
  savePomo();
});
$('poApply').addEventListener('click', () => {
  const g = (id, lo, hi, d) => {
    const v = parseInt($(id).value);
    return isNaN(v) ? d : Math.min(hi, Math.max(lo, v));
  };
  pomo.cfg.work = g('poWork', 1, 120, 25);
  pomo.cfg.short = g('poShort', 1, 60, 5);
  pomo.cfg.long = g('poLong', 1, 90, 15);
  pomo.cfg.rounds = g('poRounds', 2, 10, 4);
  localStorage.setItem('island_pomo_cfg', JSON.stringify(pomo.cfg));
  if (!pomo.running) pomo.left = cfgMs();
  renderPomo();
});
function fillPomoCfgInputs() {
  $('poWork').value = pomo.cfg.work;
  $('poShort').value = pomo.cfg.short;
  $('poLong').value = pomo.cfg.long;
  $('poRounds').value = pomo.cfg.rounds;
}

/* ==================== 音乐控制 + 歌词 ==================== */
const SRC_MAP = [
  ['cloudmusic', '网易云音乐'], ['qqmusic', 'QQ音乐'], ['kugou', '酷狗音乐'],
  ['kuwo', '酷我音乐'], ['spotify', 'Spotify'], ['foobar', 'foobar2000'],
  ['itunes', 'iTunes'], ['msedge', 'Edge'], ['chrome', 'Chrome'],
  ['wmplayer', 'Windows 播放器'], ['mediaplayer', '媒体播放器']
];
const music = {
  state: null,
  lyric: [], lyricIdx: -1,
  trackKey: '', wantKey: '', thumb: '', lyricMsg: '',
  loadedDur: 0,
  posBase: 0, posAt: 0, prevPlaying: false,
  lyricOffset: 0
};
const ICON_PLAY = '<svg viewBox="0 0 24 24"><path d="M8.5 5.5v13L19 12z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24"><path d="M7.5 5.5h3.4v13H7.5zM13.1 5.5h3.4v13h-3.4z"/></svg>';

function srcName(src) {
  if (!src) return '';
  const s = String(src).toLowerCase();
  for (const m of SRC_MAP) if (s.indexOf(m[0]) >= 0) return m[1];
  return String(src).split('.')[0];
}
function cleanSongTitle(t) {
  const s = String(t || '').replace(/\s*[(（【\[].*?[)）】\]]\s*/g, '').trim();
  return s || String(t || '');
}
function applyArt(url) {
  const amb = $('muAmbient');
  if (!amb) return;
  if (url && url.indexOf('data:') === 0) {
    amb.style.backgroundImage = 'url("' + url + '")';
    amb.classList.add('on');
  } else {
    amb.classList.remove('on');
    amb.style.backgroundImage = '';
  }
}
window.island.onMusicThumb((d) => {
  if (!d || !d.url || !d.k) return;
  if (!music.trackKey || music.trackKey.indexOf(d.k + '|') !== 0) return;
  music.thumb = d.url;
  applyArt(d.url);
});
window.island.onMusicState((st) => { onMusicState(st); });
function isPlaying(st) { return !!(st && st.active && st.status === 4); }
function musicElapsed(now) {
  const st = music.state;
  if (!st || !st.active) return 0;
  return Math.max(0, music.posBase + (isPlaying(st) ? (now - music.posAt) / 1000 : 0));
}
function musicDur() {
  const st = music.state;
  if (st && st.active && st.dur > 0) return st.dur;
  if (music.lyric.length) return Math.ceil(music.lyric[music.lyric.length - 1].t) + 6;
  return 0;
}
function onMusicState(st) {
  const now = Date.now();
  const prevKey = music.trackKey;
  music.state = st || null;
  const key = st && st.active && st.title ? (st.title + '|' + st.artist) : '';
  const playing = isPlaying(st);
  const smtcPos = (st && typeof st.pos === 'number') ? st.pos : 0;
  const smtcDur = (st && typeof st.dur === 'number') ? st.dur : 0;

  if (key && key !== prevKey) {
    music.trackKey = key;
    music.lyric = [];
    music.lyricIdx = -1;
    music.thumb = '';
    music.lyricMsg = '';
    music.loadedDur = smtcDur;
    music.posBase = smtcPos > 0 ? smtcPos : 0;
    music.posAt = now;
    applyArt(null);
    loadLyric(st.title, st.artist, smtcDur, st.album || '');
  } else if (st && st.active) {
    if (smtcDur > 5 && Math.abs(smtcDur - (music.loadedDur || 0)) > 2) {
      music.loadedDur = smtcDur;
      loadLyric(st.title, st.artist, smtcDur, st.album || '');
    }
    const computed = musicElapsed(now);
    const hasTimeline = smtcDur > 0 || smtcPos > 0;
    if (hasTimeline) {
      if (playing !== music.prevPlaying || Math.abs(smtcPos - computed) > 0.35) {
        music.posBase = smtcPos;
        music.posAt = now;
      }
    } else if (playing !== music.prevPlaying) {
      music.posBase = computed;
      music.posAt = now;
    }
  } else {
    music.trackKey = '';
    music.lyric = [];
    music.lyricIdx = -1;
    music.thumb = '';
    music.lyricMsg = '';
    music.loadedDur = 0;
    music.posBase = 0;
    music.posAt = now;
    applyArt(null);
    renderLyricWindow(false);
  }
  music.prevPlaying = playing;
  renderMusic();
}
async function loadLyric(title, artist, dur, album) {
  const reqId = title + '|' + artist + '|' + Math.round(dur || 0);
  music.wantKey = reqId;
  let r = null;
  try { r = await window.island.getLyric(title, artist, dur || 0, album || ''); } catch (e) { r = null; }
  if (music.wantKey !== reqId) return;
  const META_RE = /^[^\s：:]{1,10}\s*[：:]/i;
  if (r && r.ok && r.lines && r.lines.length) {
    const baseT = cleanSongTitle(title);
    const lines = r.lines.filter(l => {
      if (META_RE.test(l.text)) return false;
      if (/^[\s.。、，,~～\-—…·/]+$/.test(l.text)) return false;
      if (l.t < 6 && l.text.indexOf('-') >= 0 && baseT && l.text.indexOf(baseT) >= 0) return false;
      return true;
    });
    music.lyric = lines.length ? lines : r.lines;
    music.lyricIdx = -999;
    music.lyricMsg = '';
  } else {
    music.lyric = [];
    music.lyricIdx = -1;
    music.lyricMsg = (r && r.msg) ? r.msg : '未找到歌词';
  }
  renderLyricWindow(false);
  updateLyric(musicElapsed(Date.now()) + music.lyricOffset);
  updateMusicMini();
}
function renderLyricWindow(anim) {
  if (!music.lyric.length) {
    $('lyPrev').textContent = '';
    $('lyNext').textContent = '';
    $('lyCur').textContent = (music.state && music.state.active)
      ? (music.lyricMsg || '歌词加载中…')
      : '等待播放…';
    return;
  }
  const i = music.lyricIdx;
  const get = (k) => (k >= 0 && k < music.lyric.length) ? music.lyric[k].text : '';
  if (i < 0) {
    $('lyPrev').textContent = '· 前奏 ·';
    $('lyCur').textContent = get(0);
    $('lyNext').textContent = get(1);
  } else {
    $('lyPrev').textContent = get(i - 1);
    $('lyCur').textContent = get(i);
    $('lyNext').textContent = get(i + 1);
  }
  if (anim) {
    const el = $('lyCur');
    el.classList.remove('ly-anim');
    void el.offsetWidth;
    el.classList.add('ly-anim');
  }
}
function updateLyric(pos) {
  if (!music.lyric.length) return;
  let idx = -1;
  for (let i = 0; i < music.lyric.length; i++) {
    if (music.lyric[i].t <= pos + 0.2) idx = i; else break;
  }
  if (idx === music.lyricIdx) return;
  music.lyricIdx = idx;
  renderLyricWindow(true);
}
// 收起态：最前面显示歌曲名称（#cSong），紧接着显示同步歌词（#cLyric），后面是科技状态图标+数字
let lastMarquee = { text: null, scrolling: null };
function setMarquee(line, scrolling, durSec) {
  const tx = $('cLyric');
  if (!tx) return;
  if (lastMarquee.text === line && lastMarquee.scrolling === scrolling) return;
  lastMarquee.text = line;
  lastMarquee.scrolling = scrolling;
  tx.innerHTML = '';
  tx.classList.remove('scrolling');
  if (!scrolling) {
    tx.textContent = line;
    return;
  }
  for (let i = 0; i < 2; i++) {
    const s = document.createElement('span');
    s.className = 'mq';
    s.textContent = line;
    tx.appendChild(s);
  }
  tx.classList.add('scrolling');
  tx.style.animationDuration = Math.max(5, durSec) + 's';
}
function updateMusicMini() {
  const st = music.state;
  const active = !!(st && st.active && st.title);
  const cMusic = $('cMusic');
  if (!active) {
    cMusic.classList.add('hidden');
    return;
  }
  cMusic.classList.remove('hidden');
  const playing = st.status === 4;
  const shortSong = cleanSongTitle(st.title);
  const songLabel = (playing ? '▶ ' : '⏸ ') + (shortSong.length > 7 ? shortSong.slice(0, 7) + '…' : shortSong);
  if ($('cSong').textContent !== songLabel) $('cSong').textContent = songLabel;

  let line = '';
  if (music.lyric.length) {
    const pick = music.lyricIdx >= 0 ? music.lyric[music.lyricIdx] : music.lyric[0];
    line = pick ? pick.text : '';
    const cut = line.indexOf('  /  ');
    if (cut > 0) line = line.slice(0, cut);
  }
  if (!line) {
    line = st.artist || (playing ? '正在播放' : '已暂停');
  }
  if (playing) {
    setMarquee(line, line.length > 13, line.length * 0.52);
  } else {
    const t = line.length > 13 ? line.slice(0, 13) + '…' : line;
    setMarquee(t, false);
  }
  fitCollapsedWidth();
}
function renderMusic() {
  const st = music.state;
  const active = !!(st && st.active && st.title);
  const playing = active && st.status === 4;
  $('muTitle').textContent = active ? st.title : '未播放';
  $('muSub').textContent = active
    ? ((st.artist || '未知歌手') + (st.album ? ' · ' + st.album : ''))
    : '打开音乐软件播放后自动识别';
  $('muSrc').textContent = active ? srcName(st.source) : '';
  $('muToggle').innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
  const dur = musicDur();
  if (dur > 0) $('muDur').textContent = fmtTimer(dur * 1000);
  if (!active) {
    $('muPosCur').textContent = '--:--';
    $('muDur').textContent = '--:--';
    $('muBarFill').style.width = '0';
    if ($('cLyric')) $('cLyric').classList.remove('scrolling');
  }
  islandEl.classList.toggle('music-mini', active);
  updateMusicMini();
}
setInterval(() => {
  const st = music.state;
  if (!st || !st.active) return;
  const pos = musicElapsed(Date.now());
  const dur = musicDur();
  $('muPosCur').textContent = fmtTimer(pos * 1000);
  if (dur > 0) {
    $('muBarFill').style.width = Math.min(100, (pos / dur) * 100) + '%';
    $('muDur').textContent = fmtTimer(dur * 1000);
  }
  updateLyric(pos + music.lyricOffset);
  updateMusicMini();
}, 250);
$('lyEarly').addEventListener('click', () => {
  music.lyricOffset -= 0.5;
  music.lyricIdx = -999;
  updateLyric(musicElapsed(Date.now()) + music.lyricOffset);
});
$('lyLate').addEventListener('click', () => {
  music.lyricOffset += 0.5;
  music.lyricIdx = -999;
  updateLyric(musicElapsed(Date.now()) + music.lyricOffset);
});
$('muToggle').addEventListener('click', () => window.island.musicCmd('toggle'));
$('muPrev').addEventListener('click', () => window.island.musicCmd('prev'));
$('muNext').addEventListener('click', () => window.island.musicCmd('next'));
$('muVolUp').addEventListener('click', () => window.island.musicCmd('volup'));
$('muVolDn').addEventListener('click', () => window.island.musicCmd('voldown'));
$('muVolMute').addEventListener('click', () => window.island.musicCmd('mute'));

/* ==================== 文件暂存区（File Shelf） ==================== */
const ICO_VIEW_LIST = '<path d="M4 6h16v2.5H4zm0 5h16v2.5H4zm0 5h16v2.5H4z"/>';
const ICO_VIEW_GRID = '<path d="M4 4h7v7H4zm9 0h7v7h-7zM4 13h7v7H4zm9 0h7v7h-7z"/>';
const SVG_FOLDER = '<svg viewBox="0 0 24 24"><path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z" fill="#00d8f6" fill-opacity="0.24" stroke="#00f0ff" stroke-width="1.6"/></svg>';
const SVG_FILE = '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" fill="#9a82ff" fill-opacity="0.2" stroke="#b98aff" stroke-width="1.6"/><path d="M14 2v6h6" fill="none" stroke="#b98aff" stroke-width="1.6"/></svg>';

function fmtDateTime(ms) {
  if (!ms) return '--';
  const d = new Date(ms);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function getFilteredShelfItems() {
  if (shelfCat === 'all') return shelfItems;
  return shelfItems.filter(x => x.cat === shelfCat);
}

function updateShelfViewBtn() {
  const ico = $('sfViewIco');
  if (!ico) return;
  // 当前是图标视图时，右上角显示列表图标（点击切列表）；当前是列表视图时显示网格图标
  ico.innerHTML = shelfView === 'icon' ? ICO_VIEW_LIST : ICO_VIEW_GRID;
  $('sfViewBtn').title = shelfView === 'icon' ? '切换为列表存放视图' : '切换为图标存放视图';
}

function renderShelfSelect() {
  const sel = $('sfSelect');
  if (!sel) return;
  if (shelfItems.length === 0) {
    sel.classList.add('hidden');
    return;
  }
  sel.classList.remove('hidden');
  const counts = { all: shelfItems.length, dir: 0, doc: 0, media: 0, arc: 0, app: 0, other: 0 };
  shelfItems.forEach(x => { counts[x.cat] = (counts[x.cat] || 0) + 1; });

  sel.innerHTML = '';
  const grpCat = document.createElement('optgroup');
  grpCat.label = '按分类筛选';
  const cats = [
    ['all', '全部暂存 (' + counts.all + ')'],
    ['dir', '文件夹 (' + counts.dir + ')'],
    ['doc', '文档 / 图纸 (' + counts.doc + ')'],
    ['media', '图片 / 音视频 (' + counts.media + ')'],
    ['arc', '压缩包 (' + counts.arc + ')'],
    ['app', '程序 / 脚本 (' + counts.app + ')'],
    ['other', '其他文件 (' + counts.other + ')']
  ];
  cats.forEach(([k, label]) => {
    if (k !== 'all' && !counts[k] && shelfCat !== k) return;
    const o = document.createElement('option');
    o.value = 'cat:' + k;
    o.textContent = label;
    if (shelfCat === k) o.selected = true;
    grpCat.appendChild(o);
  });
  sel.appendChild(grpCat);

  const grpFiles = document.createElement('optgroup');
  grpFiles.label = '下拉直接选择文件 (' + shelfItems.length + ')';
  shelfItems.forEach((item, idx) => {
    const o = document.createElement('option');
    o.value = 'file:' + item.path;
    const sz = item.isDir ? ((item.childCount || 0) + '项') : fmtBytes(item.size || 0);
    o.textContent = (idx + 1) + '. ' + item.name + ' (' + sz + ')';
    grpFiles.appendChild(o);
  });
  sel.appendChild(grpFiles);
}

function renderShelfDetail() {
  const detail = $('sfDetail');
  const filtered = getFilteredShelfItems();
  if (!filtered.length) {
    detail.classList.add('hidden');
    return;
  }
  detail.classList.remove('hidden');
  let item = filtered.find(x => x.path === shelfSelPath) || filtered[0];
  shelfSelPath = item.path;
  $('sfDtName').textContent = item.name + '  [' + item.typeLabel + ']';
  const sizeStr = item.isDir
    ? ('包含 ' + (item.childCount != null ? item.childCount : 0) + ' 项 · 共 ' + fmtBytes(item.size || 0))
    : ('大小 ' + fmtBytes(item.size || 0) + ' (' + (item.size || 0).toLocaleString() + ' 字节)');
  $('sfDtMeta').textContent = sizeStr + ' · 修改于 ' + fmtDateTime(item.mtime);
  $('sfDtPath').textContent = '路径：' + item.path;
}

function renderShelf() {
  updateShelfViewBtn();
  const total = shelfItems.length;
  $('sfCount').textContent = total + ' 项暂存';
  $('sfClearBtn').classList.toggle('hidden', total === 0);
  renderShelfSelect();

  const filtered = getFilteredShelfItems();
  const emptyEl = $('sfEmpty');
  const itemsEl = $('sfItems');
  if (!filtered.length) {
    emptyEl.classList.remove('hidden');
    itemsEl.classList.add('hidden');
    itemsEl.innerHTML = '';
    $('sfDetail').classList.add('hidden');
    updateIslandSize();
    return;
  }
  emptyEl.classList.add('hidden');
  itemsEl.classList.remove('hidden');
  itemsEl.className = shelfView === 'icon' ? 'sf-grid' : 'sf-list';
  itemsEl.innerHTML = '';

  if (!filtered.some(x => x.path === shelfSelPath)) {
    shelfSelPath = filtered[0].path;
  }

  filtered.forEach((item) => {
    const sizeShort = item.isDir
      ? ((item.childCount != null ? item.childCount : 0) + ' 项')
      : fmtBytes(item.size || 0);
    const fullTip =
      '名称：' + item.name +
      '\n类型：' + item.typeLabel +
      '\n大小：' + (item.isDir ? (sizeShort + ' (' + fmtBytes(item.size || 0) + ')') : (fmtBytes(item.size || 0) + ' (' + (item.size || 0).toLocaleString() + ' B)')) +
      '\n修改：' + fmtDateTime(item.mtime) +
      '\n路径：' + item.path +
      '\n\n提示：按住可直接拖出到桌面/任意文件夹；双击直接打开查看';

    if (shelfView === 'icon') {
      const card = document.createElement('div');
      card.className = 'sf-card' + (item.path === shelfSelPath ? ' sel' : '');
      card.draggable = true;
      card.title = fullTip;
      card.dataset.path = item.path;

      const icoBox = document.createElement('div');
      icoBox.className = 'sf-ico-box';
      if (item.isDir) {
        icoBox.innerHTML = SVG_FOLDER;
      } else if (item.icon) {
        const img = document.createElement('img');
        img.src = item.icon;
        icoBox.appendChild(img);
      } else {
        icoBox.innerHTML = SVG_FILE;
      }
      const tag = document.createElement('span');
      tag.className = 'sf-ext-tag';
      tag.textContent = item.ext.slice(0, 4);
      icoBox.appendChild(tag);

      const nm = document.createElement('div');
      nm.className = 'sf-card-name';
      nm.textContent = item.name;

      const sub = document.createElement('div');
      sub.className = 'sf-card-sub';
      sub.textContent = sizeShort;

      const del = document.createElement('button');
      del.className = 'sf-card-del';
      del.textContent = '×';
      del.title = '从暂存区移除';
      del.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        shelfItems = await window.island.shelfRemove(item.path);
        renderShelf();
      });

      card.append(icoBox, nm, sub, del);
      card.addEventListener('click', () => {
        shelfSelPath = item.path;
        itemsEl.querySelectorAll('.sf-card').forEach(c => c.classList.toggle('sel', c.dataset.path === shelfSelPath));
        renderShelfDetail();
      });
      card.addEventListener('mouseenter', () => {
        shelfSelPath = item.path;
        itemsEl.querySelectorAll('.sf-card').forEach(c => c.classList.toggle('sel', c.dataset.path === shelfSelPath));
        renderShelfDetail();
      });
      card.addEventListener('dblclick', () => {
        window.island.shelfOpen(item.path);
      });
      card.addEventListener('dragstart', (ev) => {
        ev.preventDefault();
        internalDragging = true;
        window.island.shelfStartDrag(item.path);
        setTimeout(() => { internalDragging = false; }, 600);
      });
      itemsEl.appendChild(card);
    } else {
      const row = document.createElement('div');
      row.className = 'sf-row' + (item.path === shelfSelPath ? ' sel' : '');
      row.draggable = true;
      row.title = fullTip;
      row.dataset.path = item.path;

      const icoBox = document.createElement('div');
      icoBox.className = 'sf-ico-box';
      if (item.isDir) icoBox.innerHTML = SVG_FOLDER;
      else if (item.icon) {
        const img = document.createElement('img');
        img.src = item.icon;
        icoBox.appendChild(img);
      } else icoBox.innerHTML = SVG_FILE;

      const info = document.createElement('div');
      info.className = 'sf-row-info';
      const top = document.createElement('div');
      top.className = 'sf-row-top';
      const nm = document.createElement('span');
      nm.className = 'sf-row-name';
      nm.textContent = item.name;
      const tp = document.createElement('span');
      tp.className = 'sf-row-type';
      tp.textContent = item.typeLabel;
      top.append(nm, tp);

      const meta = document.createElement('div');
      meta.className = 'sf-row-meta';
      meta.textContent = (item.isDir ? (sizeShort + ' · ' + fmtBytes(item.size || 0)) : fmtBytes(item.size || 0)) + ' · 修改 ' + fmtDateTime(item.mtime);

      const pth = document.createElement('div');
      pth.className = 'sf-row-path';
      pth.textContent = item.path;
      info.append(top, meta, pth);

      const ops = document.createElement('div');
      ops.className = 'sf-row-ops';
      const bOpen = document.createElement('button');
      bOpen.className = 'sf-act primary';
      bOpen.textContent = '打开';
      bOpen.addEventListener('click', (ev) => { ev.stopPropagation(); window.island.shelfOpen(item.path); });

      const bTake = document.createElement('button');
      bTake.className = 'sf-act';
      bTake.textContent = '取出';
      bTake.title = '复制到剪贴板，可在桌面/任意文件夹 Ctrl+V 粘贴取出';
      bTake.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const ok = await window.island.shelfCopyFile(item.path);
        bTake.textContent = ok ? '已复制' : '失败';
        setTimeout(() => { bTake.textContent = '取出'; }, 1200);
      });

      const bDel = document.createElement('button');
      bDel.className = 'sf-act danger';
      bDel.textContent = '×';
      bDel.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        shelfItems = await window.island.shelfRemove(item.path);
        renderShelf();
      });
      ops.append(bOpen, bTake, bDel);

      row.append(icoBox, info, ops);
      row.addEventListener('click', () => {
        shelfSelPath = item.path;
        itemsEl.querySelectorAll('.sf-row').forEach(r => r.classList.toggle('sel', r.dataset.path === shelfSelPath));
        renderShelfDetail();
      });
      row.addEventListener('dblclick', () => {
        window.island.shelfOpen(item.path);
      });
      row.addEventListener('dragstart', (ev) => {
        ev.preventDefault();
        internalDragging = true;
        window.island.shelfStartDrag(item.path);
        setTimeout(() => { internalDragging = false; }, 600);
      });
      itemsEl.appendChild(row);
    }
  });

  renderShelfDetail();
  updateIslandSize();
}

async function loadShelf() {
  try { shelfItems = await window.island.shelfList(); } catch (e) { shelfItems = []; }
  renderShelf();
}

$('sfViewBtn').addEventListener('click', () => {
  shelfView = shelfView === 'icon' ? 'list' : 'icon';
  localStorage.setItem('island_shelf_view', shelfView);
  renderShelf();
});

$('sfClearBtn').addEventListener('click', async () => {
  shelfItems = await window.island.shelfRemove('__ALL__');
  renderShelf();
});

$('sfSelect').addEventListener('change', (e) => {
  const val = String(e.target.value || '');
  if (val.indexOf('cat:') === 0) {
    shelfCat = val.slice(4);
    renderShelf();
  } else if (val.indexOf('file:') === 0) {
    const targetPath = val.slice(5);
    shelfCat = 'all';
    shelfSelPath = targetPath;
    renderShelf();
    const box = $('sfItems');
    const targetEl = box.querySelector('[data-path="' + CSS.escape(targetPath) + '"]');
    if (targetEl) targetEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
});

$('sfBtnOpen').addEventListener('click', () => {
  if (shelfSelPath) window.island.shelfOpen(shelfSelPath);
});
$('sfBtnTake').addEventListener('click', async () => {
  if (!shelfSelPath) return;
  const btn = $('sfBtnTake');
  const ok = await window.island.shelfCopyFile(shelfSelPath);
  btn.textContent = ok ? '已复制(可粘贴)' : '失败';
  setTimeout(() => { btn.textContent = '取出'; }, 1400);
});
$('sfBtnReveal').addEventListener('click', () => {
  if (shelfSelPath) window.island.shelfReveal(shelfSelPath);
});
$('sfBtnDel').addEventListener('click', async () => {
  if (!shelfSelPath) return;
  shelfItems = await window.island.shelfRemove(shelfSelPath);
  renderShelf();
});

// 全局文件/文件夹拖入检测：鼠标拖文件移到胶囊位置时，自动展开并切到「暂存」界面
function isFileDrag(e) {
  if (internalDragging) return false;
  const dt = e.dataTransfer;
  if (!dt || !dt.types) return false;
  for (let i = 0; i < dt.types.length; i++) {
    if (dt.types[i] === 'Files') return true;
  }
  return false;
}

window.addEventListener('dragenter', (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  dragHoldUntil = Date.now() + 1000;
  expand();
  if (curPage !== 'shelf') switchTab('shelf');
  $('sfDropZone').classList.add('drag-over');
});

window.addEventListener('dragover', (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  dragHoldUntil = Date.now() + 1000;
  if (!isExpanded()) expand();
  if (curPage !== 'shelf') switchTab('shelf');
  $('sfDropZone').classList.add('drag-over');
});

window.addEventListener('dragleave', (e) => {
  if (e.relatedTarget === null) {
    $('sfDropZone').classList.remove('drag-over');
  }
});

window.addEventListener('drop', async (e) => {
  $('sfDropZone').classList.remove('drag-over');
  if (!isFileDrag(e)) return;
  e.preventDefault();
  dragHoldUntil = Date.now() + 600;
  const files = e.dataTransfer ? e.dataTransfer.files : null;
  if (!files || !files.length) return;
  const paths = [];
  for (let i = 0; i < files.length; i++) {
    const p = window.island.getPathForFile(files[i]);
    if (p) paths.push(p);
  }
  if (paths.length) {
    shelfCat = 'all';
    shelfItems = await window.island.shelfAdd(paths);
    if (shelfItems.length) shelfSelPath = shelfItems[0].path;
    if (curPage !== 'shelf') switchTab('shelf');
    else renderShelf();
  }
});

/* ==================== 剪贴板历史 ==================== */
async function renderClips() {
  let list = [];
  try { list = await window.island.getClips(); } catch (e) {}
  lastClipCount = list.length;
  const el = $('clipList');
  el.innerHTML = '';
  $('clipCount').textContent = '共 ' + list.length + ' 条';
  list.forEach((c) => {
    const d = document.createElement('div');
    d.className = 'clip';
    const tx = document.createElement('div');
    tx.className = 'clip-text'; tx.textContent = c.text;
    const tm = document.createElement('div');
    tm.className = 'clip-time';
    const dt = new Date(c.time);
    tm.textContent = '点击复制 · ' + pad(dt.getHours()) + ':' + pad(dt.getMinutes()) + ' · ' + c.text.length + ' 字';
    d.append(tx, tm);
    d.addEventListener('click', () => {
      window.island.copyClip(c.text);
      tm.textContent = '已复制';
      setTimeout(() => { tm.textContent = '点击复制'; }, 1000);
    });
    el.appendChild(d);
  });
  updateIslandSize();
}
$('btnClipClear').addEventListener('click', async () => {
  await window.island.clearClips(); renderClips();
});
window.island.onClipsNew(() => {
  if (document.getElementById('page-clips').classList.contains('active')) renderClips();
});

/* ==================== 天气（Open-Meteo 免费 API） ==================== */
const WMO = { 0: '晴', 1: '基本晴', 2: '少云', 3: '多云', 45: '雾', 48: '雾凇', 51: '毛毛雨·轻', 53: '毛毛雨', 55: '毛毛雨·浓', 61: '小雨', 63: '中雨', 65: '大雨', 66: '冻雨·轻', 67: '冻雨·重', 71: '小雪', 73: '中雪', 75: '大雪', 77: '雪粒', 80: '阵雨·轻', 81: '阵雨', 82: '暴雨·阵', 85: '阵雪·小', 86: '阵雪·大', 95: '雷暴', 96: '雷暴·冰雹轻', 99: '雷暴·冰雹重' };
let weatherBusy = false;
async function loadWeather(force) {
  if (weatherBusy) return;
  const city = (config && config.weather && config.weather.city) || '北京';
  // 缓存 30 分钟
  if (!force) {
    try {
      const cache = JSON.parse(localStorage.getItem('island_weather') || 'null');
      if (cache && cache.city === city && Date.now() - cache.time < 30 * 60 * 1000) {
        renderWeather(cache.data, cache.cityName || city); return;
      }
    } catch (e) {}
  }
  weatherBusy = true;
  $('wtMain').textContent = '获取中…';
  try {
    const geo = await (await fetch('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(city) + '&count=1&language=zh&format=json')).json();
    if (!geo.results || !geo.results.length) { $('wtMain').textContent = '未找到城市：' + city; weatherBusy = false; return; }
    const g = geo.results[0];
    const w = await (await fetch('https://api.open-meteo.com/v1/forecast?latitude=' + g.latitude + '&longitude=' + g.longitude + '&current_weather=true&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=3')).json();
    renderWeather(w, g.name || city);
    localStorage.setItem('island_weather', JSON.stringify({ city, cityName: g.name || city, time: Date.now(), data: w }));
  } catch (e) {
    $('wtMain').textContent = '获取失败（网络）：' + (e.message || e);
  }
  weatherBusy = false;
}
function renderWeather(w, cityName) {
  $('wtCity').textContent = cityName;
  const cur = w.current_weather || {};
  const desc = WMO[cur.weather_code] != null ? WMO[cur.weather_code] : '天气代码 ' + cur.weather_code;
  $('wtMain').innerHTML =
    '<div class="wt-temp">' + Math.round(cur.temperature || 0) + '°C</div>' +
    '<div class="wt-desc">' + desc + '</div>' +
    '<div class="wt-detail">风速 ' + Math.round((cur.wind_speed || 0) * 10) / 10 + ' km/h</div>';
  const days = w.daily || {};
  const box = $('wtDays');
  box.innerHTML = '';
  for (let i = 0; i < Math.min(3, (days.time || []).length); i++) {
    const d = document.createElement('div');
    d.className = 'wt-day';
    const dt = new Date(days.time[i]);
    d.innerHTML = '<span>' + (i === 0 ? '今天' : WEEK[dt.getDay()]) + '</span>' +
      '<b>' + Math.round(days.temperature_2m_max[i]) + '° / ' + Math.round(days.temperature_2m_min[i]) + '°</b>' +
      '<span>' + (WMO[days.weather_code[i]] != null ? WMO[days.weather_code[i]] : '-') + '</span>';
    box.appendChild(d);
  }
}
$('btnWtRefresh').addEventListener('click', () => loadWeather(true));

/* ==================== 外观应用 & 独立设置窗口 ==================== */
function applyAppearance(cfg) {
  const a = (cfg && cfg.appearance) || {};
  try {
    const fs = (typeof a.fontScale === 'number' && a.fontScale >= 0.8 && a.fontScale <= 1.4) ? a.fontScale : 1;
    islandEl.style.zoom = fs;
    islandEl.style.fontFamily = a.fontFamily
      ? ('"' + a.fontFamily + '", "Segoe UI", "Microsoft YaHei", sans-serif')
      : '';
    if (a.accent) document.documentElement.style.setProperty('--acc', a.accent);
    const op = (typeof a.opacity === 'number') ? Math.max(0.55, Math.min(1, a.opacity)) : 0.97;
    islandEl.style.background = 'rgba(14,14,19,' + op + ')';
    const top = (typeof a.topOffset === 'number') ? Math.max(0, Math.min(60, a.topOffset)) : 8;
    islandEl.style.top = top + 'px';
  } catch (e) {}
}
$('btnOpenSettings').addEventListener('click', () => window.island.settingsOpen());
window.island.onConfigChanged(async () => {
  try { config = await window.island.getConfig(); } catch (e) {}
  applyAppearance(config);
  if (config && config.deepseek && config.deepseek.apiKey) {
    $('chatHint').classList.add('hidden');
  } else {
    $('chatHint').textContent = '提示：AI 功能需在「设置」中填入 DeepSeek API Key（设置窗口右上角齿轮或展开岛点齿轮打开）';
    $('chatHint').classList.remove('hidden');
  }
});
window.island.onWater((d) => {
  if (d) waterState = d;
  const mWater = $('mWater');
  if (waterState && waterState.enabled) {
    mWater.classList.remove('hidden');
    $('mWaterT').textContent = Math.max(0, Math.ceil(waterState.left / 60)) + '分';
  } else {
    mWater.classList.add('hidden');
  }
  fitCollapsedWidth();
});

/* ==================== 初始化 ==================== */
(async function init() {
  try { config = await window.island.getConfig(); } catch (e) { config = null; }
  applyAppearance(config);
  if (config && config.deepseek && config.deepseek.apiKey) {
    $('chatHint').classList.add('hidden');
  } else {
    $('chatHint').textContent = '提示：AI 功能需在「设置」中填入 DeepSeek API Key（点击岛右上角齿轮打开设置）';
    $('chatHint').classList.remove('hidden');
  }
  loadChats();
  if (!chats.length) newChat(); else { curChatId = chats[0].id; renderChatSel(); renderMsgs(); }
  renderCalendar();
  renderNotes();
  fillPomoCfgInputs();
  renderPomo();
  renderClips();
  loadShelf();
  refreshStats();
  loadWeather(false);
  try {
    const mInit = await window.island.getMusicState();
    if (mInit && mInit.state) onMusicState(mInit.state);
    if (mInit && mInit.thumb && mInit.thumb.url) {
      music.thumb = mInit.thumb.url;
      applyArt(mInit.thumb.url);
    }
  } catch (e) {}
})();
