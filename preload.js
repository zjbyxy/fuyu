const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('island', {
  // 岛状态（主进程轮询触发）
  onIsland: (cb) => {
    ipcRenderer.on('island:enter', () => cb('enter'));
    ipcRenderer.on('island:leave', () => cb('leave'));
    ipcRenderer.on('island:togglePin', () => cb('togglePin'));
  },
  // 岛矩形上报（窗口内坐标）
  sendRect: (r) => ipcRenderer.send('island:rect', r),
  setPin: (v) => ipcRenderer.send('island:setPin', v),

  // 配置
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),
  onConfigChanged: (cb) => ipcRenderer.on('config:changed', () => cb()),

  // 设置窗口与提醒
  settingsOpen: () => ipcRenderer.send('settings:open'),
  openConfigDir: () => ipcRenderer.invoke('config:openDir'),
  onWater: (cb) => ipcRenderer.on('water:state', (e, d) => cb(d)),
  onFullscreen: (cb) => ipcRenderer.on('sys:fullscreen', (e, d) => cb(d)),

  // 系统状态
  getStats: () => ipcRenderer.invoke('stats:get'),

  // 剪贴板
  getClips: () => ipcRenderer.invoke('clips:get'),
  copyClip: (t) => ipcRenderer.invoke('clips:copy', t),
  clearClips: () => ipcRenderer.invoke('clips:clear'),
  onClipsNew: (cb) => ipcRenderer.on('clips:new', () => cb()),

  // AI（DeepSeek，OpenAI 兼容流式）
  aiSend: (messages) => ipcRenderer.send('ai:send', { messages }),
  aiStop: () => ipcRenderer.send('ai:stop'),
  onAi: (ch, cb) => ipcRenderer.on('ai:' + ch, (e, d) => cb(d)),

  // 音乐（SMTC 桥）
  musicCmd: (c) => ipcRenderer.send('music:cmd', c),
  getMusicState: () => ipcRenderer.invoke('music:getState'),
  onMusicState: (cb) => ipcRenderer.on('music:state', (e, d) => cb(d)),
  onMusicThumb: (cb) => ipcRenderer.on('music:thumb', (e, d) => cb(d)),
  getLyric: (title, artist, dur, album) => ipcRenderer.invoke('music:lyric', { title, artist, dur, album }),

  // 文件暂存区（File Shelf）
  getPathForFile: (file) => {
    try {
      if (webUtils && typeof webUtils.getPathForFile === 'function') return webUtils.getPathForFile(file);
    } catch (e) {}
    return (file && file.path) || '';
  },
  shelfList: () => ipcRenderer.invoke('shelf:list'),
  shelfAdd: (paths) => ipcRenderer.invoke('shelf:add', paths),
  shelfRemove: (p) => ipcRenderer.invoke('shelf:remove', p),
  shelfOpen: (p) => ipcRenderer.invoke('shelf:open', p),
  shelfReveal: (p) => ipcRenderer.invoke('shelf:reveal', p),
  shelfCopyFile: (p) => ipcRenderer.invoke('shelf:copyFile', p),
  shelfStartDrag: (p) => ipcRenderer.send('shelf:startDrag', p),

  // 环境
  isDev: () => process.env.NODE_ENV === 'development' || process.argv.includes('--dev')
});
