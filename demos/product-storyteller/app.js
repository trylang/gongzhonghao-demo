/* 产品会说话 — 前端逻辑 */

const $ = (id) => document.getElementById(id);

const SAMPLE = {
  name: "代州黄酒",
  desc: "山西代县传统黄酒，选用本地黍米，古法冬酿 180 天，无添加剂，度数低适口，温饮更佳，适合家宴与送礼。",
  steps: "选米\n浸泡\n蒸饭\n落缸\n冬酿 180 天\n压榨过滤",
};

let storyData = null;

$("btn-sample").onclick = () => {
  $("pname").value = SAMPLE.name;
  $("pdesc").value = SAMPLE.desc;
  $("psteps").value = SAMPLE.steps;
};

async function callAI(system, user, maxTokens = 2500) {
  const resp = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system, messages: [{ role: "user", content: user }], max_tokens: maxTokens }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || "请求失败");
  return data.text || "";
}

function parseJSON(text) {
  let t = text.replace(/```json|```/g, "").trim();
  const start = t.indexOf("{");
  if (start < 0) throw new Error("模型未返回 JSON");
  const end = t.lastIndexOf("}");
  const raw = end > start ? t.slice(start, end + 1) : t.slice(start);
  try { return JSON.parse(raw); } catch (_) {}
  const fixed = repairJSONStrings(raw);
  try { return JSON.parse(fixed); } catch (_) {}
  throw new Error("AI 返回内容格式异常，请再点一次重试");
}

function repairJSONStrings(s) {
  let out = "", inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (!inStr) {
      if (c === '"') inStr = true;
      out += c;
      continue;
    }
    if (c === "\\") { out += c + (s[i + 1] || ""); i++; continue; }
    if (c === '"') {
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j])) j++;
      const nxt = s[j];
      if (nxt === undefined || nxt === "," || nxt === "}" || nxt === "]" || nxt === ":") {
        inStr = false; out += c;
      } else {
        out += '\\"';
      }
      continue;
    }
    if (c === "\n") { out += "\\n"; continue; }
    if (c === "\r") continue;
    if (c === "\t") { out += "\\t"; continue; }
    out += c;
  }
  return out;
}

async function generate() {
  const name = $("pname").value.trim();
  const desc = $("pdesc").value.trim();
  const steps = $("psteps").value.trim();
  const st = $("status");
  if (!name || !desc || !steps) { st.textContent = "三个输入框都要填（流程写步骤名就行）"; st.className = "status error"; return; }
  $("btn-gen").disabled = true;
  st.className = "status";
  st.textContent = "AI 正在组织卖点、补工艺故事……（约 30 秒）";
  try {
    const text = await callAI(
      `你是产品故事策划。根据产品信息生成互动讲解页内容。严格输出 JSON 对象，不要输出其他内容：
{
 "tagline":"一句打动人的副标题（20字内）",
 "sellingPoints":[{"icon":"一个emoji","title":"卖点标题（8字内）","detail":"细节说明（40字内，具体、有画面感）"}],
 "steps":[{"name":"步骤名","story":"这一步在做什么、为什么重要（50字内，讲给外行听）","secret":"一句行家才知道的门道（25字内）"}]
}
要求：sellingPoints 4-6 个；steps 严格按用户给的顺序逐步展开；语言口语化、不吹嘘、有真实感。所有字符串值内部禁止出现英文双引号和换行，引用语气请用中文引号「」。`,
      `产品名：${name}\n产品介绍：${desc}\n工艺流程（按序）：\n${steps}`,
      3000
    );
    storyData = parseJSON(text);
    storyData.name = name;
    renderStory();
    st.textContent = "✅ 生成完毕，往下看成品";
    $("result").classList.remove("hidden");
    $("result").scrollIntoView({ behavior: "smooth" });
  } catch (e) {
    st.textContent = "出错了：" + e.message;
    st.className = "status error";
  } finally {
    $("btn-gen").disabled = false;
  }
}

$("btn-gen").onclick = generate;
$("btn-regen").onclick = generate;

function storyHTML(d, standalone = false) {
  const sp = (d.sellingPoints || [])
    .map(
      (s) => `<div class="sp-card" onclick="this.classList.toggle('open')">
  <div class="sp-icon">${esc(s.icon || "✨")}</div>
  <div class="sp-title">${esc(s.title)}</div>
  <div class="sp-detail">${esc(s.detail)}</div>
  <div class="sp-more">点击查看细节 ▾</div>
</div>`
    )
    .join("");
  const tl = (d.steps || [])
    .map(
      (s, i) => `<div class="tl-step" onclick="this.classList.toggle('open')">
  <div class="tl-name">第 ${i + 1} 步 · ${esc(s.name)} <span class="tl-more">▾</span></div>
  <div class="tl-body">
    <div class="tl-story">${esc(s.story)}</div>
    ${s.secret ? `<div class="tl-secret">🔑 行家门道：${esc(s.secret)}</div>` : ""}
  </div>
</div>`
    )
    .join("");
  return `<div class="story">
  <div class="story-hero"><h1>${esc(d.name)}</h1><p class="tagline">${esc(d.tagline || "")}</p></div>
  <div class="story-section"><h2>为什么值得选</h2><div class="sp-grid">${sp}</div></div>
  <div class="story-section"><h2>它是怎么做出来的</h2><div class="timeline">${tl}</div></div>
  <div class="story-footer">本页由「产品会说话」生成 · 点击卡片与步骤可展开${standalone ? "" : "（预览）"}</div>
</div>`;
}

function renderStory() {
  $("preview").innerHTML = storyHTML(storyData);
}

/* 下载独立 HTML：内联样式，双击就能打开，可挂详情页 */
$("btn-download").onclick = async () => {
  if (!storyData) return;
  const css = await fetch("style.css").then((r) => r.text());
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(storyData.name)} · 互动讲解页</title>
<style>${css}</style>
</head>
<body style="padding:16px;max-width:720px;margin:0 auto;">
${storyHTML(storyData, true)}
</body>
</html>`;
  const blob = new Blob([html], { type: "text/html" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${storyData.name}-互动讲解页.html`;
  a.click();
  URL.revokeObjectURL(a.href);
};

function esc(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
