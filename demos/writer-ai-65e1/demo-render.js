// 结果渲染器（浏览器 + Node 测试共用）。纯函数：读 config.result.render 把模型返回的 JSON 渲染成 HTML。
// 支持的 as 类型：heading / text / section / tag / cards / table。
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export function renderNode(node, value) {
  if (value == null || value === '') return '';
  const as = node.as || 'text';
  if (as === 'heading') return `<div class="r-heading">${esc(value)}</div>`;
  if (as === 'text') return `<p class="r-text">${esc(value).replace(/\n/g, '<br>')}</p>`;
  if (as === 'section') return `<h3 class="r-section">${esc(node.label || '')}</h3><div class="r-text">${esc(value).replace(/\n/g, '<br>')}</div>`;
  if (as === 'tag') {
    const cls = (node.map && node.map[value]) || 'mid';
    return `<span class="tag tag-${esc(cls)}">${esc(value)}</span>`;
  }
  if (as === 'cards') {
    if (!Array.isArray(value)) return `<p class="r-text">${esc(value)}</p>`;
    return value.map((item) => `<div class="r-card">${(node.itemRender || []).map((n) => renderNode(n, item[n.field])).join('')}</div>`).join('');
  }
  if (as === 'table') {
    if (!Array.isArray(value) || !node.itemRender) return '';
    const cols = node.itemRender;
    const head = '<tr>' + cols.map((c) => `<th>${esc(c.label || c.field)}</th>`).join('') + '</tr>';
    const rows = value.map((item) => '<tr>' + cols.map((c) => `<td>${renderCell(c, item[c.field])}</td>`).join('') + '</tr>').join('');
    return `<table class="r-table"><thead>${head}</thead><tbody>${rows}</tbody></table>`;
  }
  return `<p class="r-text">${esc(value).replace(/\n/g, '<br>')}</p>`;
}

export function renderCell(node, value) {
  if (node.as === 'tag') { const cls = (node.map && node.map[value]) || 'mid'; return `<span class="tag tag-${esc(cls)}">${esc(value)}</span>`; }
  if (value == null) return '';
  if (typeof value === 'object') return esc(JSON.stringify(value));
  return esc(value).replace(/\n/g, '<br>');
}

export function renderResult(cfg, result) {
  const spec = (cfg.result && cfg.result.render) || [];
  let html = spec.map((n) => renderNode(n, result[n.field])).join('');
  if (!html.trim()) html = `<pre class="r-raw">${esc(typeof result === 'string' ? result : JSON.stringify(result, null, 2))}</pre>`;
  return html;
}
