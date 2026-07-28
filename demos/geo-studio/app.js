// ===================== Tab 切换 =====================
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab).classList.add("active");
  });
});

// ===================== ① GEO 内容优化器 =====================
const geoInput = document.getElementById("geo-input");
const geoScene = document.getElementById("geo-scene");
const geoRun = document.getElementById("geo-run");
const geoStatus = document.getElementById("geo-status");
const geoOutput = document.getElementById("geo-output");
const geoResult = document.getElementById("geo-result");
const geoCopy = document.getElementById("geo-copy");

const SCENE_LABEL = {
  ecommerce: "电商商品页（面向购买决策，需参数、规格、对比）",
  wechat: "公众号推文（面向阅读与转发，需观点、故事、结构）",
  local: "本地服务介绍（面向附近人群，需地域、信任、联系方式）",
  general: "通用场景",
};

const GEO_SYSTEM = `你是一个 GEO（Generative Engine Optimization，生成式引擎优化）专家。
你的任务：把用户给的「产品/服务描述」改写成更容易被 AI 搜索引擎（Kimi、豆包、元宝、文心一言、ChatGPT 等）在回答里引用的结构。

改写原则（务必遵守）：
1. 事实清晰可核验：用具体数字、参数、产地、年份、认证，避免空话营销词（"醇厚""优质""领先"）。
2. 有明确观点/立场：敢于下结论，别模棱两可。
3. 分段小标题化：用 ## 小标题切分，每节一个明确主题。
4. 关键信息用列表/表格：参数、卖点、对比用 - 列表或表格呈现。
5. 补充权威出处或数据：能引来源就引，不能就标注"据品牌方"。
6. 直接回答用户可能问 AI 的问题：把常见提问的答案写进正文。

输出格式（严格按此）：
## 改写后的内容
（直接给出改写完、可粘贴使用的全文）

## 改了什么、为什么更易被引用
（3-5 条，每条一句话说明改法 + 对应的 GEO 原理）

只输出上述内容，不要寒暄。`;

function lightMarkdown(md) {
  return md
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/^## (.*)$/gm, "<h3>$1</h3>")
    .replace(/^### (.*)$/gm, "<h4>$1</h4>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>)+/g, (m) => `<ul>${m}</ul>`)
    .replace(/\n{2,}/g, "<br><br>");
}

geoRun.addEventListener("click", async () => {
  const text = geoInput.value.trim();
  if (!text) { geoStatus.textContent = "先填点内容吧"; return; }
  geoRun.disabled = true;
  geoStatus.textContent = "改写中…（约 5–15 秒）";
  geoOutput.classList.add("hidden");
  try {
    const resp = await fetch("/api/optimize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system: GEO_SYSTEM,
        max_tokens: 1400,
        messages: [{
          role: "user",
          content: `场景：${SCENE_LABEL[geoScene.value]}\n\n原始描述：\n${text}`,
        }],
      }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "请求失败");
    geoResult.innerHTML = lightMarkdown(data.text);
    geoOutput.classList.remove("hidden");
    geoStatus.textContent = "✅ 完成";
  } catch (e) {
    geoStatus.textContent = "❌ " + e.message;
  } finally {
    geoRun.disabled = false;
  }
});

geoCopy.addEventListener("click", () => {
  navigator.clipboard.writeText(geoResult.innerText).then(() => {
    const t = geoCopy.textContent;
    geoCopy.textContent = "✅ 已复制";
    setTimeout(() => (geoCopy.textContent = t), 1500);
  });
});

// ===================== ② 搜索流量依赖自检表 =====================
// 渠道库：tag = click(赌排名) / cite(被引用) / hybrid(混合)
// risk = 1(低) / 2(中) / 3(高，指该渠道流量在 AI 搜索时代有腰斩风险)
const CHANNELS = [
  { name: "百度 SEO", tag: "click", risk: 3, note: "AI Overview / AI 搜索答案直接吞掉自然点击" },
  { name: "谷歌 SEO", tag: "click", risk: 3, note: "AI Overviews 出现在搜索结果顶部，传统蓝链点击下滑" },
  { name: "传统软文 / 外链", tag: "click", risk: 3, note: "依赖搜索引擎排名分发，最易被 AI 答案替代" },
  { name: "小红书", tag: "hybrid", risk: 2, note: "搜索 + 推荐双引擎，部分内容被 AI 摘要引用" },
  { name: "公众号", tag: "hybrid", risk: 2, note: "订阅 + 搜索，文内观点可能被 AI 引用为来源" },
  { name: "知乎", tag: "hybrid", risk: 2, note: "回答常被 AI 当作权威来源引用" },
  { name: "B站", tag: "hybrid", risk: 2, note: "搜索 + 推荐，长视频内容可能被引用" },
  { name: "抖音", tag: "click", risk: 1, note: "推荐流为主，搜索占比小，短期影响低" },
  { name: "Kimi", tag: "cite", risk: 1, note: "AI 回答本身，天然属于「被引用」渠道" },
  { name: "豆包", tag: "cite", risk: 1, note: "AI 回答本身，天然属于「被引用」渠道" },
  { name: "元宝", tag: "cite", risk: 1, note: "AI 回答本身，天然属于「被引用」渠道" },
  { name: "文心一言", tag: "cite", risk: 1, note: "AI 回答本身，天然属于「被引用」渠道" },
];

const TAG_CLASS = { click: "tag-click", cite: "tag-cite", hybrid: "tag-hybrid" };
const TAG_TEXT = { click: "赌排名", cite: "被引用", hybrid: "混合" };

const channelListEl = document.getElementById("channel-list");
CHANNELS.forEach((c, i) => {
  const row = document.createElement("label");
  row.className = "ch-row";
  row.innerHTML = `
    <input type="checkbox" data-i="${i}" />
    <span class="ch-name">${c.name}</span>
    <span class="ch-tag ${TAG_CLASS[c.tag]}">${TAG_TEXT[c.tag]}</span>
    <input class="ch-share" type="number" min="0" max="100" placeholder="占比%" data-i="${i}" disabled />
  `;
  channelListEl.appendChild(row);
});

// 勾选才允许填占比；互斥提示
channelListEl.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
  cb.addEventListener("change", () => {
    const share = channelListEl.querySelector(`.ch-share[data-i="${cb.dataset.i}"]`);
    share.disabled = !cb.checked;
    if (!cb.checked) share.value = "";
  });
});

const auditRun = document.getElementById("audit-run");
const auditStatus = document.getElementById("audit-status");
const auditOutput = document.getElementById("audit-output");
const auditChart = document.getElementById("audit-chart");
const auditRisk = document.getElementById("audit-risk");
const auditChecklist = document.getElementById("audit-checklist");
const auditCopy = document.getElementById("audit-copy");

auditRun.addEventListener("click", () => {
  const rows = [...channelListEl.querySelectorAll(".ch-row")];
  const selected = [];
  rows.forEach((row) => {
    const cb = row.querySelector('input[type="checkbox"]');
    const share = row.querySelector(".ch-share");
    if (cb.checked) {
      const v = parseFloat(share.value);
      if (isNaN(v) || v <= 0) {
        auditStatus.textContent = `「${CHANNELS[cb.dataset.i].name}」请填占比（0–100）`;
        return;
      }
      selected.push({ ...CHANNELS[cb.dataset.i], share: v });
    }
  });
  if (selected.length === 0) {
    auditStatus.textContent = "至少勾选一个渠道并填占比";
    return;
  }
  auditStatus.textContent = "";
  renderAudit(selected);
});

function renderAudit(items) {
  const total = items.reduce((s, x) => s + x.share, 0);
  const sum = (tag) => items.filter((x) => x.tag === tag).reduce((s, x) => s + x.share, 0);
  const clickW = sum("click") / total * 100;
  const citeW = sum("cite") / total * 100;
  const hybridW = sum("hybrid") / total * 100;

  // 腰斩风险：按 risk 加权
  const weightedRisk = items.reduce((s, x) => s + x.share * x.risk, 0) / total; // 1..3
  const riskScore = Math.round(weightedRisk / 3 * 100);
  const level = riskScore >= 60 ? ["高", "label-high"] : riskScore >= 40 ? ["中", "label-mid"] : ["低", "label-low"];

  auditChart.innerHTML = `
    <div class="bar">
      <span class="seg-click" style="width:${clickW}%">${clickW >= 8 ? "被点击 " + Math.round(clickW) + "%" : ""}</span>
      <span class="seg-hybrid" style="width:${hybridW}%">${hybridW >= 8 ? "混合 " + Math.round(hybridW) + "%" : ""}</span>
      <span class="seg-cite" style="width:${citeW}%">${citeW >= 8 ? "被引用 " + Math.round(citeW) + "%" : ""}</span>
    </div>
    <div class="legend">
      <span><i style="background:var(--click)"></i>靠「被点击」获客（赌排名）</span>
      <span><i style="background:var(--hybrid)"></i>混合</span>
      <span><i style="background:var(--cite)"></i>靠「被引用」获客（AI 答案）</span>
    </div>`;

  auditRisk.innerHTML = `
    <div class="score ${level[1]}">${riskScore}<span style="font-size:14px;color:var(--muted)"> / 100</span></div>
    <div>三个月内流量腰斩风险：<strong class="${level[1]}">${level[0]}</strong></div>
    <div style="color:var(--muted);font-size:13px;margin-top:4px">
      风险来自你重仓的「赌排名」渠道（${Math.round(clickW)}% 流量靠传统搜索点击，AI 答案正在吞掉这部分点击）。
    </div>`;

  // 清单：找出占比最高的 click 渠道 + 建议
  const topClick = items.filter((x) => x.tag === "click").sort((a, b) => b.share - a.share)[0];
  const citeShareNow = Math.round(citeW);
  const actions = [];
  if (topClick) {
    actions.push({
      t: `把「${topClick.name}」至少 ${Math.min(20, Math.round(topClick.share * 0.3))}% 的预算/精力，挪到「被引用」渠道（Kimi / 豆包 / 元宝 / 知乎）。`,
      w: topClick.note,
    });
  }
  if (citeShareNow < 10) {
    actions.push({
      t: "你当前「被引用」渠道占比低于 10%——AI 答案里几乎没有你的声音。本周起在知乎 / 公众号发布结构化 FAQ（带清晰事实、参数、观点），让 AI 有料可引。",
      w: "AI 只引用它「读得到、信得过」的内容。",
    });
  } else {
    actions.push({
      t: `保持并扩大「被引用」渠道（现 ${citeShareNow}%）：持续在知乎 / 公众号 / 元宝生态产出带明确观点和数据的原创内容。`,
      w: "被引用 = 不被点击绑架，流量更稳。",
    });
  }
  actions.push({
    t: "给核心产品页做 GEO 改写（用本工具 Tab 1）：把卖点变成 AI 能直接抄走的「事实 + 观点 + 结构」。",
    w: "AI 引用偏好清晰、可核验、分段的内容。",
  });

  auditChecklist.innerHTML = "<ul>" + actions.map((a) =>
    `<li>${a.t}<span class="why">${a.w}</span></li>`
  ).join("") + "</ul>";

  auditOutput.classList.remove("hidden");
}

auditCopy.addEventListener("click", () => {
  const report = `搜索流量依赖自检表 · 诊断报告\n\n` +
    auditChart.innerText + "\n\n" + auditRisk.innerText + "\n\n可执行清单：\n" +
    [...auditChecklist.querySelectorAll("li")].map((li) => "· " + li.innerText.replace(/\n/g, " ")).join("\n");
  navigator.clipboard.writeText(report).then(() => {
    const t = auditCopy.textContent;
    auditCopy.textContent = "✅ 已复制";
    setTimeout(() => (auditCopy.textContent = t), 1500);
  });
});
