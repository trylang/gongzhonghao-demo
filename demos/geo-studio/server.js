/**
 * GEO Studio — 公众号配套小工具
 *   Tab 1 · GEO 内容优化器（调 MiniMax 改写，更易被 AI 搜索引用）
 *   Tab 2 · 搜索流量依赖自检表（纯前端诊断，免 Key）
 *
 * 用法：
 *   1. 复制 .env.example 为 .env，填入你的 MINIMAX_API_KEY
 *   2. node server.js          → 本地运行，默认端口 3000
 *   3. PORT=8080 node server.js → 指定端口
 *
 * 部署（Render / Railway / Vercel 等）：
 *   - 设置环境变量 MINIMAX_API_KEY=sk-...
 *   - 启动命令：node server.js
 *
 * 安全：API Key 仅存在于服务端进程环境变量，前端永远看不到。
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || "3000", 10);

// 加载 .env 文件（本地开发用；部署时平台环境变量优先）
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
} catch { /* 没有 .env 文件则跳过 */ }

const API_KEY = process.env.MINIMAX_API_KEY || "";
const MINIMAX_URL = "https://api.minimaxi.com/anthropic/v1/messages";
const MODEL = "MiniMax-Text-01";

// ---- MIME 类型映射 ----
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

// ---- 静态文件服务 ----
function serveStatic(res, filePath) {
  const fullPath = path.join(__dirname, filePath);
  if (!fullPath.startsWith(__dirname)) {
    res.writeHead(403); res.end("Forbidden"); return;
  }
  if (!fs.existsSync(fullPath)) {
    res.writeHead(404); res.end("Not Found"); return;
  }
  const ext = path.extname(fullPath).toLowerCase();
  const contentType = MIME[ext] || "application/octet-stream";
  const stat = fs.statSync(fullPath);
  res.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=3600",
  });
  fs.createReadStream(fullPath).pipe(res);
}

// ---- MiniMax 代理（GEO 改写） ----
async function handleOptimize(req, res) {
  if (req.method !== "POST") {
    res.writeHead(405); res.end(JSON.stringify({ error: "Method not allowed" })); return;
  }

  const body = await new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    res.writeHead(400); res.end(JSON.stringify({ error: "Invalid JSON" })); return;
  }

  if (!parsed.system || !parsed.messages || !Array.isArray(parsed.messages)) {
    res.writeHead(400); res.end(JSON.stringify({ error: "Missing system or messages" })); return;
  }

  if (!API_KEY) {
    res.writeHead(500);
    res.end(JSON.stringify({
      error: "Server not configured: MINIMAX_API_KEY environment variable is missing.",
      hint: "Set it in .env file or platform environment variables.",
    }));
    return;
  }

  try {
    const miniMaxBody = JSON.stringify({
      model: MODEL,
      max_tokens: Math.min(parsed.max_tokens || 1200, 2000),
      system: parsed.system,
      messages: parsed.messages,
    });

    const apiResp = await fetch(MINIMAX_URL, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + API_KEY,
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
      },
      body: miniMaxBody,
      signal: AbortSignal.timeout(60000),
    });

    const apiData = await apiResp.json();

    if (!apiResp.ok) {
      const errMsg =
        apiData?.error?.message ||
        apiData?.base_resp?.status_msg ||
        `MiniMax HTTP ${apiResp.status}`;
      res.writeHead(apiResp.status >= 400 ? apiResp.status : 502);
      res.end(JSON.stringify({ error: errMsg }));
      return;
    }

    const text = (apiData.content || []).map((c) => c.text || "").join("");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ text, usage: apiData.usage || null }));
  } catch (err) {
    console.error("Proxy error:", err.message);
    res.writeHead(502);
    res.end(JSON.stringify({ error: "Upstream request failed: " + err.message }));
  }
}

// ---- 主服务器 ----
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204); res.end(); return;
  }

  if (url.pathname === "/api/optimize") {
    return handleOptimize(req, res);
  }

  let filePath = url.pathname === "/" ? "/index.html" : url.pathname;
  serveStatic(res, filePath);
});

server.listen(PORT, () => {
  console.log(`\n  🔎 GEO Studio（GEO 内容优化器 + 搜索流量依赖自检表）`);
  console.log(`  ───────────────────────────────────────────────`);
  console.log(`  Local:  http://localhost:${PORT}`);
  console.log(`  API Key: ${API_KEY ? "✅ 已配置" : "❌ 未配置（请在 .env 中设置 MINIMAX_API_KEY）"}\n`);
});
