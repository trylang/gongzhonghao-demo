/**
 * AI 落地三镜工作台 — 代理服务器
 *
 * 第一镜（远望镜）：/api/vision  —— 多轮 vision 分析（draft / refine）
 * 通用代理：        /api/generate —— 透传 MiniMax（后续第二、三镜复用）
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

// ---------- 第一镜：Vision 顾问提示词 ----------
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

function buildVisionBody(stage, input, history) {
  if (stage === "refine") {
    const user = `【用户第一镜信息】\n${formatInput(input)}\n\n【上一轮草稿】\n${JSON.stringify(history || {})}\n\n【用户补充的澄清回答】\n${formatClarifications(input.clarifications)}\n\n请基于以上输出定稿作战图 JSON。`;
    return { system: VISION_SYSTEM_REFINE, messages: [{ role: "user", content: user }] };
  }
  const user = `【用户第一镜信息】\n${formatInput(input)}\n\n请输出草稿 JSON（含 clarifyingQuestions）。`;
  return { system: VISION_SYSTEM_DRAFT, messages: [{ role: "user", content: user }] };
}

function parseJSON(text) {
  if (!text) return null;
  let t = text.trim();
  // 去掉可能的代码围栏
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

async function handleVision(req, res) {
  if (req.method !== "POST") { res.writeHead(405); res.end(JSON.stringify({ error: "Method not allowed" })); return; }
  const body = await new Promise((r) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => r(d)); });
  let parsed;
  try { parsed = JSON.parse(body); } catch { res.writeHead(400); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
  const { stage, input, history } = parsed;
  if (!stage || !input || typeof input !== "object") {
    res.writeHead(400); res.end(JSON.stringify({ error: "Missing stage or input" })); return;
  }
  if (!API_KEY) {
    res.writeHead(500); res.end(JSON.stringify({ error: "Server not configured: MINIMAX_API_KEY missing." })); return;
  }
  try {
    const { system, messages } = buildVisionBody(stage, input, history);
    const raw = await callMiniMax(system, messages, stage === "refine" ? 2000 : 1500);
    const result = parseJSON(raw);
    if (!result) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ raw, parseError: true }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ result, raw: null }));
  } catch (err) {
    console.error("Vision error:", err.message);
    res.writeHead(502); res.end(JSON.stringify({ error: "Upstream failed: " + err.message }));
  }
}

// ---------- 通用代理（第二、三镜复用） ----------
async function handleGenerate(req, res) {
  if (req.method !== "POST") { res.writeHead(405); res.end(JSON.stringify({ error: "Method not allowed" })); return; }
  const body = await new Promise((r) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => r(d)); });
  let parsed;
  try { parsed = JSON.parse(body); } catch { res.writeHead(400); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
  if (!parsed.system || !parsed.messages || !Array.isArray(parsed.messages)) {
    res.writeHead(400); res.end(JSON.stringify({ error: "Missing system or messages" })); return;
  }
  if (!API_KEY) {
    res.writeHead(500); res.end(JSON.stringify({ error: "Server not configured: MINIMAX_API_KEY missing." })); return;
  }
  try {
    const miniMaxBody = JSON.stringify({ model: MODEL, max_tokens: Math.min(parsed.max_tokens || 1200, 2000), system: parsed.system, messages: parsed.messages });
    const apiResp = await fetch(MINIMAX_URL, { method: "POST", headers: { Authorization: "Bearer " + API_KEY, "Content-Type": "application/json", "anthropic-version": "2023-06-01" }, body: miniMaxBody, signal: AbortSignal.timeout(90000) });
    const apiData = await apiResp.json();
    if (!apiResp.ok) { const m = apiData?.error?.message || apiData?.base_resp?.status_msg || `MiniMax HTTP ${apiResp.status}`; res.writeHead(apiResp.status >= 400 ? apiResp.status : 502); res.end(JSON.stringify({ error: m })); return; }
    const text = (apiData.content || []).map((c) => c.text || "").join("");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ text, usage: apiData.usage || null }));
  } catch (err) {
    console.error("Proxy error:", err.message);
    res.writeHead(502); res.end(JSON.stringify({ error: "Upstream request failed: " + err.message }));
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  if (url.pathname === "/api/vision") return handleVision(req, res);
  if (url.pathname === "/api/generate") return handleGenerate(req, res);

  let filePath = url.pathname === "/" ? "/index.html" : url.pathname;
  serveStatic(res, filePath);
});

server.listen(PORT, () => {
  console.log(`\n  🚀 AI 落地三镜工作台  (第一镜已上线)`);
  console.log(`  Local:  http://localhost:${PORT}`);
  console.log(`  Key:    ${API_KEY ? "✅ 已配置" : "❌ 未配置"}\n`);
});
