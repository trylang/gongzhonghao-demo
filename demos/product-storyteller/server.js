/**
 * 产品会说话 — 互动讲解页生成器 — 代理服务器
 *
 * 本地运行：
 *   1. 复制 .env.example 为 .env，填入 MINIMAX_API_KEY
 *   2. node server.js（默认端口 3000）
 *
 * 部署（Render）：
 *   - 环境变量 MINIMAX_API_KEY=sk-...
 *   - 启动命令 node server.js（PORT 由平台注入）
 *
 * 安全：Key 仅在服务端，前端只调同源 /api/generate。
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || "3000", 10);

try {
  const envFile = fs.readFileSync(path.join(__dirname, ".env"), "utf8");
  for (const line of envFile.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i <= 0) continue;
    if (!process.env[t.slice(0, i).trim()]) process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
} catch { /* no .env */ }

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

async function handleGenerate(req, res) {
  if (req.method !== "POST") { res.writeHead(405); res.end(JSON.stringify({ error: "Method not allowed" })); return; }
  const body = await new Promise((r) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => r(d)); });
  let parsed;
  try { parsed = JSON.parse(body); } catch { res.writeHead(400); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
  if (!parsed.system || !Array.isArray(parsed.messages)) { res.writeHead(400); res.end(JSON.stringify({ error: "Missing system or messages" })); return; }
  if (!API_KEY) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Server not configured: MINIMAX_API_KEY missing." }));
    return;
  }
  try {
    const apiResp = await fetch(MINIMAX_URL, {
      method: "POST",
      headers: { Authorization: "Bearer " + API_KEY, "Content-Type": "application/json", "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: Math.min(parsed.max_tokens || 1500, 4000),
        system: parsed.system,
        messages: parsed.messages,
      }),
      signal: AbortSignal.timeout(90000),
    });
    const apiData = await apiResp.json();
    if (!apiResp.ok) {
      const msg = apiData?.error?.message || apiData?.base_resp?.status_msg || `MiniMax HTTP ${apiResp.status}`;
      res.writeHead(apiResp.status >= 400 ? apiResp.status : 502);
      res.end(JSON.stringify({ error: msg }));
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

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  if (url.pathname === "/api/generate") return handleGenerate(req, res);
  serveStatic(res, url.pathname === "/" ? "/index.html" : url.pathname);
});

server.listen(PORT, () => {
  console.log(`\n  🔍 产品会说话 — 互动讲解页生成器`);
  console.log(`  Local: http://localhost:${PORT}`);
  console.log(`  API Key: ${API_KEY ? "✅ 已配置" : "❌ 未配置"}\n`);
});
