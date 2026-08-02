// 配置驱动的前端框架（脚手架）。不手写任何业务逻辑——只读取 config.json：
//   · 按 fields 动态生成表单
//   · 把 /api/generate 返回的 JSON 按 result.render 渲染成 标题/段落/区块/标签/卡片/表格
//   · 支持 加载态 / 错误态 / 复制 / 下载 / 重新填写 / 可选的 refine 多轮澄清
import { renderResult } from './demo-render.js';

(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const state = { config: null, result: null, history: null };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  // ---------- 加载 config ----------
  async function loadConfig() {
    const res = await fetch('config.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('config.json 加载失败（HTTP ' + res.status + '）');
    return res.json();
  }

  // ---------- 构建表单 ----------
  function buildForm(cfg) {
    const form = $('#form');
    form.innerHTML = '';
    (cfg.fields || []).forEach((f) => {
      const wrap = document.createElement('div');
      wrap.className = 'field';
      const id = 'f_' + f.key;
      const label = document.createElement('label');
      label.htmlFor = id;
      label.textContent = f.label + (f.required ? ' *' : '');
      wrap.appendChild(label);
      if (f.help) {
        const h = document.createElement('p');
        h.className = 'field-help';
        h.textContent = f.help;
        wrap.appendChild(h);
      }
      if (f.type === 'textarea') {
        const el = document.createElement('textarea');
        el.id = id; el.name = f.key; el.rows = 3;
        if (f.placeholder) el.placeholder = f.placeholder;
        if (f.required) el.required = true;
        wrap.appendChild(el);
      } else if (f.type === 'select') {
        const el = document.createElement('select');
        el.id = id; el.name = f.key;
        if (f.required) el.required = true;
        if (!f.required) { const ph = document.createElement('option'); ph.value = ''; ph.textContent = '— 请选择 —'; el.appendChild(ph); }
        (f.options || []).forEach((o) => { const op = document.createElement('option'); op.value = o; op.textContent = o; el.appendChild(op); });
        wrap.appendChild(el);
      } else if (f.type === 'radio' || f.type === 'checkbox') {
        const grp = document.createElement('div');
        grp.className = 'opt-group';
        (f.options || []).forEach((o) => {
          const lab = document.createElement('label');
          lab.className = 'opt';
          const inp = document.createElement('input');
          inp.type = f.type; inp.name = f.key; inp.value = o;
          if (f.required) inp.required = true;
          lab.appendChild(inp);
          lab.appendChild(document.createTextNode(' ' + o));
          grp.appendChild(lab);
        });
        wrap.appendChild(grp);
      } else {
        const el = document.createElement('input');
        el.type = 'text'; el.id = id; el.name = f.key;
        if (f.placeholder) el.placeholder = f.placeholder;
        if (f.required) el.required = true;
        wrap.appendChild(el);
      }
      form.appendChild(wrap);
    });
  }

  function collectFields(cfg) {
    const out = {};
    (cfg.fields || []).forEach((f) => {
      if (f.type === 'checkbox') {
        out[f.key] = $$(`[name="${f.key}"]:checked`).map((c) => c.value);
      } else if (f.type === 'radio') {
        const checked = $$(`[name="${f.key}"]:checked`)[0];
        out[f.key] = checked ? checked.value : '';
      } else {
        const el = $('#f_' + f.key);
        out[f.key] = el ? el.value.trim() : '';
      }
    });
    return out;
  }

  // ---------- refine 多轮澄清 ----------
  function hasRefine(cfg, result) {
    return cfg.refine && Array.isArray(result.clarifyingQuestions) && result.clarifyingQuestions.length;
  }
  function showRefine(questions) {
    const c = $('#refineQuestions');
    c.innerHTML = '';
    questions.forEach((q, i) => {
      const d = document.createElement('div');
      d.className = 'field';
      d.innerHTML = `<label>${i + 1}. ${esc(q)}</label><input type="text" data-q="${esc(q)}" placeholder="你的回答…" />`;
      c.appendChild(d);
    });
    $('#refineCard').classList.remove('hidden');
  }
  function collectRefine() {
    const clar = {};
    $$('#refineQuestions input[type=text]').forEach((inp) => { if (inp.value.trim()) clar[inp.dataset.q] = inp.value.trim(); });
    return clar;
  }

  // ---------- 状态 / 交互 ----------
  function setBusy(b) {
    const btn = $('#btnRun');
    btn.disabled = b;
    btn.classList.toggle('btn-busy', b);
    btn.innerHTML = b ? '<span class="spinner"></span> 生成中…' : '生成 / 运行';
    const rb = $('#btnRefine');
    if (rb) rb.disabled = b;
  }
  function setStatus(msg, kind) {
    const s = $('#status');
    s.textContent = msg || '';
    s.className = 'status' + (kind ? ' status-' + kind : '');
  }

  async function run(useRefine) {
    if (!state.config) return;
    const cfg = state.config;
    const fields = collectFields(cfg);
    const missing = (cfg.fields || []).filter((f) => {
      if (!f.required) return false;
      const v = fields[f.key];
      return f.type === 'checkbox' ? !(v && v.length) : !v;
    });
    if (missing.length) { setStatus('请填写：' + missing.map((f) => f.label).join('、'), 'err'); return; }

    setStatus('正在生成…');
    setBusy(true);
    $('#resultCard').classList.add('hidden');
    $('#refineCard').classList.add('hidden');
    try {
      const payload = { fields };
      if (useRefine && state.history) {
        payload.history = state.history;
        payload.clarifications = collectRefine();
      }
      const resp = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || '请求失败');

      if (data.parseError) {
        // 模型没返 JSON：降级展示原文
        $('#resultOut').innerHTML = `<pre class="r-raw">${esc(data.raw)}</pre>`;
        setStatus('模型未返回标准 JSON，已展示原文', 'warn');
      } else {
        state.result = data.result;
        $('#resultOut').innerHTML = renderResult(cfg, data.result);
        if (hasRefine(cfg, data.result)) {
          state.history = data.result;
          showRefine(data.result.clarifyingQuestions);
          setStatus('可补充信息，生成更准的定稿', 'ok');
        } else {
          setStatus('', 'ok');
        }
      }
      $('#resultCard').classList.remove('hidden');
    } catch (e) {
      $('#resultOut').innerHTML = `<div class="r-err">出错了：${esc(e.message)}</div>`;
      $('#resultCard').classList.remove('hidden');
      setStatus('出错：' + e.message, 'err');
    } finally {
      setBusy(false);
    }
  }

  function copyText() {
    const t = $('#resultOut').innerText;
    navigator.clipboard.writeText(t).then(() => setStatus('已复制', 'ok')).catch(() => setStatus('复制失败，请手动选择', 'err'));
  }
  function downloadHTML() {
    const title = (state.config && state.config.title) || '工具结果';
    const body = `<pre style="font-family:inherit;white-space:pre-wrap;padding:20px">${esc($('#resultOut').innerText)}</pre>`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([body], { type: 'text/html' }));
    a.download = title + '.html';
    a.click();
  }

  // ---------- 初始化 ----------
  async function init() {
    try {
      const cfg = await loadConfig();
      state.config = cfg;
      document.title = cfg.title || '工具';
      $('#appTitle').textContent = cfg.title || '';
      $('#appSubtitle').textContent = cfg.subtitle || '';
      if (cfg.accent) document.documentElement.style.setProperty('--accent', cfg.accent);
      buildForm(cfg);
    } catch (e) {
      $('#appTitle').textContent = '加载失败';
      $('#appSubtitle').textContent = e.message;
    }
    $('#btnRun').addEventListener('click', (e) => { e.preventDefault(); run(false); });
    $('#btnRefine').addEventListener('click', () => run(true));
    $('#btnCopy').addEventListener('click', copyText);
    $('#btnDownload').addEventListener('click', downloadHTML);
    $('#btnReset').addEventListener('click', () => {
      $('#resultCard').classList.add('hidden');
      $('#refineCard').classList.add('hidden');
      setStatus('');
    });
  }
  init();
})();
