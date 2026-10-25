// src/panel.ts
// The visual panel's own page: a login card, and — once signed in — two tabs,
// one for the font market and one for the AI cloud cache.
//
// Font previews are rasterised here, in the operator's browser, at upload time
// (FontFace → canvas → PNG) and stored next to the font. That is deliberate:
// the player then previews a font with a few KB of PNG instead of pulling down
// a multi-megabyte CJK font file just to draw one line of sample text.

const escapeHtml = (value: unknown): string => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const shell = (title: string, body: string, script: string): string => `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<title>${escapeHtml(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #08080b;
    --panel: rgba(255,255,255,0.045);
    --panel-strong: rgba(255,255,255,0.08);
    --line: rgba(255,255,255,0.10);
    --line-soft: rgba(255,255,255,0.06);
    --text: #f4f4f6;
    --muted: #9aa3b2;
    --accent: #8b5cf6;
    --danger: #ef4444;
    --ok: #34d399;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    background-color: var(--bg);
    background-image: radial-gradient(rgba(255,255,255,0.07) 1px, transparent 1px);
    background-size: 24px 24px;
    color: var(--text);
    font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
    padding: 32px 24px 64px;
  }
  .wrap { max-width: 1120px; margin: 0 auto; }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 28px; flex-wrap: wrap; }
  h1 { font-size: 20px; font-weight: 700; margin: 0; letter-spacing: .01em; }
  h2 { font-size: 14px; font-weight: 600; margin: 0 0 12px; }
  .sub { font-size: 12px; color: var(--muted); margin-top: 4px; }
  .card {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 16px;
    padding: 18px;
    margin-bottom: 18px;
  }
  .login-card { max-width: 380px; margin: 10vh auto 0; }
  label { display: block; font-size: 12px; color: var(--muted); margin-bottom: 6px; }
  input[type=text], input[type=password], input[type=number], select, textarea {
    width: 100%;
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: rgba(255,255,255,0.05);
    color: var(--text);
    font-size: 13px;
    font-family: inherit;
    outline: none;
  }
  input:focus, select:focus, textarea:focus { border-color: rgba(139,92,246,.6); }
  button {
    font-family: inherit;
    font-size: 13px;
    font-weight: 600;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--panel-strong);
    color: var(--text);
    padding: 9px 14px;
    cursor: pointer;
    transition: background .15s, opacity .15s;
  }
  button:hover { background: rgba(255,255,255,0.14); }
  button:disabled { opacity: .45; cursor: default; }
  button.primary { background: var(--accent); border-color: transparent; color: #fff; }
  button.primary:hover { background: #7c4dee; }
  button.danger { color: #fca5a5; border-color: rgba(239,68,68,.35); }
  .tabs { display: flex; gap: 6px; margin-bottom: 18px; }
  .tabs button { background: transparent; border-color: transparent; opacity: .55; }
  .tabs button[aria-selected="true"] { background: var(--panel); border-color: var(--line); opacity: 1; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 14px; }
  .font-card { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 12px; }
  .font-card img { width: 100%; display: block; border-radius: 8px; background: rgba(255,255,255,.04); }
  .font-card.off { opacity: .5; }
  .name { font-size: 13px; font-weight: 600; margin-top: 10px; }
  .meta { font-size: 11px; color: var(--muted); margin-top: 2px; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
  .stat { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 14px; }
  .stat b { display: block; font-size: 22px; font-weight: 700; }
  .stat span { font-size: 11px; color: var(--muted); }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line-soft); vertical-align: middle; }
  th { color: var(--muted); font-weight: 500; }
  .mono { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
  .toolbar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 12px; }
  .toolbar input, .toolbar select { width: auto; min-width: 140px; }
  .empty { color: var(--muted); font-size: 13px; padding: 20px 0; }
  .err { color: #fca5a5; font-size: 12px; margin-top: 10px; min-height: 16px; }
  .ok { color: var(--ok); font-size: 12px; margin-top: 10px; min-height: 16px; }
  .warn {
    margin-bottom: 18px; padding: 12px 14px; border-radius: 14px; font-size: 12px; line-height: 1.6;
    background: rgba(245,158,11,.10); border: 1px solid rgba(245,158,11,.32); color: #fcd34d;
  }
  .warn code {
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    background: rgba(0,0,0,.35); padding: 1px 5px; border-radius: 5px;
  }
  .pill { display:inline-block; padding: 2px 8px; border-radius: 999px; font-size: 10px; border: 1px solid var(--line); color: var(--muted); }
  pre.json {
    background: rgba(0,0,0,.35); border: 1px solid var(--line); border-radius: 10px;
    padding: 12px; max-height: 320px; overflow: auto; font-size: 11px; line-height: 1.5;
  }
  .modal-mask { position: fixed; inset: 0; background: rgba(0,0,0,.6); display: flex; align-items: center; justify-content: center; padding: 24px; z-index: 50; }
  .modal { max-width: 720px; width: 100%; max-height: 80vh; overflow: auto; background: #101014; border: 1px solid var(--line); border-radius: 16px; padding: 18px; }
</style>
</head>
<body>
<div class="wrap">
${body}
</div>
<script>
${script}
</script>
</body>
</html>`;

export const renderLoginPage = (): string => shell('Folia 云服务后台', `
<div class="card login-card">
  <h1>Folia 云服务后台</h1>
  <div class="sub">字体市场 · AI 云缓存</div>
  <form id="login-form" style="margin-top: 20px;">
    <div style="margin-bottom: 12px;">
      <label for="username">账号</label>
      <input id="username" name="username" type="text" autocomplete="username" autofocus />
    </div>
    <div style="margin-bottom: 16px;">
      <label for="password">密码</label>
      <input id="password" name="password" type="password" autocomplete="current-password" />
    </div>
    <div class="err" id="login-error"></div>
    <button class="primary" type="submit" id="login-submit" style="width: 100%;">登录</button>
  </form>
</div>
`, `
const form = document.getElementById('login-form');
const errorNode = document.getElementById('login-error');
const submit = document.getElementById('login-submit');
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorNode.textContent = '';
  submit.disabled = true;
  try {
    const response = await fetch('/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: document.getElementById('username').value,
        password: document.getElementById('password').value,
      }),
    });
    if (!response.ok) {
      errorNode.textContent = response.status === 401 ? '账号或密码不对。' : '登录失败，稍后再试。';
      submit.disabled = false;
      return;
    }
    window.location.reload();
  } catch {
    errorNode.textContent = '连不上服务器。';
    submit.disabled = false;
  }
});
`);

export const renderPanelPage = (): string => shell('Folia 云服务后台', `
<div class="head">
  <div>
    <h1>Folia 云服务后台</h1>
    <div class="sub">字体市场 · AI 云缓存</div>
  </div>
  <button id="logout">退出登录</button>
</div>

<div class="stats" id="stats"></div>

<div class="tabs" role="tablist">
  <button id="tab-fonts" role="tab" aria-selected="true">字体市场</button>
  <button id="tab-cache" role="tab" aria-selected="false">云缓存</button>
</div>

<section id="view-fonts">
  <div class="card">
    <h2>上架新字体</h2>
    <div class="toolbar">
      <input type="file" id="font-file" accept=".woff2,.woff,.ttf,.otf" />
      <input type="text" id="font-name" placeholder="展示名（留空用文件名）" />
      <select id="font-category">
        <option value="sans">黑体 / 无衬线</option>
        <option value="serif">宋体 / 衬线</option>
        <option value="handwriting">手写</option>
        <option value="display">艺术 / 标题</option>
        <option value="mono">等宽</option>
      </select>
      <input type="text" id="font-license" placeholder="授权说明（可留空）" />
    </div>
    <div class="toolbar">
      <input type="text" id="preview-text" value="夜空中最亮的星" style="min-width: 220px;" />
      <button id="make-preview">生成预览图</button>
    </div>
    <div id="preview-holder" style="margin-top: 12px;"></div>
    <div class="err" id="upload-error"></div>
    <div class="row">
      <button class="primary" id="do-upload" disabled>上传上架</button>
      <span class="ok" id="upload-thanks" hidden></span>
    </div>
  </div>

  <div class="card">
    <div class="toolbar">
      <h2 style="margin:0 12px 0 0;">已上架（<span id="font-count">0</span>）</h2>
      <input type="text" id="font-search" placeholder="搜索名称 / 分类" />
      <button id="refresh-fonts">刷新</button>
    </div>
    <div class="grid" id="font-grid"></div>
    <div class="empty" id="font-empty" hidden>还没有上传任何字体。</div>
  </div>
</section>

<section id="view-cache" hidden>
  <div class="card">
    <!-- 概况图：服务端现画的一张 SVG，同源 <img> 会带上会话 cookie，所以能直接嵌 -->
    <div class="toolbar">
      <h2 style="margin:0 12px 0 0;">概况</h2>
      <label class="muted" style="font-size:12px;">最近
        <select id="stats-minutes">
          <option value="5" selected>5 分钟</option>
          <option value="30">30 分钟</option>
          <option value="60">1 小时</option>
          <option value="1440">24 小时</option>
        </select>
      </label>
      <button id="refresh-stats">刷新</button>
    </div>
    <img id="stats-image" src="/admin/api/stats.svg?minutes=5" alt="云缓存概况" style="width:100%;height:auto;display:block;border-radius:10px;" />
  </div>

  <div class="card">
    <div class="toolbar">
      <h2 style="margin:0 12px 0 0;">缓存条目（<span id="cache-count">0</span>）</h2>
      <select id="cache-kind">
        <option value="">全部类型</option>
        <option value="stage">主题 + 动画</option>
      </select>
      <input type="text" id="cache-search" placeholder="搜索 MD5 / 歌名" />
      <button id="refresh-cache">刷新</button>
      <button class="danger" id="clear-cache">清空</button>
    </div>
    <table>
      <thead>
        <tr><th>类型</th><th>MD5</th><th>歌名</th><th>大小</th><th>命中</th><th>更新</th><th></th></tr>
      </thead>
      <tbody id="cache-rows"></tbody>
    </table>
    <div class="empty" id="cache-empty" hidden>还没有任何缓存。</div>
  </div>
</section>

<div id="payload-modal" hidden></div>
`, `
const state = { tab: 'fonts', fonts: [], entries: [], cacheTotal: 0 };

const fmtBytes = (value) => {
  const size = Number(value || 0);
  if (size < 1024) return size + ' B';
  if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB';
  return (size / 1024 / 1024).toFixed(2) + ' MB';
};
const fmtTime = (value) => {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString('zh-CN') : '—';
};
const esc = (value) => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const api = async (path, init) => {
  const response = await fetch(path, init);
  if (!response.ok) throw new Error('HTTP ' + response.status);
  return await response.json();
};

const renderStats = (payload) => {
  const cards = [
    ['已上架字体', payload.fontCount ?? 0],
    ['字体占用', fmtBytes(payload.fontBytes)],
    ['缓存条目', payload.cacheCount ?? 0],
    ['缓存占用', fmtBytes(payload.cacheBytes)],
    ['累计命中', payload.totalHits ?? 0],
  ];
  document.getElementById('stats').innerHTML = cards
    .map(([label, value]) => '<div class="stat"><b>' + esc(value) + '</b><span>' + esc(label) + '</span></div>')
    .join('');
};

const renderFonts = () => {
  const query = String(document.getElementById('font-search').value || '').trim().toLowerCase();
  const visible = state.fonts.filter((font) => {
    if (!query) return true;
    // The backticks below belong to the panel's own template literal; they are
    // escaped so the surrounding TypeScript template leaves them alone.
    return \`\${font.name} \${font.category} \${font.family}\`.toLowerCase().includes(query);
  });
  document.getElementById('font-count').textContent = String(state.fonts.length);
  document.getElementById('font-empty').hidden = visible.length > 0;
  document.getElementById('font-grid').innerHTML = visible.map((font) => (
    '<div class="font-card' + (font.enabled ? '' : ' off') + '">'
    + '<img src="' + esc(font.previewUrl) + '" alt="' + esc(font.name) + '" loading="lazy" />'
    + '<div class="name">' + esc(font.name) + '</div>'
    + '<div class="meta">' + esc(font.categoryLabel || font.category) + ' · ' + fmtBytes(font.fileSize) + '</div>'
    + '<div class="meta mono">' + esc(String(font.id || '').slice(0, 12)) + '</div>'
    + '<div class="row">'
    + '<button data-act="toggle" data-id="' + esc(font.id) + '">' + (font.enabled ? '停用' : '启用') + '</button>'
    + '<button class="danger" data-act="delete" data-id="' + esc(font.id) + '">删除</button>'
    + '</div></div>'
  )).join('');
};

/*
 * 搜索与类型筛选都交给服务端（/admin/api/ai-cache?q=&kind=）：库里有几百条以上时，
 * 只取回前 500 条再在内存里筛，第 501 条往后就永远搜不到。
 * 顶上那个计数用服务端给的 total（整个库 / 筛完之后的条数），不是这一页取回多少条。
 */
const renderCache = () => {
  const visible = state.entries;
  document.getElementById('cache-count').textContent = String(state.cacheTotal ?? visible.length);
  document.getElementById('cache-empty').hidden = visible.length > 0;
  document.getElementById('cache-rows').innerHTML = visible.map((entry) => (
    '<tr>'
    + '<td>' + esc(entry.kind === 'stage' ? '主题 + 动画' : entry.kind || '—') + '</td>'
    + '<td class="mono">' + esc(String(entry.key || '').slice(0, 10)) + '…</td>'
    + '<td>' + esc(entry.songTitle || '—') + '</td>'
    + '<td>' + esc(fmtBytes(entry.payloadBytes)) + '</td>'
    + '<td>' + esc(entry.hits ?? 0) + '</td>'
    + '<td>' + esc(fmtTime(entry.updatedAt)) + '</td>'
    + '<td><button data-act="view" data-id="' + esc(entry.kind + '/' + entry.key) + '">查看</button> '
    /*
     * 「渲染」跳到服务端画好的那一页：主题色块、高亮词的本色，还有这一条被覆盖留下
     * 的旧版 —— 弹窗里那坨 JSON 看不出这些。
     */
    + '<button data-act="render" data-id="' + esc(entry.kind + '/' + entry.key) + '">渲染</button> '
    + '<button class="danger" data-act="del" data-id="' + esc(entry.kind + '/' + entry.key) + '">删除</button></td>'
    + '</tr>'
  )).join('');
};

const loadStats = async () => {
  const data = await api('/admin/api/stats');
  renderStats(data);
};

const loadFonts = async () => {
  const data = await api('/admin/api/fonts');
  state.fonts = data.fonts ?? [];
  renderFonts();
};

const loadCache = async () => {
  const kind = String(document.getElementById('cache-kind')?.value || '');
  const query = String(document.getElementById('cache-search')?.value || '').trim();
  const search = new URLSearchParams({ limit: '200' });
  if (kind) search.set('kind', kind);
  if (query) search.set('q', query);
  const data = await api('/admin/api/ai-cache?' + search.toString());
  state.entries = data.entries ?? [];
  state.cacheTotal = Number(data.total ?? state.entries.length);
  renderCache();
};

const refreshAll = async () => {
  await Promise.all([loadStats(), loadFonts(), loadCache()]);
};

/* ---------------------------------------------------------------- preview */
let previewBlob = null;

const buildPreview = async () => {
  const fileInput = document.getElementById('font-file');
  const text = String(document.getElementById('preview-text').value || '').trim() || 'Folia';
  const errorNode = document.getElementById('upload-error');
  errorNode.textContent = '';
  const file = fileInput.files?.[0];
  if (!file) {
    errorNode.textContent = '先选一个字体文件。';
    return;
  }
  document.getElementById('make-preview').disabled = true;
  try {
    const buffer = await file.arrayBuffer();
    const family = 'folia_preview_' + Date.now().toString(36);
    const face = new FontFace(family, buffer);
    await face.load();
    document.fonts.add(face);
    await document.fonts.load('64px "' + family + '"', text);

    const width = 720;
    const height = 240;
    const canvas = document.createElement('canvas');
    canvas.width = width * 2;
    canvas.height = height * 2;
    const ctx = canvas.getContext('2d');
    ctx.scale(2, 2);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#f5f5f7';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    const lines = [text, 'Folia 0123 ABC abc'];
    const sizes = [64, 28];
    lines.forEach((line, index) => {
      ctx.font = sizes[index] + 'px "' + family + '"';
      ctx.fillText(line, width / 2, index === 0 ? 92 : 168);
    });

    const dataUrl = canvas.toDataURL('image/png');
    previewBlob = await (await fetch(dataUrl)).blob();
    document.getElementById('preview-holder').innerHTML =
      '<img src="' + dataUrl + '" alt="预览" style="max-width:100%;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:#111;" />';
    document.getElementById('do-upload').disabled = false;
    document.fonts.delete(face);
  } catch (error) {
    errorNode.textContent = '这个文件不是可用的字体：' + String(error?.message || error);
    previewBlob = null;
    document.getElementById('do-upload').disabled = true;
  } finally {
    document.getElementById('make-preview').disabled = false;
  }
};

/*
 * 上传成功后道一声谢。
 *
 * 字体是别人无偿传上来的，一句「感谢你的贡献」是应当的；顺便也给了「上传确实生效了」
 * 一个明确的落点 —— 否则界面只是把表单清空，看不出成功没成功。
 */
let thanksTimer = 0;
const showUploadThanks = () => {
  const node = document.getElementById('upload-thanks');
  if (!node) return;
  node.textContent = '上传成功，感谢你的贡献。';
  node.hidden = false;
  window.clearTimeout(thanksTimer);
  thanksTimer = window.setTimeout(() => { node.hidden = true; }, 6000);
};

const uploadFont = async () => {
  const file = document.getElementById('font-file').files?.[0];
  const errorNode = document.getElementById('upload-error');
  if (!file || !previewBlob) {
    errorNode.textContent = '先生成预览图。';
    return;
  }
  const button = document.getElementById('do-upload');
  button.disabled = true;
  try {
    const fontName = String(document.getElementById('font-name').value || '').trim() || file.name;
    const form = new FormData();
    form.append('file', file, file.name);
    form.append('preview', previewBlob, 'preview.png');
    form.append('name', fontName);
    form.append('category', String(document.getElementById('font-category').value || 'sans'));
    form.append('license', String(document.getElementById('font-license').value || '').trim());
    const response = await fetch('/admin/api/fonts', { method: 'POST', body: form });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || ('HTTP ' + response.status));
    document.getElementById('font-file').value = '';
    document.getElementById('font-name').value = '';
    document.getElementById('font-license').value = '';
    document.getElementById('preview-holder').innerHTML = '';
    previewBlob = null;
    errorNode.textContent = '';
    showUploadThanks();
    await refreshAll();
  } catch (error) {
    errorNode.textContent = '上传失败：' + String(error?.message || error);
  } finally {
    button.disabled = false;
  }
};

/* ---------------------------------------------------------------- events */
document.getElementById('logout').addEventListener('click', async () => {
  await fetch('/admin/logout', { method: 'POST' }).catch(() => {});
  window.location.reload();
});


document.getElementById('make-preview').addEventListener('click', () => { void buildPreview(); });
document.getElementById('do-upload').addEventListener('click', () => { void uploadFont(); });
document.getElementById('font-search').addEventListener('input', renderFonts);
document.getElementById('refresh-fonts').addEventListener('click', () => { void loadFonts(); });
document.getElementById('refresh-cache').addEventListener('click', () => { void loadCache(); });

/* 概况图是服务端按 minutes 现画的，换窗口就换一次 src；加个时间戳戳破缓存。 */
const reloadStatsImage = () => {
  const minutes = String(document.getElementById('stats-minutes')?.value || '5');
  const image = document.getElementById('stats-image');
  if (image instanceof HTMLImageElement) {
    image.src = '/admin/api/stats.svg?minutes=' + encodeURIComponent(minutes) + '&t=' + Date.now();
  }
};
document.getElementById('refresh-stats').addEventListener('click', reloadStatsImage);
document.getElementById('stats-minutes').addEventListener('change', reloadStatsImage);
/*
 * 缓存那张卡的搜索框与类型下拉都要**重新去服务端要一次**：库超过一页时，
 * 只有服务端才看得见第 501 条往后那些。输一个字就发一次请求太吵，攒 250ms。
 */
let cacheSearchTimer = null;
const scheduleCacheReload = () => {
  if (cacheSearchTimer) clearTimeout(cacheSearchTimer);
  cacheSearchTimer = setTimeout(() => { void loadCache(); }, 250);
};
document.getElementById('cache-search').addEventListener('input', scheduleCacheReload);
document.getElementById('cache-kind').addEventListener('change', () => { void loadCache(); });

document.getElementById('tab-fonts').addEventListener('click', () => {
  state.tab = 'fonts';
  document.getElementById('tab-fonts').setAttribute('aria-selected', 'true');
  document.getElementById('tab-cache').setAttribute('aria-selected', 'false');
  document.getElementById('view-fonts').hidden = false;
  document.getElementById('view-cache').hidden = true;
});

document.getElementById('tab-cache').addEventListener('click', () => {
  state.tab = 'cache';
  document.getElementById('tab-cache').setAttribute('aria-selected', 'true');
  document.getElementById('tab-fonts').setAttribute('aria-selected', 'false');
  document.getElementById('view-cache').hidden = false;
  document.getElementById('view-fonts').hidden = true;
});

const modal = document.getElementById('payload-modal');
modal.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;
  if (target === modal || target.getAttribute('data-close') === '1') {
    modal.hidden = true;
    modal.innerHTML = '';
  }
});

const showPayload = (title, value) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  modal.innerHTML = '<div class="modal-mask" data-close="1"><div class="modal">'
    + '<div class="head"><h2>' + esc(title) + '</h2><button data-close="1">关闭</button></div>'
    + '<pre class="json">' + esc(text) + '</pre></div></div>';
  modal.hidden = false;
};

document.getElementById('font-grid').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-act]');
  if (!button) return;
  const id = button.dataset.id;
  if (button.dataset.act === 'toggle') {
    const font = state.fonts.find((entry) => entry.id === id);
    if (!font) return;
    await api('/admin/api/fonts/' + encodeURIComponent(id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !font.enabled }),
    }).catch(() => {});
    await refreshAll();
    return;
  }
  if (button.dataset.act === 'delete') {
    if (!window.confirm('删除这个字体？正在用它的人会退回系统字体。')) return;
    await api('/admin/api/fonts/' + encodeURIComponent(id), { method: 'DELETE' }).catch(() => {});
    await refreshAll();
  }
});

document.getElementById('cache-rows').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-act]');
  if (!button) return;
  const id = button.dataset.id;
  if (button.dataset.act === 'view') {
    const data = await api('/admin/api/ai-cache/' + id).catch(() => null);
    if (data?.entry) showPayload('缓存内容 · ' + id, data.entry.payload);
    return;
  }
  if (button.dataset.act === 'render') {
    window.location.href = '/admin/cache/' + id;
    return;
  }
  if (button.dataset.act === 'del') {
    await api('/admin/api/ai-cache/' + id, { method: 'DELETE' }).catch(() => {});
    await refreshAll();
  }
});

document.getElementById('clear-cache').addEventListener('click', async () => {
  const kind = String(document.getElementById('cache-kind').value || '');
  if (!window.confirm(kind ? '清空「' + kind + '」的全部缓存？' : '清空全部云缓存？')) return;
  await api('/admin/api/ai-cache' + (kind ? ('?kind=' + encodeURIComponent(kind)) : ''), { method: 'DELETE' }).catch(() => {});
  await refreshAll();
});

void refreshAll();
`);
