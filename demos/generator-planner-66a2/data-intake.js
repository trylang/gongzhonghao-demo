/* ============================================================
 * data-intake.js —— demo 通用「数据入口」组件（平台固定资产，非 LLM 生成）
 *
 * 由 run-pipeline.mjs 在写出 index.html 时自动注入到 </body> 前。
 * LLM 只需在页面里声明两样东西，其余全部由本组件接管：
 *
 *   <div id="data-intake"></div>
 *   <script>
 *     window.DATA_SCHEMA = {
 *       name: "订单明细",                      // 模板名，用于下载文件名与提示语
 *       columns: [
 *         { key:"order_no", label:"订单号", type:"text",   example:"SO20260712001", required:true },
 *         { key:"customer", label:"客户",   type:"text",   example:"张女士" },
 *         { key:"amount",   label:"金额",   type:"number", example:"268" },
 *         { key:"date",     label:"下单日期", type:"date", example:"2026-07-12" }
 *       ],
 *       sample: [ {order_no:"...", customer:"...", amount:268, date:"..."}, ... ],  // 15~30 条示例
 *       maxRows: 300                                                                // 可选，默认 300
 *     };
 *   </script>
 *
 * 组件对外 API（LLM 生成的业务代码调用）：
 *   DataIntake.getPayload()  -> { source, totalRows, usedRows, sampled, columns, rows, summary }
 *   DataIntake.getRows()     -> 当前生效的数据行数组
 *   DataIntake.onChange(fn)  -> 数据源变化时回调
 *   DataIntake.isReady()     -> 组件是否成功挂载
 *
 * 设计原则：
 *   - 零外部依赖（禁 CDN），CSV 与 XLSX 均为内置解析
 *   - 未声明 DATA_SCHEMA 或无挂载点时静默跳过，绝不报错破坏页面（fail-soft）
 *   - 视觉自动探测宿主页面主色，融入各 demo 自己的设计系统
 * ============================================================ */
(function () {
  'use strict';

  if (window.DataIntake) return; // 防重复注入

  var MOUNT_ID = 'data-intake';
  var schema = null, mount = null;
  var state = { source: 'sample', rows: [], fileName: '', totalRows: 0, sampled: false };
  var listeners = [];

  /* ---------- 工具 ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  // 探测宿主页面主色，让组件融入各 demo 自己的设计系统
  function detectAccent() {
    var probes = ['--primary', '--brand', '--accent', '--main', '--color-primary', '--theme'];
    var cs = getComputedStyle(document.documentElement);
    for (var i = 0; i < probes.length; i++) {
      var v = cs.getPropertyValue(probes[i]).trim();
      if (v) return v;
    }
    var btn = document.querySelector('button');
    if (btn) {
      var bg = getComputedStyle(btn).backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
    }
    return '#8B3A1F';
  }

  /* ---------- CSV 解析（含引号转义 + 编码嗅探） ---------- */
  function decodeSmart(buf) {
    var u8 = new Uint8Array(buf);
    // UTF-8 BOM
    if (u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) {
      return new TextDecoder('utf-8').decode(u8.subarray(3));
    }
    var utf8 = new TextDecoder('utf-8').decode(u8);
    // Excel 在中文 Windows/Mac 上「另存为 CSV」默认写 GBK，UTF-8 解会出现替换字符
    var bad = (utf8.match(/\uFFFD/g) || []).length;
    if (bad > 0) {
      try {
        var gbk = new TextDecoder('gbk').decode(u8);
        if ((gbk.match(/\uFFFD/g) || []).length < bad) return gbk;
      } catch (e) { /* 环境不支持 gbk，退回 utf-8 */ }
    }
    return utf8;
  }

  function parseCSV(text) {
    var rows = [], row = [], cur = '', inQ = false;
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (inQ) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cur += '"'; i++; }
          else inQ = false;
        } else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += ch;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); });
  }

  /* ---------- XLSX 解析（ZIP + DecompressionStream，零依赖） ---------- */
  function u16(d, o) { return d[o] | (d[o + 1] << 8); }
  function u32(d, o) { return (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0; }

  function inflateRaw(u8) {
    if (typeof DecompressionStream === 'undefined') {
      return Promise.reject(new Error('当前浏览器不支持解析 Excel，请改用 CSV 模板'));
    }
    var ds = new DecompressionStream('deflate-raw');
    var stream = new Blob([u8]).stream().pipeThrough(ds);
    return new Response(stream).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }

  function unzip(u8) {
    var eocd = -1;
    for (var i = u8.length - 22; i >= 0 && i > u8.length - 22 - 65536; i--) {
      if (u32(u8, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('文件损坏或不是有效的 Excel 文件');
    var count = u16(u8, eocd + 10), off = u32(u8, eocd + 16), files = {};
    for (var n = 0; n < count; n++) {
      if (u32(u8, off) !== 0x02014b50) break;
      var method = u16(u8, off + 10), compSize = u32(u8, off + 20);
      var nameLen = u16(u8, off + 28), extraLen = u16(u8, off + 30), cmtLen = u16(u8, off + 32);
      var localOff = u32(u8, off + 42);
      var name = new TextDecoder('utf-8').decode(u8.subarray(off + 46, off + 46 + nameLen));
      var lNameLen = u16(u8, localOff + 26), lExtraLen = u16(u8, localOff + 28);
      var dataStart = localOff + 30 + lNameLen + lExtraLen;
      files[name] = { method: method, data: u8.subarray(dataStart, dataStart + compSize) };
      off += 46 + nameLen + extraLen + cmtLen;
    }
    return files;
  }

  function xmlEnt(s) {
    return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'").replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(+d); })
            .replace(/&amp;/g, '&');
  }
  function colIdx(ref) {
    var m = /^([A-Z]+)/.exec(ref);
    if (!m) return 0;
    var n = 0;
    for (var i = 0; i < m[1].length; i++) n = n * 26 + (m[1].charCodeAt(i) - 64);
    return n - 1;
  }

  function parseXLSX(buf) {
    var u8 = new Uint8Array(buf);
    var files = unzip(u8);
    var readText = function (name) {
      var f = files[name];
      if (!f) return Promise.resolve(null);
      if (f.method === 0) return Promise.resolve(new TextDecoder('utf-8').decode(f.data));
      return inflateRaw(f.data).then(function (r) { return new TextDecoder('utf-8').decode(r); });
    };
    var sheetName = Object.keys(files).filter(function (n) {
      return /^xl\/worksheets\/sheet\d+\.xml$/.test(n);
    }).sort()[0];
    if (!sheetName) throw new Error('Excel 里没有找到工作表');

    return readText('xl/sharedStrings.xml').then(function (sstXml) {
      var shared = [];
      if (sstXml) {
        (sstXml.match(/<si>[\s\S]*?<\/si>/g) || []).forEach(function (si) {
          var parts = si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
          shared.push(parts.map(function (p) { return xmlEnt(p.replace(/<[^>]+>/g, '')); }).join(''));
        });
      }
      return readText(sheetName).then(function (sheetXml) {
        var rows = [];
        (sheetXml.match(/<row[^>]*>[\s\S]*?<\/row>/g) || []).forEach(function (rowXml) {
          var cells = [];
          (rowXml.match(/<c[^>]*\/>|<c[^>]*>[\s\S]*?<\/c>/g) || []).forEach(function (cXml) {
            var ref = (/r="([A-Z]+\d+)"/.exec(cXml) || [])[1] || '';
            var t = (/t="([^"]+)"/.exec(cXml) || [])[1] || '';
            var val = '';
            if (t === 'inlineStr') {
              val = xmlEnt((/<t[^>]*>([\s\S]*?)<\/t>/.exec(cXml) || [])[1] || '');
            } else {
              var v = (/<v>([\s\S]*?)<\/v>/.exec(cXml) || [])[1];
              if (v != null) val = t === 's' ? (shared[+v] || '') : xmlEnt(v);
            }
            cells[colIdx(ref)] = val;
          });
          for (var i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = '';
          rows.push(cells);
        });
        return rows.filter(function (r) {
          return r.some(function (c) { return String(c).trim() !== ''; });
        });
      });
    });
  }

  /* ---------- 表头映射（容忍改名/多余列/顺序不同） ---------- */
  function norm(s) { return String(s || '').replace(/[\s　*（）()：:\-_]/g, '').toLowerCase(); }

  function mapHeader(header) {
    var map = {}, missing = [];
    schema.columns.forEach(function (col) {
      var want = [norm(col.label), norm(col.key)];
      var found = -1;
      for (var i = 0; i < header.length; i++) {
        var h = norm(header[i]);
        if (want.indexOf(h) >= 0) { found = i; break; }
      }
      if (found < 0) { // 退一步做包含匹配
        for (var j = 0; j < header.length; j++) {
          var hh = norm(header[j]);
          if (hh && (hh.indexOf(want[0]) >= 0 || want[0].indexOf(hh) >= 0)) { found = j; break; }
        }
      }
      if (found >= 0) map[col.key] = found;
      else if (col.required) missing.push(col.label);
    });
    return { map: map, missing: missing };
  }

  function toObjects(table) {
    if (!table.length) throw new Error('文件里没有读到数据');
    var header = table[0], body = table.slice(1);
    var r = mapHeader(header);
    if (r.missing.length) {
      throw new Error('缺少必需的列：' + r.missing.join('、') + '。请用下载的模板填写，不要删改表头。');
    }
    if (!Object.keys(r.map).length) {
      throw new Error('表头对不上模板，请先下载模板再填写');
    }
    return body.map(function (row) {
      var o = {};
      schema.columns.forEach(function (col) {
        var i = r.map[col.key];
        var v = i == null ? '' : String(row[i] == null ? '' : row[i]).trim();
        if (col.type === 'number') {
          var num = parseFloat(String(v).replace(/[,¥$\s]/g, ''));
          o[col.key] = isNaN(num) ? 0 : num;
        } else o[col.key] = v;
      });
      return o;
    }).filter(function (o) {
      return Object.keys(o).some(function (k) { return o[k] !== '' && o[k] !== 0; });
    });
  }

  /* ---------- 降采样 + 全量统计摘要 ---------- */
  function summarize(rows) {
    var s = { 总行数: rows.length };
    schema.columns.forEach(function (col) {
      var vals = rows.map(function (r) { return r[col.key]; });
      if (col.type === 'number') {
        var nums = vals.filter(function (v) { return typeof v === 'number' && !isNaN(v); });
        if (!nums.length) return;
        var sum = nums.reduce(function (a, b) { return a + b; }, 0);
        s[col.label] = {
          合计: Math.round(sum * 100) / 100,
          均值: Math.round(sum / nums.length * 100) / 100,
          最小: Math.min.apply(null, nums),
          最大: Math.max.apply(null, nums)
        };
      } else {
        var cnt = {};
        vals.forEach(function (v) { if (v) cnt[v] = (cnt[v] || 0) + 1; });
        var top = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; }).slice(0, 5);
        if (top.length) {
          s[col.label] = { 去重数: Object.keys(cnt).length, 高频值: top.map(function (k) { return k + '(' + cnt[k] + ')'; }) };
        }
      }
    });
    return s;
  }

  function downsample(rows) {
    var max = schema.maxRows || 300;
    if (rows.length <= max) return { rows: rows, sampled: false };
    var step = rows.length / max, out = [];
    for (var i = 0; i < max; i++) out.push(rows[Math.floor(i * step)]);
    return { rows: out, sampled: true };
  }

  /* ---------- 模板下载 ---------- */
  function buildTemplateCSV() {
    var header = schema.columns.map(function (c) { return c.label; });
    var lines = [header.join(',')];
    var demo = (schema.sample || []).slice(0, 3);
    if (demo.length) {
      demo.forEach(function (row) {
        lines.push(schema.columns.map(function (c) {
          var v = String(row[c.key] == null ? '' : row[c.key]);
          return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
        }).join(','));
      });
    } else {
      lines.push(schema.columns.map(function (c) { return c.example || ''; }).join(','));
    }
    return '\uFEFF' + lines.join('\r\n') + '\r\n'; // BOM：保证 Excel 打开中文不乱码
  }

  function downloadTemplate() {
    var blob = new Blob([buildTemplateCSV()], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (schema.name || '数据') + '模板.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ---------- 渲染 ---------- */
  function injectStyle(accent) {
    if (document.getElementById('di-style')) return;
    var css = [
      '#' + MOUNT_ID + ' .di-wrap{border:1px solid rgba(0,0,0,.1);border-radius:12px;padding:14px 16px;margin:12px 0;background:rgba(0,0,0,.015)}',
      '#' + MOUNT_ID + ' .di-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px}',
      '#' + MOUNT_ID + ' .di-title{font-weight:600;font-size:14px;margin-right:auto}',
      '#' + MOUNT_ID + ' .di-tab{border:1px solid rgba(0,0,0,.15);background:transparent;color:inherit;border-radius:999px;padding:5px 14px;font-size:13px;cursor:pointer;line-height:1.4}',
      '#' + MOUNT_ID + ' .di-tab.on{background:' + accent + ';color:#fff;border-color:' + accent + '}',
      '#' + MOUNT_ID + ' .di-link{background:none;border:none;color:' + accent + ';font-size:13px;cursor:pointer;text-decoration:underline;padding:4px 2px}',
      '#' + MOUNT_ID + ' .di-drop{border:1.5px dashed rgba(0,0,0,.2);border-radius:10px;padding:20px 12px;text-align:center;font-size:13px;cursor:pointer;transition:.15s}',
      '#' + MOUNT_ID + ' .di-drop:hover,#' + MOUNT_ID + ' .di-drop.over{border-color:' + accent + ';background:rgba(0,0,0,.03)}',
      '#' + MOUNT_ID + ' .di-hint{font-size:12px;opacity:.6;margin-top:6px;line-height:1.6}',
      '#' + MOUNT_ID + ' .di-err{color:#b3261e;font-size:13px;margin-top:8px;line-height:1.6}',
      '#' + MOUNT_ID + ' .di-ok{font-size:13px;margin-top:8px;line-height:1.6}',
      '#' + MOUNT_ID + ' .di-prev{max-height:190px;overflow:auto;margin-top:10px;border:1px solid rgba(0,0,0,.08);border-radius:8px}',
      '#' + MOUNT_ID + ' .di-prev table{width:100%;border-collapse:collapse;font-size:12px}',
      '#' + MOUNT_ID + ' .di-prev th{position:sticky;top:0;background:rgba(0,0,0,.05);text-align:left;padding:6px 8px;white-space:nowrap;font-weight:600}',
      '#' + MOUNT_ID + ' .di-prev td{padding:5px 8px;border-top:1px solid rgba(0,0,0,.06);white-space:nowrap}',
      '@media(max-width:520px){#' + MOUNT_ID + ' .di-title{width:100%;margin-bottom:4px}}'
    ].join('\n');
    var st = el('style');
    st.id = 'di-style';
    st.textContent = css;
    document.head.appendChild(st);
  }

  function render() {
    var accent = detectAccent();
    injectStyle(accent);
    mount.innerHTML = '';
    var wrap = el('div', 'di-wrap');

    var top = el('div', 'di-top');
    top.appendChild(el('span', 'di-title', '数据来源'));
    var tabSample = el('button', 'di-tab' + (state.source === 'sample' ? ' on' : ''), '使用示例数据');
    var tabUpload = el('button', 'di-tab' + (state.source === 'upload' ? ' on' : ''), '上传我的数据');
    tabSample.type = 'button'; tabUpload.type = 'button';
    top.appendChild(tabSample); top.appendChild(tabUpload);
    wrap.appendChild(top);

    var body = el('div');
    wrap.appendChild(body);

    function paintSample() {
      body.innerHTML = '';
      var n = (schema.sample || []).length;
      body.appendChild(el('div', 'di-ok',
        '已载入 <b>' + n + '</b> 条' + esc(schema.name || '示例') + '示例数据，可直接生成结果体验效果。'));
      body.appendChild(previewTable(state.rows.slice(0, 8)));
    }

    function paintUpload() {
      body.innerHTML = '';
      var tip = el('div', 'di-hint',
        '第一步：<span class="di-dl" style="text-decoration:underline;cursor:pointer;color:' + accent + '">下载「' +
        esc(schema.name || '数据') + '模板.csv」</span>，用 Excel / WPS 打开按格式填写。<br>' +
        '第二步：把填好的文件拖进下方区域，或点击选择。支持 .csv 与 .xlsx。');
      body.appendChild(tip);
      tip.querySelector('.di-dl').addEventListener('click', downloadTemplate);

      var drop = el('div', 'di-drop', '点击选择文件，或把文件拖到这里');
      var input = el('input');
      input.type = 'file';
      input.accept = '.csv,.xlsx,text/csv';
      input.style.display = 'none';
      drop.addEventListener('click', function () { input.click(); });
      input.addEventListener('change', function () { if (input.files[0]) handleFile(input.files[0]); });
      ['dragenter', 'dragover'].forEach(function (e) {
        drop.addEventListener(e, function (ev) { ev.preventDefault(); drop.classList.add('over'); });
      });
      ['dragleave', 'drop'].forEach(function (e) {
        drop.addEventListener(e, function (ev) { ev.preventDefault(); drop.classList.remove('over'); });
      });
      drop.addEventListener('drop', function (ev) {
        if (ev.dataTransfer.files[0]) handleFile(ev.dataTransfer.files[0]);
      });
      body.appendChild(drop);
      body.appendChild(input);
      body.appendChild(el('div', 'di-hint',
        '数据只在生成这一次里用于分析，服务器不保存、不留档。建议先删掉手机号等敏感列。'));
      var slot = el('div');
      slot.id = 'di-result';
      body.appendChild(slot);
      if (state.source === 'upload' && state.rows.length) paintUploadResult(slot);
    }

    function paintUploadResult(slot) {
      slot.innerHTML = '';
      slot.appendChild(el('div', 'di-ok',
        '✅ 已读取 <b>' + esc(state.fileName) + '</b>，共 <b>' + state.totalRows + '</b> 行' +
        (state.sampled ? '（数据量较大，已均匀抽取 ' + state.rows.length + ' 行送入分析，统计口径仍按全量计算）' : '') + '。'));
      slot.appendChild(previewTable(state.rows.slice(0, 8)));
      var reset = el('button', 'di-link', '换一个文件 / 恢复示例数据');
      reset.type = 'button';
      reset.addEventListener('click', function () { useSample(); render(); });
      slot.appendChild(reset);
    }

    function handleFile(file) {
      var slot = document.getElementById('di-result');
      slot.innerHTML = '<div class="di-hint">正在解析…</div>';
      var isXlsx = /\.xlsx$/i.test(file.name);
      if (/\.xls$/i.test(file.name)) {
        slot.innerHTML = '<div class="di-err">旧版 .xls 无法直接读取，请在 Excel 里另存为 .xlsx 或 CSV 后再上传。</div>';
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        var task;
        try {
          task = isXlsx ? parseXLSX(reader.result)
                        : Promise.resolve(parseCSV(decodeSmart(reader.result)));
        } catch (e) { task = Promise.reject(e); }
        task.then(function (table) {
          var objs = toObjects(table);
          if (!objs.length) throw new Error('文件里没有有效数据行，请检查是否只填了表头');
          var ds = downsample(objs);
          state.source = 'upload';
          state.fileName = file.name;
          state.totalRows = objs.length;
          state.rows = ds.rows;
          state.sampled = ds.sampled;
          state.fullSummary = summarize(objs);
          paintUploadResult(slot);
          emit();
        }).catch(function (e) {
          slot.innerHTML = '<div class="di-err">❌ ' + esc(e.message || '解析失败，请确认文件格式') + '</div>';
        });
      };
      reader.onerror = function () {
        slot.innerHTML = '<div class="di-err">❌ 文件读取失败，请重试</div>';
      };
      if (isXlsx) reader.readAsArrayBuffer(file);
      else reader.readAsArrayBuffer(file); // CSV 也读二进制，便于编码嗅探
    }

    function previewTable(rows) {
      var box = el('div', 'di-prev');
      if (!rows.length) return box;
      var t = el('table');
      var thead = el('thead');
      var tr = el('tr');
      schema.columns.forEach(function (c) { tr.appendChild(el('th', null, esc(c.label))); });
      thead.appendChild(tr);
      t.appendChild(thead);
      var tb = el('tbody');
      rows.forEach(function (r) {
        var row = el('tr');
        schema.columns.forEach(function (c) { row.appendChild(el('td', null, esc(r[c.key]))); });
        tb.appendChild(row);
      });
      t.appendChild(tb);
      box.appendChild(t);
      return box;
    }

    tabSample.addEventListener('click', function () { useSample(); render(); });
    tabUpload.addEventListener('click', function () { state.source = 'upload'; render(); });

    if (state.source === 'sample') paintSample(); else paintUpload();
    mount.appendChild(wrap);
  }

  function useSample() {
    state.source = 'sample';
    state.rows = (schema.sample || []).slice();
    state.totalRows = state.rows.length;
    state.sampled = false;
    state.fileName = '';
    state.fullSummary = state.rows.length ? summarize(state.rows) : null;
    emit();
  }

  function emit() {
    listeners.forEach(function (fn) { try { fn(api.getPayload()); } catch (e) {} });
  }

  /* ---------- 对外 API ---------- */
  var api = {
    isReady: function () { return !!schema && !!mount; },
    getRows: function () { return state.rows.slice(); },
    getPayload: function () {
      return {
        source: state.source === 'upload' ? '用户上传' : '示例数据',
        fileName: state.fileName || null,
        totalRows: state.totalRows,
        usedRows: state.rows.length,
        sampled: state.sampled,
        columns: schema ? schema.columns.map(function (c) { return c.label; }) : [],
        summary: state.fullSummary || null,
        rows: state.rows
      };
    },
    onChange: function (fn) { if (typeof fn === 'function') listeners.push(fn); },
    downloadTemplate: function () { if (schema) downloadTemplate(); },
    reset: function () { if (schema) { useSample(); render(); } },
    // 内部方法：供自动化自测与线上排障使用
    _internal: {
      parseCSV: parseCSV, parseXLSX: parseXLSX, decodeSmart: decodeSmart,
      toObjects: toObjects, summarize: summarize, downsample: downsample,
      buildTemplateCSV: buildTemplateCSV,
      setSchema: function (s) { schema = s; }
    }
  };
  window.DataIntake = api;

  function boot() {
    schema = window.DATA_SCHEMA || null;
    mount = document.getElementById(MOUNT_ID);
    // fail-soft：LLM 没声明 schema 或没放挂载点时，静默跳过，不影响页面其余功能
    if (!schema || !mount || !Array.isArray(schema.columns) || !schema.columns.length) {
      schema = null;
      return;
    }
    useSample();
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
