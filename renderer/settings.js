'use strict';
const $ = (id) => document.getElementById(id);
let config = null;

function fill() {
  if (!config) return;
  const a = config.appearance || {};
  $('setFont').value = a.fontFamily || '';
  const fs = (typeof a.fontScale === 'number') ? a.fontScale : 1;
  $('setFontScale').value = fs;
  $('fontScaleVal').textContent = Math.round(fs * 100) + '%';
  const accent = a.accent || '#4c8dff';
  $('setColor').value = accent;
  document.querySelectorAll('#swatches i').forEach(el => {
    el.classList.toggle('on', el.dataset.c.toLowerCase() === String(accent).toLowerCase());
  });
  const op = (typeof a.opacity === 'number') ? Math.round(a.opacity * 100) : 97;
  $('setOpacity').value = op;
  $('opacityVal').textContent = op + '%';
  const top = (typeof a.topOffset === 'number') ? a.topOffset : 8;
  $('setTop').value = top;
  $('topVal').textContent = top + 'px';

  const w = config.water || {};
  $('setWater').value = String(w.intervalMin != null ? w.intervalMin : 60);

  const d = config.deepseek || {};
  $('setApiKey').value = d.apiKey || '';
  $('setBaseUrl').value = d.baseUrl || 'https://api.deepseek.com/v1';
  $('setModel').value = d.model || 'deepseek-chat';
  $('setTemp').value = d.temperature != null ? d.temperature : 0.7;
  $('setPrompt').value = d.systemPrompt || '';

  $('setCity').value = (config.weather && config.weather.city) || '北京';
  $('setAutoStart').checked = !!(config.general && config.general.autoStart);
}

$('setFontScale').addEventListener('input', () => {
  $('fontScaleVal').textContent = Math.round(parseFloat($('setFontScale').value) * 100) + '%';
});
$('setOpacity').addEventListener('input', () => {
  $('opacityVal').textContent = $('setOpacity').value + '%';
});
$('setTop').addEventListener('input', () => {
  $('topVal').textContent = $('setTop').value + 'px';
});
document.querySelectorAll('#swatches i').forEach(el => {
  el.addEventListener('click', () => {
    document.querySelectorAll('#swatches i').forEach(x => x.classList.remove('on'));
    el.classList.add('on');
    $('setColor').value = el.dataset.c;
  });
});
$('setColor').addEventListener('input', () => {
  document.querySelectorAll('#swatches i').forEach(x => x.classList.remove('on'));
});
$('btnEye').addEventListener('click', () => {
  const inp = $('setApiKey');
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  $('btnEye').textContent = show ? '隐藏' : '显示';
});
$('btnOpenDir').addEventListener('click', () => window.island.openConfigDir());

$('btnSave').addEventListener('click', async () => {
  const patch = {
    appearance: {
      fontFamily: $('setFont').value,
      fontScale: parseFloat($('setFontScale').value) || 1,
      accent: $('setColor').value || '#4c8dff',
      opacity: (parseInt($('setOpacity').value, 10) || 97) / 100,
      topOffset: parseInt($('setTop').value, 10) || 0
    },
    water: { intervalMin: parseInt($('setWater').value, 10) || 0 },
    deepseek: {
      apiKey: $('setApiKey').value.trim(),
      baseUrl: $('setBaseUrl').value.trim() || 'https://api.deepseek.com/v1',
      model: $('setModel').value.trim() || 'deepseek-chat',
      temperature: parseFloat($('setTemp').value) || 0.7,
      systemPrompt: $('setPrompt').value.trim()
    },
    weather: { city: $('setCity').value.trim() || '北京' },
    general: { autoStart: $('setAutoStart').checked }
  };
  try {
    await window.island.setConfig(patch);
    $('savedTip').textContent = '已保存，浮屿已实时应用';
    setTimeout(() => { $('savedTip').textContent = ''; }, 2000);
  } catch (e) {
    $('savedTip').textContent = '保存失败';
    $('savedTip').style.color = '#ff6b5e';
    setTimeout(() => { $('savedTip').textContent = ''; $('savedTip').style.color = ''; }, 2000);
  }
});

window.island.onConfigChanged(async () => {
  try { config = await window.island.getConfig(); fill(); } catch (e) {}
});

(async function init() {
  try { config = await window.island.getConfig(); } catch (e) { config = null; }
  fill();
})();
