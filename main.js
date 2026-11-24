const { app, BrowserWindow, screen, ipcMain, clipboard, powerMonitor, Tray, Menu, globalShortcut, nativeImage, shell, Notification } = require('electron');
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ---------- 全局状态 ----------
let win = null;
let tray = null;
let ignoring = true;      // 当前是否点击穿透
let pinned = false;        // 快捷键唤出后固定展开
let lastRect = null;       // 渲染层上报的岛矩形（窗口内坐标）
let pendingHide = null;    // 延迟收起计时器
let cpuUsage = 0;
let lastSample = null;      // CPU 采样
let clips = [];
let lastClipText = '';
let currentAbort = null;

// ---------- 配置 ----------
const DEFAULTS = {
  deepseek: {
    apiKey: '',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    temperature: 0.7,
    systemPrompt: '你是运行在用户桌面“浮屿”中的 AI 助手，回答简洁、实用、中文。'
  },
  weather: { city: '北京' },
  general: { autoStart: true },
  water: { intervalMin: 60 },
  appearance: {
    fontFamily: '',
    fontScale: 1,
    accent: '#4c8dff',
    opacity: 0.97,
    topOffset: 8
  }
};

function configPath() { return path.join(app.getPath('userData'), 'config.json'); }

function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    const c = JSON.parse(JSON.stringify(DEFAULTS));
    for (const k of Object.keys(DEFAULTS)) c[k] = Object.assign({}, c[k], raw[k] || {});
    return c;
  } catch (e) { return JSON.parse(JSON.stringify(DEFAULTS)); }
}
function saveConfig(c) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(c, null, 2), 'utf8');
}
// ---------- 旧数据迁移（灵动岛 -> 浮屿，改名后自动搬迁配置与本地数据） ----------
function migrateUserData() {
  try {
    const newPath = app.getPath('userData');
    if (fs.existsSync(path.join(newPath, 'config.json'))) return;
    const parent = path.dirname(newPath);
    const candidates = [path.join(parent, '灵动岛'), path.join(parent, 'dynamic-island')];
    for (const oldDir of candidates) {
      if (!fs.existsSync(oldDir)) continue;
      for (const f of ['config.json', 'shelf.json']) {
        const src = path.join(oldDir, f);
        const dst = path.join(newPath, f);
        if (fs.existsSync(src) && !fs.existsSync(dst)) {
          fs.mkdirSync(newPath, { recursive: true });
          fs.copyFileSync(src, dst);
        }
      }
      const lsSrc = path.join(oldDir, 'Local Storage');
      const lsDst = path.join(newPath, 'Local Storage');
      if (fs.existsSync(lsSrc) && !fs.existsSync(lsDst)) {
        fs.cpSync(lsSrc, lsDst, { recursive: true });
      }
      break;
    }
  } catch (e) {}
}
migrateUserData();

let config = loadConfig();

// ---------- 工具 ----------
function send(ch, data) {
  if (win && !win.isDestroyed()) {
    try { win.webContents.send(ch, data); } catch (e) {}
  }
}
function broadcast(ch, data) {
  for (const w of BrowserWindow.getAllWindows()) {
    try { w.webContents.send(ch, data); } catch (e) {}
  }
}

// ---------- 鼠标悬停检测（浮屿核心） ----------
function pollMouse() {
  if (!win || win.isDestroyed() || !lastRect) return;
  const p = screen.getCursorScreenPoint();
  const b = win.getBounds();
  const ax = b.x + lastRect.x, ay = b.y + lastRect.y;
  // 收起态外扩 16px 感应区，确保拖拽文件靠近胶囊前即解除鼠标穿透并触发 dragenter
  const pad = lastRect.h <= 60 ? 16 : 6;
  const inside = p.x >= ax - pad && p.x <= ax + lastRect.w + pad && p.y >= Math.max(0, ay - pad) && p.y <= ay + lastRect.h + pad;

  if (inside) {
    if (pendingHide) { clearTimeout(pendingHide); pendingHide = null; }
    if (ignoring) {
      ignoring = false;
      pinned = false;
      try { win.setIgnoreMouseEvents(false); } catch (e) {}
      send('island:enter');
    }
  } else {
    if (pinned) return; // 固定展开时不自动收起
    if (!ignoring && !pendingHide) {
      pendingHide = setTimeout(() => {
        pendingHide = null;
        if (!win || win.isDestroyed() || ignoring || pinned) return;
        ignoring = true;
        try { win.setIgnoreMouseEvents(true, { forward: true }); } catch (e) {}
        send('island:leave');
      }, 160);
    }
  }
}

// ---------- 窗口 ----------
function createWindow() {
  const work = screen.getPrimaryDisplay().workAreaSize;
  const W = 1000, H = 760;
  win = new BrowserWindow({
    width: W, height: H,
    x: Math.round((work.width - W) / 2), y: 0,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.webContents.on('did-finish-load', () => {
    // 渲染层加载完成后同步一次全屏收缩状态
    if (lastFsSent) send('sys:fullscreen', true);
  });
  win.on('closed', () => { win = null; });
  if (process.argv.includes('--dev')) {
    win.webContents.openDevTools({ mode: 'detach' });
  }
  setInterval(pollMouse, 40);
}

// ---------- 托盘 ----------
function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  let img;
  try { img = nativeImage.createFromPath(iconPath); } catch (e) { img = nativeImage.createEmpty(); }
  tray = new Tray(img);
  tray.setToolTip('浮屿 · 桌面智能悬浮岛');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示 / 隐藏浮屿', click: () => { if (win) { win.isVisible() ? win.hide() : win.show(); } } },
    { type: 'separator' },
    { label: '退出', click: () => { app.quit(); } }
  ]));
}

// ---------- CPU / 内存 / 电池 ----------
async function getStats() {
  const cur = os.cpus().map(c => Object.assign({}, c.times));
  const now = Date.now();
  const corePcts = [];
  if (lastSample && lastSample.cpus.length === cur.length && now - lastSample.t > 250) {
    let idle = 0, total = 0;
    for (let i = 0; i < cur.length; i++) {
      const d = lastSample.cpus[i];
      const di = cur[i].idle - d.idle;
      const dt = (cur[i].user - d.user) + (cur[i].nice - d.nice) + (cur[i].sys - d.sys) + (cur[i].irq - d.irq) + di;
      idle += di; total += dt;
      corePcts.push(dt > 0 ? Math.max(0, Math.min(100, Math.round((1 - di / dt) * 100))) : 0);
    }
    if (total > 0) cpuUsage = Math.max(0, Math.min(100, Math.round((1 - idle / total) * 100)));
    lastSample = { t: now, cpus: cur };
  } else {
    if (!lastSample) lastSample = { t: now, cpus: cur };
    const coresN = os.cpus().length;
    for (let i = 0; i < coresN; i++) corePcts.push(corePctsCache[i] != null ? corePctsCache[i] : 0);
  }
  if (corePcts.length) corePctsCache = corePcts.slice();
  let battery = null;
  try {
    if (typeof powerMonitor.getBatteryState === 'function') {
      const st = powerMonitor.getBatteryState();
      const frac = typeof st.fractionRemaining === 'number' ? st.fractionRemaining : null;
      battery = { percent: frac != null ? Math.round(frac * 100) : null, charging: !!st.isCharging };
    }
  } catch (e) {}
  if (!battery || battery.percent == null) {
    try { battery = { percent: null, charging: !powerMonitor.isOnBatteryPower() }; }
    catch (e) { battery = { percent: null, charging: true }; }
  }
  let disk = null;
  try {
    if (typeof fs.statfsSync === 'function') {
      const st = fs.statfsSync('C:\\');
      const totalB = st.bsize * st.blocks;
      const freeB = st.bsize * st.bavail;
      if (totalB > 0) disk = { total: totalB, free: freeB, pct: Math.round((1 - freeB / totalB) * 100) };
    }
  } catch (e) {}

  const sys = latestSysStats || {};
  const net = sys.net || { rx: 0, tx: 0, rxTotal: 0, txTotal: 0 };
  const procRaw = Array.isArray(sys.procs) ? sys.procs : [];
  const procs = [];
  for (const p of procRaw.slice(0, 8)) {
    let icon = '';
    if (p.p && p.p.toLowerCase().endsWith('.exe')) {
      icon = await getFileIconBase64(p.p, false);
    }
    procs.push({ name: p.n, cpu: p.c, mem: p.m, path: p.p || '', icon });
  }

  return {
    cpu: cpuUsage,
    corePcts,
    cores: os.cpus().length,
    memTotal: os.totalmem(),
    memFree: os.freemem(),
    uptime: os.uptime(),
    battery,
    disk,
    gpu: gpuInfo,
    net,
    procs
  };
}
let corePctsCache = [];

// ---------- GPU 采样（优先 nvidia-smi，其次 Windows 性能计数器） ----------
let gpuInfo = null;
let gpuBusy = false;
const execFileP = (cmd, args, opts) => new Promise((resolve, reject) => {
  execFile(cmd, args, Object.assign({ timeout: 12000, windowsHide: true }, opts || {}), (err, stdout) => {
    if (err) reject(err); else resolve(stdout);
  });
});
async function refreshGpu() {
  if (gpuBusy) return;
  gpuBusy = true;
  try {
    const out = await execFileP('nvidia-smi', ['--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw', '--format=csv,noheader,nounits']);
    const line = String(out).trim().split(/\r?\n/)[0] || '';
    const p = line.split(',').map(s => s.trim());
    if (p.length >= 5) {
      gpuInfo = {
        name: p[0],
        util: parseInt(p[1], 10) || 0,
        memUsed: parseInt(p[2], 10) || 0,
        memTotal: parseInt(p[3], 10) || 0,
        temp: parseInt(p[4], 10) || null,
        powerW: p.length >= 6 ? (parseFloat(p[5]) || null) : null,
        src: 'nvidia'
      };
    }
  } catch (e) {
    try {
      const cmd = "try { $n = ''; try { $n = (Get-CimInstance Win32_VideoController | Select-Object -First 1 -ExpandProperty Name) } catch {}; $u = -1; try { $u = [math]::Round(((Get-Counter '\\GPU Engine(*)\\Utilization Percentage' -ErrorAction Stop).CounterSamples | Measure-Object CookedValue -Sum).Sum, 0) } catch {}; Write-Output ($n + '|' + $u) } catch { Write-Output ('|' + -1) }";
      const out = await execFileP('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd]);
      const line = String(out).trim();
      const idx = line.lastIndexOf('|');
      if (idx >= 0) {
        const name = line.slice(0, idx).trim();
        const u = parseInt(line.slice(idx + 1), 10);
        if (!isNaN(u) && u >= 0) {
          gpuInfo = { name: name || 'GPU', util: Math.min(100, u), memUsed: null, memTotal: null, temp: null, src: 'counter' };
        }
      }
    } catch (e2) {}
  }
  gpuBusy = false;
}
refreshGpu();
setInterval(refreshGpu, 5000);

// ---------- 剪贴板 ----------
function watchClipboard() {
  setInterval(() => {
    if (!win) return;
    let t = '';
    try { t = clipboard.readText(); } catch (e) { return; }
    if (t && t !== lastClipText) {
      lastClipText = t;
      if (!clips.some(c => c.text === t)) {
        clips.unshift({ text: t, time: Date.now() });
        if (clips.length > 50) clips.pop();
        send('clips:new');
      }
    }
  }, 1200);
}

// ---------- 音乐桥（SMTC，经 PowerShell；控制网易云/QQ音乐/酷狗/Spotify 等所有接入系统媒体控制的播放器） ----------
let mediaProc = null;
let mediaCmdFile = '';
let latestMusicState = null;
let latestMusicThumb = null;
const lyricCache = new Map();

function startMediaBridge() {
  mediaCmdFile = path.join(app.getPath('temp'), 'island_media_cmd.json');
  try { if (fs.existsSync(mediaCmdFile)) fs.unlinkSync(mediaCmdFile); } catch (e) {}
  const script = path.join(__dirname, 'media.ps1');
  try {
    mediaProc = spawn('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-CmdFile', mediaCmdFile],
      { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) { mediaProc = null; return; }
  mediaProc.stdout.setEncoding('utf8');
  let buf = '';
  let lastLine = '';
  mediaProc.stdout.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line || line === lastLine) continue;
      lastLine = line;
      let st = null;
      try { st = JSON.parse(line); } catch (e) {}
      if (!st) continue;
      if (st.thumb) {
        const sig = String(st.thumb).slice(0, 4);
        const mime = sig === '/9j/' ? 'image/jpeg' : (sig === 'R0lG' ? 'image/gif' : 'image/png');
        latestMusicThumb = { k: st.k, url: 'data:' + mime + ';base64,' + st.thumb };
        send('music:thumb', latestMusicThumb);
      } else {
        latestMusicState = st;
        send('music:state', st);
      }
    }
  });
  mediaProc.stderr.setEncoding('utf8');
  mediaProc.stderr.on('data', () => {});
  mediaProc.on('exit', () => {
    mediaProc = null;
    latestMusicState = { active: false, error: 'unavailable' };
    send('music:state', latestMusicState);
  });
}

// 兜底清理：任何退出路径都杀掉音乐桥子进程，避免残留
process.on('exit', () => {
  try { if (mediaProc) mediaProc.kill(); } catch (e) {}
  try { if (statsProc) statsProc.kill(); } catch (e) {}
});

// ---------- 系统状态桥（网速 / 进程 / 全屏检测，经 PowerShell） ----------
let statsProc = null;
let latestSysStats = null;
let lastFsSent = false;

function startStatsBridge() {
  const script = path.join(__dirname, 'stats.ps1');
  try {
    statsProc = spawn('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-OwnPid', String(process.pid)],
      { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) { statsProc = null; return; }
  statsProc.stdout.setEncoding('utf8');
  let buf = '';
  let lastLine = '';
  statsProc.stdout.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line || line === lastLine) continue;
      lastLine = line;
      try {
        const j = JSON.parse(line);
        if (j && j.net) {
          latestSysStats = {
            net: { rx: j.net.rx || 0, tx: j.net.tx || 0, rxTotal: j.net.rxTotal || 0, txTotal: j.net.txTotal || 0 },
            procs: Array.isArray(j.procs) ? j.procs : [],
            fs: !!j.fs
          };
        }
        // 全屏检测：仅在鼠标穿透（岛收起且未展开）时判定，避免岛自身展开时误报
        if (ignoring && typeof j.fs === 'boolean' && j.fs !== lastFsSent) {
          lastFsSent = j.fs;
          send('sys:fullscreen', j.fs);
        }
      } catch (e) {}
    }
  });
  statsProc.stderr.setEncoding('utf8');
  statsProc.stderr.on('data', () => {});
  statsProc.on('exit', () => { statsProc = null; });
}

// ---------- 喝水提醒 ----------
let waterLeftSec = 0;
function waterIntervalMin() {
  const v = parseInt(config.water && config.water.intervalMin, 10);
  return isNaN(v) ? 60 : Math.max(0, Math.min(720, v));
}
function pushWaterState() {
  const iv = waterIntervalMin();
  broadcast('water:state', iv > 0 ? { enabled: true, left: waterLeftSec, intervalMin: iv } : { enabled: false, left: 0, intervalMin: 0 });
}
function resetWaterTimer() {
  waterLeftSec = waterIntervalMin() * 60;
  pushWaterState();
}
setInterval(() => {
  const iv = waterIntervalMin();
  if (iv <= 0) return;
  waterLeftSec -= 30;
  if (waterLeftSec <= 0) {
    waterLeftSec = iv * 60;
    try {
      const n = new Notification({ title: '喝水提醒', body: '连续工作久了，记得起身喝口水、活动一下', silent: false });
      n.show();
    } catch (e) {}
  }
  pushWaterState();
}, 30000);

function mediaCmd(cmd) {
  if (!mediaCmdFile || !mediaProc) return;
  try { fs.writeFileSync(mediaCmdFile, JSON.stringify({ cmd: String(cmd) }), 'utf8'); } catch (e) {}
}

function decodeHtmlEntities(s) {
  return String(s || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function parseLrc(lrc) {
  const lines = [];
  const raw = decodeHtmlEntities(lrc).split(/\r?\n/);
  let offsetSec = 0;
  for (const line of raw) {
    const om = line.match(/^\s*\[offset:\s*(-?\d+)\s*\]/i);
    if (om) { offsetSec = (parseInt(om[1], 10) || 0) / 1000; continue; }
    const times = line.match(/\[\d+:\d+(?:[.:]\d+)?\]/g);
    if (!times) continue;
    const text = line.replace(/\[[^\]]*\]/g, '').trim();
    if (!text) continue;
    for (const tm of times) {
      const m = tm.match(/\[(\d+):(\d+(?:[.:]\d+)?)\]/);
      if (m) {
        const t = Math.max(0, parseInt(m[1], 10) * 60 + parseFloat(m[2].replace(':', '.')) - offsetSec);
        lines.push({ t, text });
      }
    }
  }
  lines.sort((a, b) => a.t - b.t);
  return lines;
}

function normStr(s) {
  return String(s || '').toLowerCase().replace(/[\s()（）【】\[\]《》\-—·.,，。!！?？'"“”‘’]/g, '');
}
function stripParen(s) {
  return String(s || '').replace(/\s*[(（【\[].*?[)）】\]]\s*/g, '').trim();
}

function mergeTrans(rawLrc, transLrc) {
  let lines = rawLrc ? parseLrc(rawLrc) : [];
  if (lines.length && transLrc) {
    const tMap = new Map();
    for (const l of parseLrc(transLrc)) {
      if (l.text && l.text !== '//') tMap.set(Math.round(l.t * 10), l.text);
    }
    lines = lines.map(l => {
      const tr = tMap.get(Math.round(l.t * 10)) || tMap.get(Math.round(l.t * 10) - 1) || tMap.get(Math.round(l.t * 10) + 1);
      return (tr && tr !== l.text) ? { t: l.t, text: l.text + '  /  ' + tr } : l;
    });
  }
  return lines;
}

async function fetchLyricFromQQ(title, artist, dur, album) {
  const a = String(artist || '').split(/[,，、/＆&]/)[0].trim();
  const baseTitle = stripParen(title) || title;
  const query = (title + ' ' + a).trim();
  const body = JSON.stringify({
    req_1: {
      method: 'DoSearchForQQMusicDesktop',
      module: 'music.search.SearchCgiService',
      param: { num_per_page: 10, page_num: 1, query, search_type: 0 }
    }
  });
  const sr = await (await fetch('https://u.y.qq.com/cgi-bin/musicu.fcg', {
    method: 'POST',
    headers: { 'Referer': 'https://y.qq.com/', 'User-Agent': 'Mozilla/5.0', 'Content-Type': 'application/json' },
    body
  })).json();
  const list = (sr && sr.req_1 && sr.req_1.data && sr.req_1.data.body && sr.req_1.data.body.song && sr.req_1.data.body.song.list) || [];
  if (!list.length) return null;

  const wantDj = /dj/i.test(title);
  const wantLive = /live|现场/i.test(title);
  const nTitle = normStr(title);
  const nBase = normStr(baseTitle);
  const nArtist = normStr(a);
  const nAlbum = normStr(stripParen(album || ''));

  const scored = list.map(s => {
    let sc = 0;
    const sFull = (s.name || '') + ' ' + (s.title || '') + ' ' + (s.subtitle || '');
    const nName = normStr(s.name);
    const nFull = normStr(sFull);
    if (nName === nTitle || nFull === nTitle) sc += 55;
    else if (nName === nBase || nFull.includes(nTitle)) sc += 45;
    else if (nBase && nName.includes(nBase)) sc += 15;
    else sc -= 45;

    const singers = (s.singer || []).map(x => x.name).join(' ');
    if (nArtist) {
      if (normStr(singers).includes(nArtist)) sc += 85;
      else sc -= 85;
    }
    if (nAlbum && s.album && s.album.name && normStr(s.album.name).includes(nAlbum)) {
      sc += 35;
    }
    const isDj = /dj/i.test(sFull);
    const isLive = /live|现场/i.test(sFull);
    if (wantDj !== isDj) sc -= 55;
    if (wantLive !== isLive) sc -= 40;

    if (dur > 5 && s.interval > 0) {
      const diff = Math.abs(s.interval - dur);
      if (diff <= 2) sc += 75;
      else if (diff <= 5) sc += 40;
      else if (diff <= 10) sc += 10;
      else sc -= Math.min(90, diff * 2.5);
    }
    return { s, sc };
  }).sort((x, y) => y.sc - x.sc);

  for (const item of scored.slice(0, 3)) {
    const best = item.s;
    const mid = best && best.mid;
    if (!mid) continue;
    const lr = await (await fetch('https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?format=json&nobase64=1&songmid=' + encodeURIComponent(mid), {
      headers: { 'Referer': 'https://y.qq.com/', 'User-Agent': 'Mozilla/5.0' }
    })).json();
    const lines = mergeTrans(lr && lr.lyric, lr && lr.trans);
    if (lines.length >= 3) {
      return { ok: true, lines, name: best.name || title };
    }
  }
  return null;
}

async function fetchLyric(title, artist, dur, album) {
  if (!title) return { ok: false, lines: [], msg: '无曲名' };
  const key = title + '|' + (artist || '') + '|' + Math.round(dur || 0);
  if (lyricCache.has(key)) return lyricCache.get(key);
  let result = { ok: false, lines: [], msg: '' };
  try {
    const qq = await fetchLyricFromQQ(title, artist, dur || 0, album || '');
    if (qq && qq.ok && qq.lines.length) {
      if (lyricCache.size > 80) lyricCache.clear();
      lyricCache.set(key, qq);
      return qq;
    }
  } catch (e) {}

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
    'Referer': 'https://music.163.com/'
  };
  try {
    const a = String(artist || '').split(/[,，、/＆&]/)[0].trim();
    const q = encodeURIComponent(((title || '') + ' ' + a).trim());
    const sr = await (await fetch('https://music.163.com/api/search/get?s=' + q + '&type=1&offset=0&limit=8', { headers })).json();
    const songs = sr && sr.result && Array.isArray(sr.result.songs) ? sr.result.songs : [];
    if (!songs.length) {
      result.msg = '曲库未匹配到「' + title + '」';
    } else {
      const nArtist = normStr(a);
      const nBase = normStr(stripParen(title) || title);
      let s0 = songs[0];
      let bestSc = -1e9;
      for (const s of songs) {
        let sc = 0;
        if (normStr(s.name).includes(nBase)) sc += 30;
        const sa = (s.artists || []).map(x => x.name).join(' ');
        if (nArtist) sc += normStr(sa).includes(nArtist) ? 60 : -60;
        if (dur > 5 && s.duration > 0) {
          const diff = Math.abs(s.duration / 1000 - dur);
          sc += diff <= 3 ? 50 : -Math.min(60, diff * 2);
        }
        if (sc > bestSc) { bestSc = sc; s0 = s; }
      }
      const id = s0.id;
      const lr = await (await fetch('https://music.163.com/api/song/lyric?id=' + id + '&lv=1&kv=1&tv=-1', { headers })).json();
      const lines = mergeTrans(lr && lr.lrc && lr.lrc.lyric, lr && lr.tlyric && lr.tlyric.lyric);
      if (lines.length) result = { ok: true, lines, name: s0.name || title };
      else result = { ok: false, lines: [], msg: '该曲目暂无歌词' };
    }
  } catch (e) {
    result.msg = '网络错误：' + (e.message || e);
  }
  if (lyricCache.size > 80) lyricCache.clear();
  lyricCache.set(key, result);
  return result;
}

// ---------- AI（OpenAI 兼容 / DeepSeek）流式 ----------
async function chatStream(payload) {
  const cfg = config.deepseek;
  if (!cfg.apiKey) {
    send('ai:error', '尚未配置 API Key：请展开浮屿 -> 设置 -> DeepSeek API，填入密钥（后续可填任意版本模型名）。');
    return;
  }
  currentAbort = new AbortController();
  try {
    const base = (cfg.baseUrl || '').replace(/\/+$/, '');
    const res = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey },
      body: JSON.stringify({
        model: cfg.model || 'deepseek-chat',
        messages: payload.messages,
        stream: true,
        temperature: typeof cfg.temperature === 'number' ? cfg.temperature : 0.7
      }),
      signal: currentAbort.signal
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error('HTTP ' + res.status + ' ' + txt.slice(0, 200));
    }
    send('ai:start', { model: cfg.model });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        const s = line.trim();
        if (!s.startsWith('data:')) continue;
        const data = s.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const j = JSON.parse(data);
          const delta = (j.choices && j.choices[0] && j.choices[0].delta) || {};
          if (delta.reasoning_content) send('ai:reasoning', delta.reasoning_content);
          if (delta.content) send('ai:chunk', delta.content);
        } catch (e) {}
      }
    }
    send('ai:done', { ok: true });
  } catch (e) {
    if (e && e.name === 'AbortError') send('ai:done', { ok: true, aborted: true });
    else send('ai:error', '请求失败：' + (e.message || e));
  } finally {
    currentAbort = null;
  }
}

// ---------- 文件暂存区（File Shelf） ----------
function shelfStorePath() { return path.join(app.getPath('userData'), 'shelf.json'); }

function classifyFile(ext, isDir) {
  if (isDir) return { cat: 'dir', label: '文件夹' };
  const e = String(ext || '').toLowerCase();
  const map = {
    pdf: ['doc', 'PDF 文档'],
    doc: ['doc', 'Word 文档'], docx: ['doc', 'Word 文档'], wps: ['doc', 'WPS 文档'], rtf: ['doc', '富文本文档'],
    xls: ['doc', 'Excel 表格'], xlsx: ['doc', 'Excel 表格'], csv: ['doc', 'CSV 表格'], et: ['doc', 'WPS 表格'],
    ppt: ['doc', 'PPT 演示'], pptx: ['doc', 'PPT 演示'], dps: ['doc', 'WPS 演示'],
    txt: ['doc', '文本文档'], md: ['doc', 'Markdown 文档'], log: ['doc', '日志文件'],
    dwg: ['doc', 'CAD 图纸'], dxf: ['doc', 'CAD 交换图'],
    json: ['doc', 'JSON 配置'], xml: ['doc', 'XML 文档'], yaml: ['doc', 'YAML 配置'], yml: ['doc', 'YAML 配置'], ini: ['doc', '配置文件'],
    js: ['doc', 'JS 源码'], ts: ['doc', 'TS 源码'], py: ['doc', 'Python 源码'], java: ['doc', 'Java 源码'],
    c: ['doc', 'C 源码'], cpp: ['doc', 'C++ 源码'], cs: ['doc', 'C# 源码'], html: ['doc', 'HTML 网页'], css: ['doc', 'CSS 样式'],
    png: ['media', 'PNG 图片'], jpg: ['media', 'JPG 图片'], jpeg: ['media', 'JPEG 图片'], gif: ['media', 'GIF 动图'],
    webp: ['media', 'WebP 图片'], svg: ['media', 'SVG 矢量图'], bmp: ['media', 'BMP 位图'], ico: ['media', '图标文件'], psd: ['media', 'PS 设计稿'],
    mp4: ['media', 'MP4 视频'], mkv: ['media', 'MKV 视频'], avi: ['media', 'AVI 视频'], mov: ['media', 'MOV 视频'], wmv: ['media', 'WMV 视频'],
    mp3: ['media', 'MP3 音频'], flac: ['media', 'FLAC 无损音频'], wav: ['media', 'WAV 音频'], m4a: ['media', 'M4A 音频'], ogg: ['media', 'OGG 音频'],
    zip: ['arc', 'ZIP 压缩包'], rar: ['arc', 'RAR 压缩包'], '7z': ['arc', '7Z 压缩包'], tar: ['arc', 'TAR 归档'], gz: ['arc', 'GZ 压缩包'], iso: ['arc', 'ISO 镜像'],
    exe: ['app', '可执行程序'], msi: ['app', '安装程序'], bat: ['app', '批处理脚本'], cmd: ['app', '命令脚本'], ps1: ['app', 'PowerShell 脚本'], lnk: ['app', '快捷方式']
  };
  if (map[e]) return { cat: map[e][0], label: map[e][1] };
  return { cat: 'other', label: (e ? e.toUpperCase() + ' 文件' : '普通文件') };
}

function scanDirQuick(dirPath) {
  let count = 0, bytes = 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    count = entries.length;
    const limit = Math.min(entries.length, 200);
    for (let i = 0; i < limit; i++) {
      const sub = path.join(dirPath, entries[i].name);
      try {
        const st = fs.statSync(sub);
        if (st.isFile()) bytes += st.size;
      } catch (e) {}
    }
  } catch (e) {}
  return { count, bytes };
}

const iconCache = new Map();
async function getFileIconBase64(filePath, isDir) {
  if (isDir) return '';
  if (iconCache.has(filePath)) return iconCache.get(filePath);
  try {
    const img = await app.getFileIcon(filePath, { size: 'normal' });
    if (img && !img.isEmpty()) {
      const url = img.toDataURL();
      if (iconCache.size > 120) iconCache.clear();
      iconCache.set(filePath, url);
      return url;
    }
  } catch (e) {}
  return '';
}

async function buildShelfItem(filePath, addedAt) {
  try {
    const normPath = path.resolve(String(filePath));
    const st = fs.statSync(normPath);
    const isDir = st.isDirectory();
    const rawExt = isDir ? '' : path.extname(normPath).replace(/^\./, '');
    const cls = classifyFile(rawExt, isDir);
    let size = st.size || 0;
    let childCount = null;
    if (isDir) {
      const info = scanDirQuick(normPath);
      size = info.bytes;
      childCount = info.count;
    }
    const icon = await getFileIconBase64(normPath, isDir);
    return {
      path: normPath,
      name: path.basename(normPath) || normPath,
      dir: path.dirname(normPath),
      isDir,
      ext: isDir ? 'DIR' : (rawExt.toUpperCase() || 'FILE'),
      cat: cls.cat,
      typeLabel: cls.label,
      size,
      childCount,
      mtime: st.mtimeMs || Date.now(),
      ctime: st.birthtimeMs || st.ctimeMs || Date.now(),
      addedAt: addedAt || Date.now(),
      icon
    };
  } catch (e) {
    return null;
  }
}

let shelfPaths = []; // [{ path, addedAt }]
function loadShelfPaths() {
  try {
    const raw = JSON.parse(fs.readFileSync(shelfStorePath(), 'utf8'));
    if (Array.isArray(raw)) {
      shelfPaths = raw.filter(x => x && typeof x.path === 'string');
    }
  } catch (e) { shelfPaths = []; }
}
function saveShelfPaths() {
  try {
    fs.mkdirSync(path.dirname(shelfStorePath()), { recursive: true });
    fs.writeFileSync(shelfStorePath(), JSON.stringify(shelfPaths, null, 2), 'utf8');
  } catch (e) {}
}
loadShelfPaths();

async function getShelfList() {
  const list = [];
  const valid = [];
  for (const item of shelfPaths) {
    const info = await buildShelfItem(item.path, item.addedAt);
    if (info) {
      list.push(info);
      valid.push({ path: info.path, addedAt: info.addedAt });
    }
  }
  if (valid.length !== shelfPaths.length) {
    shelfPaths = valid;
    saveShelfPaths();
  }
  return list;
}

// ---------- IPC ----------
ipcMain.on('island:rect', (e, r) => { if (r && r.w > 0) lastRect = r; });

ipcMain.on('island:setPin', (e, v) => {
  pinned = !!v;
  if (pinned && win && !win.isDestroyed()) {
    if (ignoring) {
      ignoring = false;
      try { win.setIgnoreMouseEvents(false); } catch (e) {}
    }
  }
});

// ---------- 开机自启（开发模式也可用） ----------
function applyAutoStart() {
  try {
    const enable = !!(config.general && config.general.autoStart);
    if (app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: enable });
    } else {
      app.setLoginItemSettings({
        openAtLogin: enable,
        path: process.execPath,
        args: [app.getAppPath()]
      });
    }
  } catch (e) {}
}

ipcMain.handle('config:get', () => config);

ipcMain.handle('config:set', (e, patch) => {
  const prevWater = waterIntervalMin();
  for (const k of Object.keys(DEFAULTS)) {
    if (patch[k]) config[k] = Object.assign({}, config[k], patch[k]);
  }
  saveConfig(config);
  applyAutoStart();
  if (waterIntervalMin() !== prevWater) resetWaterTimer(); else pushWaterState();
  broadcast('config:changed');
  return true;
});

// ---------- 独立设置窗口 ----------
let settingsWin = null;
function openSettingsWindow() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 560,
    height: 660,
    minWidth: 500,
    minHeight: 560,
    title: '浮屿 · 设置',
    backgroundColor: '#101014',
    autoHideMenuBar: true,
    resizable: true,
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });
  settingsWin.setMenuBarVisibility(false);
  settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
  settingsWin.on('closed', () => { settingsWin = null; });
}
ipcMain.on('settings:open', () => openSettingsWindow());
ipcMain.handle('config:openDir', () => {
  try { shell.openPath(path.dirname(configPath())); return true; } catch (e) { return false; }
});

ipcMain.handle('stats:get', () => getStats());

ipcMain.handle('clips:get', () => clips);
ipcMain.handle('clips:copy', (e, t) => { try { clipboard.writeText(String(t)); lastClipText = String(t); } catch (e2) {} return true; });
ipcMain.handle('clips:clear', () => { clips = []; return true; });

ipcMain.on('ai:send', (e, payload) => { chatStream(payload || {}); });
ipcMain.on('ai:stop', () => { if (currentAbort) currentAbort.abort(); });

ipcMain.on('music:cmd', (e, c) => { mediaCmd(c); });
ipcMain.handle('music:getState', () => ({ state: latestMusicState, thumb: latestMusicThumb }));
ipcMain.handle('music:lyric', (e, q) => fetchLyric(q && q.title, q && q.artist, q && q.dur, q && q.album));

// 文件暂存区 IPC
ipcMain.handle('shelf:list', () => getShelfList());
ipcMain.handle('shelf:add', async (e, paths) => {
  if (Array.isArray(paths)) {
    const now = Date.now();
    for (let i = paths.length - 1; i >= 0; i--) {
      const p = paths[i];
      if (!p) continue;
      const norm = path.resolve(String(p));
      if (!fs.existsSync(norm)) continue;
      shelfPaths = shelfPaths.filter(x => x.path.toLowerCase() !== norm.toLowerCase());
      shelfPaths.unshift({ path: norm, addedAt: now });
    }
    if (shelfPaths.length > 100) shelfPaths = shelfPaths.slice(0, 100);
    saveShelfPaths();
  }
  return getShelfList();
});
ipcMain.handle('shelf:remove', async (e, targetPath) => {
  if (targetPath === '__ALL__') {
    shelfPaths = [];
  } else if (targetPath) {
    const norm = path.resolve(String(targetPath)).toLowerCase();
    shelfPaths = shelfPaths.filter(x => x.path.toLowerCase() !== norm);
  }
  saveShelfPaths();
  return getShelfList();
});
ipcMain.handle('shelf:open', async (e, targetPath) => {
  if (!targetPath || !fs.existsSync(targetPath)) return { ok: false, msg: '文件不存在' };
  const err = await shell.openPath(targetPath);
  return { ok: !err, msg: err || '' };
});
ipcMain.handle('shelf:reveal', (e, targetPath) => {
  if (!targetPath || !fs.existsSync(targetPath)) return false;
  shell.showItemInFolder(targetPath);
  return true;
});
ipcMain.handle('shelf:copyFile', async (e, targetPath) => {
  if (!targetPath || !fs.existsSync(targetPath)) return false;
  try {
    const safe = String(targetPath).replace(/'/g, "''");
    await execFileP('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Set-Clipboard -LiteralPath '${safe}'`]);
    return true;
  } catch (err) {
    return false;
  }
});
ipcMain.on('shelf:startDrag', async (event, targetPath) => {
  if (!targetPath || !fs.existsSync(targetPath)) return;
  try {
    let icon = null;
    try { icon = await app.getFileIcon(targetPath, { size: 'normal' }); } catch (e) {}
    if (!icon || icon.isEmpty()) {
      icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png'));
    }
    event.sender.startDrag({ file: targetPath, icon });
  } catch (e) {}
});

// ---------- 启动 ----------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); } else {
  app.on('second-instance', () => {
    if (win) {
      win.show();
      try { win.setAlwaysOnTop(true, 'screen-saver'); } catch (e) {}
      try { win.focus(); } catch (e) {}
    }
  });

  app.whenReady().then(() => {
    createWindow();
    createTray();
    watchClipboard();
    startMediaBridge();
    startStatsBridge();
    applyAutoStart();
    resetWaterTimer();

    globalShortcut.register('Control+Alt+I', () => {
      send('island:togglePin');
    });

    if (process.argv.includes('--smoke')) {
      setTimeout(async () => {
        try {
          const info = await win.webContents.executeJavaScript(`(async () => {
            expand();
            switchTab('music');
            const musicSize = [islandEl.style.width, islandEl.style.height];
            switchTab('shelf');
            const shelfEmptySize = [islandEl.style.width, islandEl.style.height];
            await window.island.shelfAdd(['E:\\\\OpenCode工作区\\\\DynamicIsland\\\\package.json', 'E:\\\\OpenCode工作区\\\\DynamicIsland\\\\assets']);
            await loadShelf();
            const shelfWith2Size = [islandEl.style.width, islandEl.style.height];
            const dtName = document.getElementById('sfDtName').textContent;
            const dtMeta = document.getElementById('sfDtMeta').textContent;
            await window.island.shelfRemove('__ALL__');
            await loadShelf();
            return {
              tabs: document.querySelectorAll('.tab').length,
              musicSize,
              shelfEmptySize,
              shelfWith2Size,
              dtName,
              dtMeta,
              cpu: document.getElementById('mCpuVal').textContent,
              gpu: document.getElementById('mGpuVal').textContent
            };
          })()`);
          console.log('SMOKE_RESULT ' + JSON.stringify(info));
        } catch (e) { console.log('SMOKE_FAIL ' + (e.message || e)); }
        app.exit(0);
      }, 4500);
    }

    app.on('window-all-closed', () => {});
    app.on('before-quit', () => {
      try { globalShortcut.unregister('Control+Alt+I'); } catch (e) {}
      try {
        if (mediaProc) { mediaCmd('exit'); mediaProc.kill(); }
      } catch (e) {}
    });
  });
}
