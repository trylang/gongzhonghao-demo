/* 痛点挖掘 × 素材变体工作流 — 前端逻辑 */

const $ = (id) => document.getElementById(id);

const SAMPLE_PRODUCT = "代州黄酒，古法冬酿 180 天，适合过年送长辈";
const SAMPLE_COMMENTS = `送礼盒装不错，就是快递把外盒磕坏了一个角，幸好瓶子没事
第一次喝黄酒，比想象中不甜，温过之后我爸说有小时候的味道
包装看着挺土的，送人差点意思，酒本身没毛病
问客服怎么温酒等了半天才回复
度数比超市买的低一些，我妈血压高不敢喝烈的，这个刚好
过年买了六瓶送岳父，他问我在哪买的，回购了
配料表干净，没有添加剂这点好评
物流太慢了，下单五天才到，差点误了送礼
瓶子是陶瓷的挺有质感，喝完还能插花
说明上没写要不要冰着放，夏天不知道怎么存
和朋友聚餐带了一瓶，大家都问这是什么酒，感觉有面子
价格比普通料酒贵不少，第一次买有点犹豫，喝完觉得值
希望出小瓶装，一个人喝一大瓶开了怕坏
客服说开瓶后一周内喝完，这个应该印在瓶子上
给南方朋友寄了两瓶，他们说甜度刚好，北方口感偏干`;

let painPoints = [];

$("btn-sample").onclick = () => {
  $("product").value = SAMPLE_PRODUCT;
  $("comments").value = SAMPLE_COMMENTS;
};

async function callAI(system, user, maxTokens = 1500) {
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
  // 剥掉 ```json 围栏，抓取最外层数组/对象
  let t = text.replace(/```json|```/g, "").trim();
  const a = t.indexOf("["), o = t.indexOf("{");
  const start = a >= 0 && (o < 0 || a < o) ? a : o;
  if (start < 0) throw new Error("模型未返回 JSON");
  const open = t[start], close = open === "[" ? "]" : "}";
  const end = t.lastIndexOf(close);
  const raw = end > start ? t.slice(start, end + 1) : t.slice(start);
  try { return JSON.parse(raw); } catch (_) {}
  // 修复 1：转义字符串值内部的裸换行 / 制表符 / 未转义引号
  const fixed = repairJSONStrings(raw);
  try { return JSON.parse(fixed); } catch (_) {}
  // 修复 2：括号栈配平（补缺失的 } ]）+ 清理尾逗号
  try { return JSON.parse(repairJSONStructure(fixed)); } catch (_) {}
  // 修复 3：输出被截断时，在全文上抠出所有完整对象
  const objs = extractCompleteObjects(repairJSONStrings(t.slice(start)));
  if (objs.length) return open === "[" ? objs : objs[0];
  throw new Error("AI 返回内容格式异常，请再点一次重试");
}

/* 结构级修复：括号栈配平 + 闭合符前尾逗号清理 */
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
      // 看下一个非空白字符：是 , } ] : 才算字符串真正结束，否则是内容里的引号
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

function extractCompleteObjects(s) {
  const res = [];
  let depth = 0, st = -1, inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (c === "\\") i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; continue; }
    if (c === "{") { if (depth === 0) st = i; depth++; }
    else if (c === "}") {
      depth--;
      if (depth === 0 && st >= 0) {
        try { res.push(JSON.parse(s.slice(st, i + 1))); } catch (_) {}
        st = -1;
      }
    }
  }
  return res;
}

/* ---------- 步骤一：提炼痛点 ---------- */
$("btn-extract").onclick = async () => {
  const product = $("product").value.trim();
  const comments = $("comments").value.trim();
  const st = $("status1");
  if (!product || !comments) { st.textContent = "请先填产品一句话和评论内容"; st.className = "status error"; return; }
  $("btn-extract").disabled = true;
  st.className = "status";
  st.textContent = "AI 正在读评论、提炼痛点……（约 20 秒）";
  try {
    const text = await callAI(
      `你是消费品营销洞察分析师。用户给你一批真实用户评论和产品信息。请提炼出最多 8 个真实痛点/在意点，按重要性排序。
严格输出 JSON 数组，不要输出其他内容，每项格式：
{"pain":"痛点概括（15字内）","evidence":["评论原话摘录1","评论原话摘录2"],"hook":"针对这个痛点的一句卖点话术"}
要求：evidence 必须来自评论原文（可截取）；痛点覆盖产品、包装、物流、服务、信息缺失等多维度；hook 要口语化、能直接用在文案里。所有字符串值内部禁止出现英文双引号和换行，引用语气请用中文引号「」。`,
      `产品：${product}\n\n用户评论：\n${comments}`,
      2000
    );
    painPoints = parseJSON(text);
    renderPains();
    st.textContent = `✅ 提炼出 ${painPoints.length} 个痛点`;
    $("step2").classList.remove("hidden");
    $("step2").scrollIntoView({ behavior: "smooth" });
  } catch (e) {
    st.textContent = "出错了：" + e.message;
    st.className = "status error";
  } finally {
    $("btn-extract").disabled = false;
  }
};

function renderPains() {
  $("pain-list").innerHTML = painPoints
    .map(
      (p, i) => `<div class="pain-item">
  <input type="checkbox" id="pp-${i}" ${i < 4 ? "checked" : ""} />
  <div>
    <div class="pain-title">${esc(p.pain)}</div>
    <div class="pain-evi">💬 ${(p.evidence || []).map(esc).join(" / ")}</div>
    <div class="pain-hook">✏️ ${esc(p.hook || "")}</div>
  </div>
</div>`
    )
    .join("");
}

/* ---------- 步骤二：生成 20 组素材变体 ---------- */
const ANGLE_GROUPS = [
  { key: "pain-scene", name: "痛点 + 场景切入", desc: "直击痛点、还原使用场景" },
  { key: "crowd-compare", name: "人群 + 对比切入", desc: "分人群说话、和替代品对比" },
  { key: "trust-price", name: "信任 + 价格切入", desc: "工艺背书、产地故事、值不值" },
  { key: "emotion-trend", name: "情绪 + 热点切入", desc: "乡愁、国潮、节令话题" },
];

$("btn-variants").onclick = async () => {
  const product = $("product").value.trim();
  const chosen = painPoints.filter((_, i) => $(`pp-${i}`)?.checked);
  const st = $("status2");
  if (!chosen.length) { st.textContent = "至少勾选一个痛点"; st.className = "status error"; return; }
  $("btn-variants").disabled = true;
  st.className = "status";
  st.textContent = "四个角度组并行生成中……（约 30 秒）";
  $("step3").classList.remove("hidden");
  $("variant-groups").innerHTML = ANGLE_GROUPS.map(
    (g) => `<div class="vgroup" id="vg-${g.key}">
  <div class="vgroup-head"><span>${g.name}</span><button onclick="copyGroup('${g.key}')">复制整组</button></div>
  <div class="loading">生成中……</div>
</div>`
  ).join("");
  $("step3").scrollIntoView({ behavior: "smooth" });

  const painDesc = chosen.map((p) => `${p.pain}（用户原话：${(p.evidence || [])[0] || ""}）`).join("；");
  await Promise.all(
    ANGLE_GROUPS.map(async (g) => {
      const box = document.querySelector(`#vg-${g.key} .loading`);
      try {
        const text = await callAI(
          `你是短视频/图文带货文案专家。基于产品与真实痛点，从「${g.name}」角度（${g.desc}）产出 5 组素材。
严格输出 JSON 数组，每项：{"angle":"具体角度（8字内）","title":"图文标题（22字内，带钩子）","cover":"首图/封面文案（12字内）","script":"口播脚本开头两句（口语化）"}
不要输出 JSON 以外的内容。5 组角度互不重复。所有字符串值内部禁止出现英文双引号和换行，引用语气请用中文引号「」。`,
          `产品：${product}\n真实痛点：${painDesc}`,
          1800
        );
        const items = parseJSON(text);
        box.outerHTML = items
          .map(
            (v) => `<div class="variant">
  <div class="v-title"><span class="v-label">[${esc(v.angle || "")}]</span>${esc(v.title || "")}</div>
  <div class="v-cover"><span class="v-label">首图</span>${esc(v.cover || "")}</div>
  <div class="v-script"><span class="v-label">口播</span>${esc(v.script || "")}</div>
</div>`
          )
          .join("");
        document.querySelector(`#vg-${g.key}`).dataset.raw = items
          .map((v, i) => `${i + 1}. [${v.angle}] 标题：${v.title}\n   首图：${v.cover}\n   口播：${v.script}`)
          .join("\n");
      } catch (e) {
        box.textContent = "该组生成失败：" + e.message + "（可重试）";
      }
    })
  );
  st.textContent = "✅ 生成完毕，共 4 组 × 5 条 = 20 组素材";
  $("btn-variants").disabled = false;
};

window.copyGroup = (key) => {
  const raw = document.querySelector(`#vg-${key}`)?.dataset.raw;
  if (!raw) return;
  navigator.clipboard.writeText(raw).then(() => alert("已复制整组素材"));
};

function esc(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
