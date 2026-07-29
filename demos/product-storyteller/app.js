/* 产品会说话 — 前端逻辑（C-lite：D3 长卷 + 三套主题皮） */

const $ = (id) => document.getElementById(id);

const SAMPLE = {
  name: "代州黄酒",
  desc: "山西代县传统黄酒，选用本地黍米，古法冬酿 180 天，无添加剂，度数低适口，温饮更佳，适合家宴与送礼。",
  steps: "选米\n浸泡\n蒸饭\n落缸\n冬酿 180 天\n压榨过滤",
};

let storyData = null;
let userTheme = "auto"; // auto | gufa | blueprint | flow

document.querySelectorAll(".theme-chip").forEach((chip) => {
  chip.onclick = () => {
    document.querySelectorAll(".theme-chip").forEach((c) => c.classList.remove("on"));
    chip.classList.add("on");
    userTheme = chip.dataset.theme;
    /* 已经生成过就即时换皮，不重新调 AI */
    if (storyData) renderStory();
  };
});

function activeTheme() {
  if (userTheme !== "auto") return userTheme;
  return (storyData && storyData.theme && window.PSScene.THEMES[storyData.theme]) ? storyData.theme : "gufa";
}

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
  try { return JSON.parse(repairJSONStructure(fixed)); } catch (_) {}
  throw new Error("AI 返回内容格式异常，请再点一次重试");
}

/* 结构级修复：括号栈配平（补缺失的 } ]）+ 清理闭合符前的尾逗号 */
function repairJSONStructure(s) {
  let out = "", inStr = false;
  const stack = [];
  const emitClose = (ch) => { out = out.replace(/[,\s]+$/, ""); out += ch; };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === "\\") { out += c + (s[i + 1] || ""); i++; continue; }
      if (c === '"') inStr = false;
      out += c;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === "{" || c === "[") { stack.push(c); out += c; continue; }
    if (c === "}" || c === "]") {
      const want = c === "}" ? "{" : "[";
      while (stack.length && stack[stack.length - 1] !== want) {
        emitClose(stack.pop() === "{" ? "}" : "]");
      }
      if (stack.length) stack.pop();
      emitClose(c);
      continue;
    }
    out += c;
  }
  if (inStr) out += '"';
  while (stack.length) emitClose(stack.pop() === "{" ? "}" : "]");
  return out;
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
 "theme":"gufa 或 blueprint 或 flow",
 "sellingPoints":[{"icon":"一个emoji","title":"卖点标题（8字内）","detail":"细节说明（40字内，具体、有画面感）"}],
 "steps":[{"name":"步骤名（8字内）","note":"这一步的年份/时长/温度等关键数字标注（8字内，没有就留空字符串）","story":"这一步在做什么、为什么重要（50字内，讲给外行听）","secret":"一句行家才知道的门道（25字内）"}]
}
theme 判定：传统工艺/酒/茶/非遗/农产品→gufa；建材/机械/工业/建筑→blueprint；科技/电子/软件/新消费→flow。
要求：sellingPoints 4-6 个；steps 严格按用户给的顺序逐步展开；note 尽量从用户输入里提取真实数字（如 180 天、冬至、60℃）；语言口语化、不吹嘘、有真实感。所有字符串值内部禁止出现英文双引号和换行，引用语气请用中文引号「」。`,
      `产品名：${name}\n产品介绍：${desc}\n工艺流程（按序）：\n${steps}`,
      3000
    );
    storyData = parseJSON(text);
    storyData.name = name;
    renderStory();
    st.textContent = "✅ 生成完毕，往下看成品（可随时切换视觉主题）";
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

function renderStory() {
  window.PSScene.render($("preview"), storyData, activeTheme(), false);
}

/* 下载独立 HTML：内嵌数据 + 场景渲染代码，D3 走 CDN，双击打开动画完整 */
$("btn-download").onclick = async () => {
  if (!storyData) return;
  const [css, sceneSrc] = await Promise.all([
    fetch("style.css").then((r) => r.text()),
    fetch("scene.js").then((r) => r.text()),
  ]);
  const payload = JSON.stringify(storyData).replace(/</g, "\\u003c");
  const bodyBg = { gufa: "#f7f1e8", blueprint: "#081a30", flow: "#060b16" }[activeTheme()] || "#f7f1e8";
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(storyData.name)} · 互动讲解页</title>
<style>${css}</style>
</head>
<body style="padding:16px;max-width:760px;margin:0 auto;background:${bodyBg};">
<div id="ps-root"></div>
<script src="https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js"><\/script>
<script>${sceneSrc.replace(/<\/script>/g, "<\\/script>")}<\/script>
<script>
window.PSScene.render(document.getElementById("ps-root"), ${payload}, ${JSON.stringify(activeTheme())}, true);
<\/script>
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
