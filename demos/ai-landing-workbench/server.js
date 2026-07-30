/**
 * AI 落地三镜工作台 — 代理服务器
 *
 * 第一镜（远望镜）：/api/vision   —— 多轮 vision 分析（draft / refine）
 * 第二镜（循环镜）：/api/loop     —— 把场景拆成节点 + 飞轮（draft / refine）
 * 第三镜（显微镜）：/api/replace  —— 岗位任务替代度评估（draft / refine）
 *
 * 安全：API Key 仅存在于服务端进程环境变量，前端永远看不到。
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || "3000", 10);

// 加载 .env（本地开发；部署时平台环境变量优先）
try {
  const envFile = fs.readFileSync(path.join(__dirname, ".env"), "utf8");
  for (const line of envFile.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
} catch { /* 无 .env 则跳过 */ }

const API_KEY = process.env.MINIMAX_API_KEY || "";
const MINIMAX_URL = "https://api.minimaxi.com/anthropic/v1/messages";
const MODEL = "MiniMax-Text-01";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function serveStatic(res, filePath) {
  const fullPath = path.join(__dirname, filePath);
  if (!fullPath.startsWith(__dirname)) { res.writeHead(403); res.end("Forbidden"); return; }
  if (!fs.existsSync(fullPath)) { res.writeHead(404); res.end("Not Found"); return; }
  const ext = path.extname(fullPath).toLowerCase();
  const contentType = MIME[ext] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "public, max-age=3600" });
  fs.createReadStream(fullPath).pipe(res);
}

// ============ 第一镜：Vision ============
const VISION_SYSTEM_DRAFT = `你是一位资深的中小企业 AI 落地顾问，正在运营一个名为「AI 落地三镜工作台」的工具的第一镜（远望镜）。
你的理论底色来自 Alexandr Wang 的观点：我们现在处在"一次文明级的机会"（once-in-a-civilization opportunity）窗口，稀缺的不再是聪明本身，而是"看到机会的 vision"以及"把 AI 能力扩散进真实业务、并形成反馈飞轮"的能力。

任务：根据一位传统行业 / 中小企业老板填写的 7 个引导问题，帮他看清属于自己的 AI 机会。

严格要求：
1. 只输出一个 JSON 对象，不要任何解释性文字、不要代码围栏。
2. JSON 结构：
{
  "visionStatement": "一句话 vision 定位语，要能对外讲、有画面感",
  "opportunities": [
    { "title":"场景名", "leverage":"高/中/低", "difficulty":"高/中/低", "flywheel":"能否形成数据飞轮及机制说明", "why":"为什么这是高杠杆机会，写 2-3 句具体原因，结合用户的行业与资源" }
  ],
  "clarifyingQuestions": [ "针对信息缺口提出的 2-3 个澄清问题，要具体、用户答得上" ],
  "nextStepHint": "建议下一步进入循环镜时优先选哪个场景，以及一句理由"
}
3. opportunities 恰好 3 个，按杠杆从高到低排序；必须紧扣用户填写的生意类型、资源与痛点，禁止泛泛而谈（如"用 AI 提效"）。每个 why 必须点名用户的具体资源或痛点。
4. clarifyingQuestions 要指向能显著提升建议精度的缺口（如渠道结构、复购率、团队规模、现有工具）。
5. 语言口语、贴地，像在跟一位不懂技术的老板说话。`;

const VISION_SYSTEM_REFINE = `你是一位资深的中小企业 AI 落地顾问，正在运营「AI 落地三镜工作台」第一镜（远望镜）。
用户已收到你的草稿，并补充了澄清回答。请基于原始信息与补充回答，输出定稿的《AI 落地作战图》JSON。

只输出一个 JSON 对象，不要解释、不要代码围栏：
{
  "visionStatement": "修订后的一句话 vision 定位语",
  "opportunities": [
    { "title":"场景名", "leverage":"高/中/低", "difficulty":"高/中/低", "flywheel":"飞轮机制", "why":"为什么，2-3 句，结合补充信息更精准", "firstMove":"这个场景的第一步具体动作（下周一就能做的一件事）" }
  ],
  "battleMap": "一段详尽的行动建议，分短期(1-2周)/中期(1-3月)/长期(3-6月)三段，每段列 2-3 条可执行动作，要具体到工具和节奏",
  "metrics": "建议追踪的 3-5 个指标及为什么",
  "nextStepHint": "进入循环镜时建议优先选哪个场景，给出一句理由"
}
要求：battleMap 必须详尽、可执行、不轻点水；所有建议要呼应用户补充的信息；语言口语、贴地。`;

// ============ 第二镜：Loop ============
const LOOP_SYSTEM_DRAFT = `你是一位资深的中小企业 AI 落地顾问，正在运营「AI 落地三镜工作台」第二镜（循环镜 / Loop Designer）。
理论底色：Alexandr Wang 认为稀缺的不是聪明，而是"把 AI 能力扩散进真实业务、并形成反馈飞轮"的能力。
任务：用户已经在第一镜确定了一个高杠杆场景。现在帮他/她把这个场景拆成一条业务循环，给每个节点标上 AI 该扮演的角色，并画出数据飞轮。

只输出一个 JSON 对象，不要解释、不要代码围栏：
{
  "scenario": "场景名（沿用用户填的）",
  "nodes": [
    { "name":"节点名", "role":"人做/AI辅助/AI全自动/暂不动", "why":"为什么标这个角色，1-2句，结合用户生意", "input":"这个节点的输入/触发", "output":"这个节点的产出", "toolHint":"建议用的工具或实现方式（具体，如企业微信+Coze/飞书多维表格+API/Retool）" }
  ],
  "loops": [ "飞轮描述：哪个节点的产出回流成下一轮的输入，形成自我增强，写具体", ... ],
  "mvp": { "firstNodes":["节点A","节点B"], "rationale":"为什么先上这两个（见效快/数据先跑通）", "quickWin":"下周一就能做的具体第一步" },
  "clarifyingQuestions": [ "2-3 个针对信息缺口的问题，具体可答" ],
  "nextStepHint":"建议进入显微镜时优先看哪个岗位，一句话理由"
}
要求：
1. nodes 必须覆盖用户给出的完整流程（不要漏节点，不足可补全但标注）；role 分布要诚实（不要全标AI全自动，要把高风险/低杠杆的标"暂不动"或"人做"）。
2. loops 至少 1 条，要具体说明数据怎么回流、回流后怎么让下一轮更聪明。
3. mvp.firstNodes 恰好 2 个，选见效最快、数据最先能跑通的。
4. toolHint 要具体到工具名/平台，不要只说"用AI"。
5. 语言口语、贴地。`;

const LOOP_SYSTEM_REFINE = `你是一位资深中小企业 AI 落地顾问，运营第二镜（循环镜）。用户已收到草稿并补充了澄清回答。请输出定稿。
只输出 JSON，不要解释/代码围栏：
{
  "scenario":"...",
  "nodes":[ { "name":"...", "role":"人做/AI辅助/AI全自动/暂不动", "why":"...", "input":"...", "output":"...", "toolHint":"..." } ],
  "loops":[ "..." ],
  "mvp":{ "firstNodes":["...","..."], "rationale":"...", "firstMove":"这个场景第一步具体动作（下周一就能做）" },
  "battleMap":"详尽落地作战图，分 短期(1-2周)/中期(1-3月)/长期(3-6月) 三段，每段 2-3 条可执行动作，具体到工具和节奏，不轻点水",
  "metrics":"建议追踪的 3-5 个指标及为什么",
  "nextStepHint":"进入显微镜建议看哪个岗位"
}
要求：battleMap 详尽、可执行、呼应补充信息。`;

// ============ 第三镜：Replace ============
const REPLACE_SYSTEM_DRAFT = `你是一位资深中小企业 AI 落地顾问，运营第三镜（显微镜 / Replacement Calculator）。
任务：用户选了一个岗位，列出日常任务清单。请评估每个任务能被 AI agent 替代的程度，并给出量化与落地信息。

只输出一个 JSON 对象，不要解释、不要代码围栏：
{
  "role":"岗位名",
  "tasks":[
    { "name":"任务名", "replaceable":"高/中/低", "reason":"为什么这个替代度，1-2句", "evalMetric":"怎么判断 AI 做对了（评测指标/人工抽检方式）", "risk":"风险点/为什么不能全自动/需要人兜底的地方", "hoursSaved": 数字(该任务每月可省工时，合理估算) }
  ],
  "summary":{
    "totalHoursSaved": 数字,
    "replacedRatio":"估算百分比，如 55%",
    "agentCostPerMonth":"搭这套 agent 的月成本估算（含 token/工具订阅），给区间如 '600-1200 元'",
    "humanCostPerMonth":"该岗位当前月成本（人/外包），若用户没给就基于行业给估算并标注'估'",
    "conclusion":"一句话结论：先上哪几个 agent、省多少人力/钱、什么情况下比招人划算"
  },
  "clarifyingQuestions":[ "2-3 个澄清问题，如任务细节/现有工具/质量红线/可否接 API" ],
  "nextStepHint":"..."
}
要求：
1. tasks 覆盖用户给出的每个任务，不要漏。
2. replaceable 高=可基本全自动、中=需人辅助、低=短期不建议动。
3. hoursSaved 给合理数字（基于常见经验），总和为 totalHoursSaved。
4. 结论要落到"招人 vs 搭 agent"的边界：什么情况下搭 agent 更划算、什么情况还得招人。
5. 语言口语、贴地。`;

const REPLACE_SYSTEM_REFINE = `你是一位资深中小企业 AI 落地顾问，运营第三镜（显微镜）。用户已补充澄清。请输出定稿。
只输出 JSON，不要解释/代码围栏：
{
  "role":"...",
  "tasks":[ { "name":"...", "replaceable":"高/中/低", "reason":"...", "evalMetric":"...", "risk":"...", "hoursSaved": 数字 } ],
  "summary":{ "totalHoursSaved":数字, "replacedRatio":"...", "agentCostPerMonth":"...", "humanCostPerMonth":"...", "conclusion":"..." },
  "battleMap":"详尽落地作战图，短期/中期/长期三段，具体到先上哪几个 agent、用什么工具、怎么度量、怎么接飞轮",
  "checklist":[ "落地清单 1", "落地清单 2", ... ],
  "metrics":"..."
}
要求：battleMap 与 checklist 详尽、可执行、呼应补充信息；不要轻点水。`;

// ---------- 通用工具 ----------
function formatInput(input) {
  const lines = [];
  lines.push(`生意类型：${input.businessType || "（未填）"}${input.businessDesc ? " —— " + input.businessDesc : ""}`);
  lines.push(`最头疼的环节：${(input.painPoints || []).join("、") || "（未填）"}`);
  lines.push(`闲置资源：${(input.resources || []).join("、") || "（未填）"}`);
  lines.push(`3 年后想变成：${(input.futureGoals || []).join("、") || "（未填）"}${input.futureText ? " —— " + input.futureText : ""}`);
  lines.push(`每月愿投：${input.monthlyBudget || "（未填）"}`);
  lines.push(`最不放心 AI 碰：${(input.avoidAI || []).join("、") || "（未填）"}`);
  lines.push(`成功指标：${(input.successMetrics || []).join("、") || "（未填）"}`);
  if (input.freeText) lines.push(`补充描述：${input.freeText}`);
  return lines.join("\n");
}

function formatClarifications(clar) {
  if (!clar) return "（无）";
  if (typeof clar === "string") return clar;
  return Object.entries(clar).map(([k, v]) => `${k}：${v}`).join("\n");
}

function formatNodes(nodes) {
  if (!Array.isArray(nodes) || !nodes.length) return "（用户未结构化拆解）";
  return nodes.map((n, i) => `${i + 1}. ${n.name || "?"} ｜现在：${n.owner || "未填"}｜日量：${n.daily || "未填"}｜卡点：${n.pain || "未填"}`).join("\n");
}

function formatTasks(tasks) {
  if (!Array.isArray(tasks) || !tasks.length) return "（用户未列出任务）";
  return tasks.map((t, i) => `${i + 1}. ${t.name || "?"} ｜当前月工时：${t.hours || "未填"}`).join("\n");
}

function buildVisionBody(stage, input, history) {
  if (stage === "refine") {
    const user = `【用户第一镜信息】\n${formatInput(input)}\n\n【上一轮草稿】\n${JSON.stringify(history || {})}\n\n【用户补充的澄清回答】\n${formatClarifications(input.clarifications)}\n\n请基于以上输出定稿作战图 JSON。`;
    return { system: VISION_SYSTEM_REFINE, messages: [{ role: "user", content: user }] };
  }
  const user = `【用户第一镜信息】\n${formatInput(input)}\n\n请输出草稿 JSON（含 clarifyingQuestions）。`;
  return { system: VISION_SYSTEM_DRAFT, messages: [{ role: "user", content: user }] };
}

function buildLoopBody(stage, input, history) {
  const ctx = input.businessType ? `【背景生意】${input.businessType}\n` : "";
  if (stage === "refine") {
    const user = `${ctx}【用户第二镜输入】\n场景：${input.scenario || "（未填）"}\n当前流程拆解：\n${formatNodes(input.nodes)}\n\n【上一轮草稿】\n${JSON.stringify(history || {})}\n\n【用户补充的澄清回答】\n${formatClarifications(input.clarifications)}\n\n请输出定稿 JSON。`;
    return { system: LOOP_SYSTEM_REFINE, messages: [{ role: "user", content: user }] };
  }
  const user = `${ctx}【用户第二镜输入】\n场景：${input.scenario || "（未填）"}\n当前流程拆解：\n${formatNodes(input.nodes)}\n\n请输出草稿 JSON（含 clarifyingQuestions）。`;
  return { system: LOOP_SYSTEM_DRAFT, messages: [{ role: "user", content: user }] };
}

function buildReplaceBody(stage, input, history) {
  const ctx = input.businessType ? `【背景生意】${input.businessType}\n` : "";
  const costLine = input.roleCost ? `该岗位当前月成本：${input.roleCost}\n` : "";
  if (stage === "refine") {
    const user = `${ctx}${costLine}【用户第三镜输入】\n岗位：${input.role || "（未填）"}\n日常任务：\n${formatTasks(input.tasks)}\n\n【上一轮草稿】\n${JSON.stringify(history || {})}\n\n【用户补充的澄清回答】\n${formatClarifications(input.clarifications)}\n\n请输出定稿 JSON。`;
    return { system: REPLACE_SYSTEM_REFINE, messages: [{ role: "user", content: user }] };
  }
  const user = `${ctx}${costLine}【用户第三镜输入】\n岗位：${input.role || "（未填）"}\n日常任务：\n${formatTasks(input.tasks)}\n\n请输出草稿 JSON（含 clarifyingQuestions）。`;
  return { system: REPLACE_SYSTEM_DRAFT, messages: [{ role: "user", content: user }] };
}

function parseJSON(text) {
  if (!text) return null;
  let t = text.trim();
  t = t.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const s = t.indexOf("{");
  const e = t.lastIndexOf("}");
  if (s === -1 || e === -1) return null;
  try { return JSON.parse(t.slice(s, e + 1)); } catch { return null; }
}

async function callMiniMax(system, messages, maxTokens) {
  const body = JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages });
  const resp = await fetch(MINIMAX_URL, {
    method: "POST",
    headers: { Authorization: "Bearer " + API_KEY, "Content-Type": "application/json", "anthropic-version": "2023-06-01" },
    body,
    signal: AbortSignal.timeout(90000),
  });
  const data = await resp.json();
  if (!resp.ok) {
    const msg = data?.error?.message || data?.base_resp?.status_msg || `MiniMax HTTP ${resp.status}`;
    throw new Error(msg);
  }
  return (data.content || []).map((c) => c.text || "").join("");
}

function readBody(req) {
  return new Promise((r) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => r(d)); });
}

async function handleVision(req, res) {
  if (req.method !== "POST") { res.writeHead(405); res.end(JSON.stringify({ error: "Method not allowed" })); return; }
  let parsed;
  try { parsed = JSON.parse(await readBody(req)); } catch { res.writeHead(400); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
  const { stage, input, history } = parsed;
  if (!stage || !input || typeof input !== "object") { res.writeHead(400); res.end(JSON.stringify({ error: "Missing stage or input" })); return; }
  if (!API_KEY) { res.writeHead(500); res.end(JSON.stringify({ error: "Server not configured: MINIMAX_API_KEY missing." })); return; }
  try {
    const { system, messages } = buildVisionBody(stage, input, history);
    const raw = await callMiniMax(system, messages, stage === "refine" ? 2000 : 1500);
    const result = parseJSON(raw);
    if (!result) { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ raw, parseError: true })); return; }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ result, raw: null }));
  } catch (err) {
    console.error("Vision error:", err.message);
    res.writeHead(502); res.end(JSON.stringify({ error: "Upstream failed: " + err.message }));
  }
}

async function handleLoop(req, res) {
  if (req.method !== "POST") { res.writeHead(405); res.end(JSON.stringify({ error: "Method not allowed" })); return; }
  let parsed;
  try { parsed = JSON.parse(await readBody(req)); } catch { res.writeHead(400); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
  const { stage, input, history } = parsed;
  if (!stage || !input || typeof input !== "object") { res.writeHead(400); res.end(JSON.stringify({ error: "Missing stage or input" })); return; }
  if (!API_KEY) { res.writeHead(500); res.end(JSON.stringify({ error: "Server not configured: MINIMAX_API_KEY missing." })); return; }
  try {
    const { system, messages } = buildLoopBody(stage, input, history);
    const raw = await callMiniMax(system, messages, stage === "refine" ? 2200 : 1700);
    const result = parseJSON(raw);
    if (!result) { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ raw, parseError: true })); return; }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ result, raw: null }));
  } catch (err) {
    console.error("Loop error:", err.message);
    res.writeHead(502); res.end(JSON.stringify({ error: "Upstream failed: " + err.message }));
  }
}

async function handleReplace(req, res) {
  if (req.method !== "POST") { res.writeHead(405); res.end(JSON.stringify({ error: "Method not allowed" })); return; }
  let parsed;
  try { parsed = JSON.parse(await readBody(req)); } catch { res.writeHead(400); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
  const { stage, input, history } = parsed;
  if (!stage || !input || typeof input !== "object") { res.writeHead(400); res.end(JSON.stringify({ error: "Missing stage or input" })); return; }
  if (!API_KEY) { res.writeHead(500); res.end(JSON.stringify({ error: "Server not configured: MINIMAX_API_KEY missing." })); return; }
  try {
    const { system, messages } = buildReplaceBody(stage, input, history);
    const raw = await callMiniMax(system, messages, stage === "refine" ? 2200 : 1700);
    const result = parseJSON(raw);
    if (!result) { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ raw, parseError: true })); return; }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ result, raw: null }));
  } catch (err) {
    console.error("Replace error:", err.message);
    res.writeHead(502); res.end(JSON.stringify({ error: "Upstream failed: " + err.message }));
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  if (url.pathname === "/api/vision") return handleVision(req, res);
  if (url.pathname === "/api/loop") return handleLoop(req, res);
  if (url.pathname === "/api/replace") return handleReplace(req, res);

  let filePath = url.pathname === "/" ? "/index.html" : url.pathname;
  serveStatic(res, filePath);
});

server.listen(PORT, () => {
  console.log(`\n  🚀 AI 落地三镜工作台  (三镜已全部上线)`);
  console.log(`  Local:  http://localhost:${PORT}`);
  console.log(`  Key:    ${API_KEY ? "✅ 已配置" : "❌ 未配置"}\n`);
});
