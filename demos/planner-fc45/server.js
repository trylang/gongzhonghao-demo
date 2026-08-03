// 通用「大模型驱动」后端（脚手架）。
//
// 设计约定（与 run-pipeline.mjs 的 generateBackendDemo 对齐）：
//   前端是 LLM 生成的 bespoke index.html（自带交互 + 内联 <style>/<script>），
//   本服务只做三件事：
//     1) 托管静态文件（index.html 等，render.yaml healthCheckPath: / 会命中它 → 200）
//     2) /healthz —— 兜底健康检查
//     3) /api/generate —— 接收前端 POST 的任意 JSON（约定 { "inputs": {...} }），
//        用服务端持有的密钥调用 MiniMax，把 ./system_prompt.txt 作为 system 指令，
//        返回 { "result": "模型输出文本" }。前端自行解析渲染（对象或字符串皆可）。
//
// 安全铁律：API Key 只在服务端环境变量，前端永远拿不到。
// 零依赖：只用 Node 内置模块，避免 Render 上 npm install 抖动。

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.MINIMAX_PORT || process.env.PORT || "3000", 10);

// 加载 .env（本地开发；Render 部署时平台环境变量优先）
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
const MINIMAX_URL = process.env.MINIMAX_TEXT_URL || "https://api.minimaxi.com/anthropic/v1/messages";
const MODEL = process.env.MINIMAX_MODEL || "MiniMax-Text-01";

const SYSTEM_PROMPT = fs.existsSync(path.join(__dirname, "system_prompt.txt"))
  ? fs.readFileSync(path.join(__dirname, "system_prompt.txt"), "utf8")
  : "你是一个有帮助的助手，根据用户输入给出简洁有用的回答。";

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

// 把前端传入的 inputs 对象拼成自然语言（key：value 每行一条）
function formatInputs(inputs) {
  if (!inputs || typeof inputs !== "object") return "";
  const lines = [];
  for (const [k, v] of Object.entries(inputs)) {
    if (k === "system") continue;
    const val = Array.isArray(v) ? v.filter(Boolean).join("、") : (v == null ? "" : String(v));
    if (val) lines.push(`${k}：${val}`);
  }
  return lines.join("\n");
}

// 兼容多种前端调用约定：{ inputs } / { prompt } / { user } / 整包 JSON
function buildUserText(body) {
  if (!body || typeof body !== "object") return "";
  if (typeof body.prompt === "string" && body.prompt.trim()) return body.prompt.trim();
  if (typeof body.user === "string" && body.user.trim()) return body.user.trim();
  if (body.inputs && typeof body.inputs === "object") {
    const t = formatInputs(body.inputs);
    if (t) return t;
  }
  try { return JSON.stringify(body); } catch { return String(body); }
}

// 尽力从模型输出里抠出 JSON（容忍 ```json 围栏 / 前后多余文字）；失败返回 null
function parseJSON(text) {
  if (!text) return null;
  let t = text.trim();
  t = t.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const s = t.indexOf("{");
  const e = t.lastIndexOf("}");
  if (s === -1 || e === -1) return null;
  try { return JSON.parse(t.slice(s, e + 1)); } catch { return null; }
}

async function callMiniMax(system, userText, maxTokens) {
  const body = JSON.stringify({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: userText }],
  });
  const resp = await fetch(MINIMAX_URL, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + API_KEY,
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
    },
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
  return new Promise((resolve) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => resolve(d));
  });
}

function sendJson(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

async function handleGenerate(req, res) {
  if (req.method !== "POST") { sendJson(res, 405, { error: "Method not allowed" }); return; }
  let parsed;
  try { parsed = JSON.parse(await readBody(req)); }
  catch { sendJson(res, 400, { error: "Invalid JSON" }); return; }
  const userText = buildUserText(parsed);
  if (!userText.trim()) { sendJson(res, 400, { error: "缺少输入（inputs / prompt / user 至少其一）" }); return; }
  if (!API_KEY) { sendJson(res, 500, { error: "服务端未配置 MINIMAX_API_KEY" }); return; }
  try {
    const raw = await callMiniMax(SYSTEM_PROMPT, userText, 2000);
    const result = parseJSON(raw);
    if (!result) {
      // 模型未返回标准 JSON：把原文作为 result 回传，前端可自行展示或解析
      sendJson(res, 200, { result: raw, parseError: true });
      return;
    }
    sendJson(res, 200, { result, raw: null });
  } catch (err) {
    console.error("generate error:", err.message);
    sendJson(res, 502, { error: "上游调用失败：" + err.message });
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  if (url.pathname === "/api/generate") return handleGenerate(req, res);
  if (url.pathname === "/healthz") { res.writeHead(200); res.end("ok"); return; }

  // 静态文件（/ 命中 index.html → Render healthCheckPath: / 返回 200）
  const filePath = url.pathname === "/" ? "/index.html" : url.pathname;
  serveStatic(res, filePath);
});

server.listen(PORT, () => {
  console.log(`\n  🚀 demo 服务已启动`);
  console.log(`  Local:  http://localhost:${PORT}`);
  console.log(`  Key:    ${API_KEY ? "✅ 已配置" : "❌ 未配置"}\n`);
});
