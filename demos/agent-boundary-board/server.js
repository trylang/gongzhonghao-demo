/**
 * 商业 Agent 边界画板 — 代理服务器
 *
 * 前端把三个区域（自动执行/需人工审批/绝对禁止）的卡片配置发到 /api/generate，
 * 服务端调 MiniMax 生成四段式《Agent 权限边界文档》。
 * API Key 只存在服务端环境变量，前端永远看不到。
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || "3000", 10);

// 加载 .env（本地开发用；部署时平台环境变量优先）
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
} catch { /* 没有 .env 则跳过 */ }

const API_KEY = process.env.MINIMAX_API_KEY || "";
const MINIMAX_URL = "https://api.minimaxi.com/anthropic/v1/messages";
const MODEL = "MiniMax-Text-01";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function serveStatic(res, filePath) {
  const fullPath = path.join(__dirname, filePath);
  if (!fullPath.startsWith(__dirname)) { res.writeHead(403); res.end("Forbidden"); return; }
  if (!fs.existsSync(fullPath)) { res.writeHead(404); res.end("Not Found"); return; }
  const ext = path.extname(fullPath).toLowerCase();
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": "public, max-age=3600" });
  fs.createReadStream(fullPath).pipe(res);
}

function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new Error("body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const SYSTEM_PROMPT = `你是一位帮传统企业落地 AI Agent 的顾问。用户会给你三组商业动作清单：
- auto：允许 Agent 自动执行的动作（可能附带条件，如金额上限）
- review：必须人工审批后才能执行的动作
- forbidden：绝对禁止 Agent 触碰的动作

请输出一份可直接落地的《Agent 权限边界文档》，用 Markdown，必须包含以下四段（标题固定）：

## 一、授权清单
逐条列出允许自动执行的动作，每条写清楚：动作名、附加条件（若有）、建议的日志留痕方式。

## 二、审批流程
针对"需人工审批"的每个动作，给出：谁来审（建议角色）、审批时限建议、超时默认策略（默认拒绝）。写成可以直接贴进员工手册的格式。

## 三、红线条款
针对"绝对禁止"的动作，写成制度条款语气（如"任何情况下，系统不得……"），并为每条附一句"为什么"（一句话说明风险）。

## 四、Agent 系统提示词片段
输出一段可以直接复制粘贴进 AI Agent system prompt 的中文约束文本（用代码块包裹），把上面三部分翻译成对 AI 说的硬性规则。语气直接、无歧义、可执行。

要求：
- 结合用户给的行业背景写，不要泛泛而谈
- 条款务实、可执行，避免"加强管理""提高意识"这类空话
- 禁止使用 Markdown 表格，全部用无序/有序列表表达
- 全文控制在 900 字以内`;

async function handleGenerate(req, res) {
  if (req.method !== "POST") { res.writeHead(405, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Method not allowed" })); return; }
  if (!API_KEY) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "服务端未配置 API Key" })); return; }
  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "请求体不是合法 JSON" })); return; }

  const { industry = "", zones = {} } = payload || {};
  const auto = Array.isArray(zones.auto) ? zones.auto.slice(0, 30) : [];
  const review = Array.isArray(zones.review) ? zones.review.slice(0, 30) : [];
  const forbidden = Array.isArray(zones.forbidden) ? zones.forbidden.slice(0, 30) : [];
  if (auto.length + review.length + forbidden.length === 0) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "请先把至少一张动作卡放进任一区域" }));
    return;
  }

  const fmt = (arr) => arr.length
    ? arr.map((c) => `- ${String(c.name || "").slice(0, 50)}${c.condition ? `（条件：${String(c.condition).slice(0, 100)}）` : ""}`).join("\n")
    : "（无）";

  const userMsg = `行业背景：${String(industry).slice(0, 100) || "通用中小企业"}

【允许自动执行】
${fmt(auto)}

【需人工审批】
${fmt(review)}

【绝对禁止】
${fmt(forbidden)}

请按格式输出《Agent 权限边界文档》。`;

  try {
    const upstream = await fetch(MINIMAX_URL, {
      method: "POST",
      headers: { "Authorization": `Bearer ${API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1800,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMsg }],
      }),
    });
    const data = await upstream.json();
    const text = (data && data.content && data.content[0] && data.content[0].text) || "";
    if (!text) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "AI 返回为空，请重试", detail: JSON.stringify(data).slice(0, 300) }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ markdown: text }));
  } catch (e) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "调用 AI 服务失败：" + e.message }));
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/api/generate") { handleGenerate(req, res); return; }
  if (url.pathname === "/healthz") { res.writeHead(200); res.end("ok"); return; }
  let file = url.pathname === "/" ? "/index.html" : url.pathname;
  serveStatic(res, file.replace(/^\/+/, ""));
});

server.listen(PORT, () => console.log(`[agent-boundary-board] listening on :${PORT}`));
