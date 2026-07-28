// ===== AI 内容营销生成器 =====
// 前端 + 后端代理模式：Key 存服务端环境变量，前端调 /api/generate

const API_ENDPOINT = "/api/generate";

// 四个渠道的配置：各自的 system 人设 + 用户提示模板
const CHANNELS = [
  {
    id: "xhs",
    name: "小红书",
    cls: "xhs",
    system:
      "你是新媒体种草文案专家，深谙小红书平台调性。请写一篇小红书风格种草笔记：" +
      "1）一个带 emoji 的吸睛标题（不超过 20 字）；2）口语化、有场景感的正文（用 emoji 分段，像真人分享，不要硬广感）；" +
      "3）5-8 个相关话题标签（# 开头）。只输出笔记正文，不要任何解释或前后缀。",
    userTpl: (ctx) =>
      `产品：${ctx.prodName}\n目标人群：${ctx.audience}\n核心卖点：${ctx.points}\n品牌调性：${ctx.tone}\n\n请按上述要求写一篇小红书种草笔记。`,
  },
  {
    id: "dy",
    name: "抖音",
    cls: "dy",
    system:
      "你是短视频脚本专家。请为产品写一段抖音口播脚本，结构清晰：" +
      "【开场钩子】一句话留住人；【产品介绍】讲清是什么；【卖点放大】把核心卖点讲透；【行动号召】引导下单/关注。" +
      "每部分给出『画面』提示和『台词』。节奏快、口语化、有网感。只输出脚本内容，不要解释。",
    userTpl: (ctx) =>
      `产品：${ctx.prodName}\n目标人群：${ctx.audience}\n核心卖点：${ctx.points}\n品牌调性：${ctx.tone}\n\n请按上述结构写一段抖音口播脚本。`,
  },
  {
    id: "gzh",
    name: "公众号",
    cls: "gzh",
    system:
      "你是公众号内容编辑。请为产品写一篇公众号推文框架：" +
      "1）一个引发点击的标题（不超过 20 字，简洁有力）；2）一段引发共鸣的引言；3）3 个小标题，每个下面写 2-3 句要点；" +
      "4）一个自然收尾的引导。文风根据品牌调性调整，不要晦涩。只输出内容，不要解释。",
    userTpl: (ctx) =>
      `产品：${ctx.prodName}\n目标人群：${ctx.audience}\n核心卖点：${ctx.points}\n品牌调性：${ctx.tone}\n\n请写一篇公众号推文框架。`,
  },
  {
    id: "tb",
    name: "淘宝详情页",
    cls: "tb",
    system:
      "你是电商详情页文案专家。请为产品写淘宝详情页文案：" +
      "1）一个主标题（不超过 20 字）；2）5 条核心卖点（每条：卖点名 + 一句话解释）；3）3 条促销/信任背书话术；" +
      "4）一段品牌故事（突出产品特色、使用场景）。文案要直给、有转化力。只输出内容，不要解释。",
    userTpl: (ctx) =>
      `产品：${ctx.prodName}\n目标人群：${ctx.audience}\n核心卖点：${ctx.points}\n品牌调性：${ctx.tone}\n\n请写淘宝详情页文案。`,
  },
];

// ---- DOM ----
const $ = (id) => document.getElementById(id);
const generateBtn = $("generateBtn");
const copyAllBtn = $("copyAllBtn");
const genStatus = $("genStatus");
const resultsEl = $("results");
const serverStatus = $("serverStatus");

// ---- 收集表单 ----
function collectCtx() {
  return {
    prodName: $("prodName").value.trim() || "你的产品名称",
    audience: $("audience").value.trim() || "目标人群",
    points: $("sellingPoints").value.trim() || "核心卖点",
    tone: $("tone").value,
  };
}

// ---- 调用后端代理（/api/generate → 服务端转发到 MiniMax）----
async function callGenerate(channel, ctx) {
  const resp = await fetch(API_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      max_tokens: 800,
      system: channel.system,
      messages: [{ role: "user", content: channel.userTpl(ctx) }],
    }),
  });
  if (!resp.ok) {
    let msg = `HTTP ${resp.status}`;
    try { const err = await resp.json(); msg = err?.error || msg; } catch {}
    throw new Error(msg);
  }
  const data = await resp.json();
  return { text: data.text || "", usage: data.usage || null };
}

// ---- 渲染结果卡片 ----
function buildCards() {
  resultsEl.innerHTML = "";
  CHANNELS.forEach((ch) => {
    const card = document.createElement("div");
    card.className = `result-card ${ch.cls}`;
    card.id = `card-${ch.id}`;
    card.innerHTML = `
      <div class="rc-head">
        <span class="rc-title"><span class="dot"></span>${ch.name}</span>
        <button class="rc-copy" data-id="${ch.id}" disabled>复制</button>
      </div>
      <div class="rc-body loading"></div>
      <div class="rc-meta" id="meta-${ch.id}"></div>`;
    resultsEl.appendChild(card);
  });
  resultsEl.querySelectorAll(".rc-copy").forEach((b) => {
    b.addEventListener("click", () => copyOne(b.dataset.id));
  });
}

async function copyOne(id) {
  const body = $(`card-${id}`).querySelector(".rc-body");
  try {
    await navigator.clipboard.writeText(body.innerText);
    const btn = $(`card-${id}`).querySelector(".rc-copy");
    const old = btn.textContent; btn.textContent = "已复制 ✓";
    setTimeout(() => (btn.textContent = old), 1500);
  } catch (e) { alert("复制失败，请手动选择文本复制"); }
}

async function copyAll() {
  const texts = CHANNELS.map((ch) => {
    const c = $(`card-${ch.id}`);
    return `【${ch.name}】\n` + (c?.querySelector(".rc-body")?.innerText || "");
  }).join("\n\n");
  try {
    await navigator.clipboard.writeText(texts);
    const old = copyAllBtn.textContent; copyAllBtn.textContent = "已复制全部 ✓";
    setTimeout(() => (copyAllBtn.textContent = old), 1500);
  } catch (e) { alert("复制失败，请手动复制"); }
}

// ---- 主流程 ----
async function generate() {
  const ctx = collectCtx();
  generateBtn.disabled = true;
  copyAllBtn.disabled = true;
  genStatus.textContent = "正在调用模型生成四渠道文案…";
  genStatus.style.color = "#6b635e";
  buildCards();

  let ok = 0;
  await Promise.all(
    CHANNELS.map(async (ch) => {
      const card = $(`card-${ch.id}`);
      const body = card.querySelector(".rc-body");
      const meta = $(`meta-${ch.id}`);
      try {
        const { text, usage } = await callGenerate(ch, ctx);
        body.classList.remove("loading");
        body.textContent = text || "（模型返回为空）";
        const u = usage ? `本次消耗 token：输入 ${usage.input_tokens} / 输出 ${usage.output_tokens}` : "";
        meta.textContent = u;
        card.querySelector(".rc-copy").disabled = false;
        ok++;
      } catch (e) {
        body.classList.remove("loading");
        body.classList.add("error");
        body.textContent = "生成失败：" + e.message + "\n（若显示 Server not configured，说明服务端未设置 MINIMAX_API_KEY 环境变量）";
        meta.textContent = "";
      }
    })
  );

  generateBtn.disabled = false;
  copyAllBtn.disabled = ok === 0;
  $("wechatBtn").disabled = ok === 0;
  genStatus.textContent = ok === CHANNELS.length
    ? `✅ 四渠道文案已生成（共 ${CHANNELS.length} 套，均为模型实时产出）`
    : `⚠️ 成功 ${ok}/${CHANNELS.length} 套，失败见卡片提示`;
  genStatus.style.color = ok === CHANNELS.length ? "#07c160" : "#b42318";
}

generateBtn.addEventListener("click", generate);
copyAllBtn.addEventListener("click", copyAll);
$("wechatBtn").addEventListener("click", openWeChatModal);

// ============ 公众号格式：Markdown → HTML + 一键复制 ============
// 轻量 Markdown 转 HTML（公众号编辑器粘贴 HTML 会保留 标题/加粗/列表）
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function mdInline(t) {
  return escapeHtml(t)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");
}
function mdToHtml(md) {
  const lines = md.split("\n");
  let html = "";
  let inUl = false, inOl = false;
  const closeLists = () => {
    if (inUl) { html += "</ul>"; inUl = false; }
    if (inOl) { html += "</ol>"; inOl = false; }
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (/^\s*$/.test(line)) { closeLists(); continue; }
    let m;
    if ((m = line.match(/^###\s+(.*)$/))) { closeLists(); html += `<h3>${mdInline(m[1])}</h3>`; }
    else if ((m = line.match(/^##\s+(.*)$/))) { closeLists(); html += `<h2>${mdInline(m[1])}</h2>`; }
    else if ((m = line.match(/^#\s+(.*)$/))) { closeLists(); html += `<h1>${mdInline(m[1])}</h1>`; }
    else if ((m = line.match(/^\s*[-•·]\s+(.*)$/))) { if (!inUl) { closeLists(); html += "<ul>"; inUl = true; } html += `<li>${mdInline(m[1])}</li>`; }
    else if ((m = line.match(/^\s*\d+\.\s+(.*)$/))) { if (!inOl) { closeLists(); html += "<ol>"; inOl = true; } html += `<li>${mdInline(m[1])}</li>`; }
    else { closeLists(); html += `<p>${mdInline(line)}</p>`; }
  }
  closeLists();
  return html;
}

// 汇总四渠道为公众号 HTML 文档
function buildWeChatHtml() {
  let body = "";
  for (const ch of CHANNELS) {
    const c = $(`card-${ch.id}`);
    const text = c?.querySelector(".rc-body")?.innerText || "";
    if (!text.trim()) continue;
    body += `<h2>${ch.name}</h2>` + mdToHtml(text);
  }
  return (
    `<section style="font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;color:#3d3835;line-height:1.8;">` +
    `<h1 style="text-align:center;color:#a65d4c;">AI 内容营销方案</h1>` +
    `<p style="color:#6b635e;">以下文案由 AI 实时生成，覆盖小红书 / 抖音 / 公众号 / 淘宝详情页四渠道，可分别取用。</p>` +
    body +
    `</section>`
  );
}
function buildWeChatPlain() {
  return CHANNELS.map((ch) => {
    const c = $(`card-${ch.id}`);
    return `【${ch.name}】\n` + (c?.querySelector(".rc-body")?.innerText || "");
  }).join("\n\n");
}

// 弹窗
const wxModal = $("wxModal");
function openWeChatModal() {
  const html = buildWeChatHtml();
  $("wxPreview").innerHTML = html;
  $("wxMsg").textContent = "";
  wxModal.style.display = "flex";
}
function closeWeChatModal() { wxModal.style.display = "none"; }
$("wxClose").addEventListener("click", closeWeChatModal);
wxModal.addEventListener("click", (e) => { if (e.target === wxModal) closeWeChatModal(); });

// 复制（优先 text/html，公众号粘贴保留格式；降级纯文本）
async function copyWeChat() {
  const html = buildWeChatHtml();
  const plain = buildWeChatPlain();
  try {
    if (navigator.clipboard && window.ClipboardItem) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plain], { type: "text/plain" }),
        }),
      ]);
      $("wxMsg").textContent = "✅ 已复制，去公众号编辑器 Ctrl/⌘+V 粘贴即可";
      return;
    }
  } catch (e) { /* 落到降级 */ }
  try {
    await navigator.clipboard.writeText(plain);
    $("wxMsg").textContent = "✅ 已复制（纯文本）";
  } catch (e) {
    $("wxMsg").textContent = "❌ 复制失败，请手动选择预览区文本复制";
  }
}
$("wxCopy").addEventListener("click", copyWeChat);

// ---- 启动时检测后端状态 ----
fetch("/api/generate", { method: "OPTIONS" })
  .then((r) => {
    if (r.ok || r.status === 204) {
      serverStatus.textContent = "✅ 后端已就绪";
      serverStatus.style.color = "#07c160";
    }
  })
  .catch(() => {
    serverStatus.textContent = "⚠️ 未检测到后端（需先启动 node server.js）";
    serverStatus.style.color = "#b42318";
  });
