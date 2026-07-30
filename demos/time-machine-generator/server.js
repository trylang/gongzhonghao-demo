/**
 * AI 时间机器 — 代理服务器
 *
 * /api/analyze：接收 base64 老照片 → MiniMax-Text-01（支持读图）抽取结构化线索
 * /api/story  ：接收确认后的线索 + 用户补充 → 生成今昔故事 + 分享标题
 * 图片全程只在内存里过一遍，不落盘。API Key 只存服务端环境变量。
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
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
} catch { /* no .env */ }

const API_KEY = process.env.MINIMAX_API_KEY || "";
const CHAT_URL = "https://api.minimaxi.com/v1/text/chatcompletion_v2";
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

function readBody(req, limit = 6 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new Error("图片太大，请压缩后重试")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

async function callMiniMax(messages, maxTokens = 900) {
  const upstream = await fetch(CHAT_URL, {
    method: "POST",
    headers: { "Authorization": `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages, max_tokens: maxTokens, temperature: 0.7 }),
  });
  const data = await upstream.json();
  const br = data && data.base_resp;
  if (br && br.status_code !== 0) throw new Error(br.status_msg || "上游服务异常");
  const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!text) throw new Error("AI 返回为空");
  return text;
}

// 从模型输出里尽力抠出 JSON
function extractJson(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("未找到 JSON");
  return JSON.parse(m[0]);
}

const ANALYZE_PROMPT = `你是一位老照片侦探。仔细观察这张照片，从画面里找线索，输出严格的 JSON（不要任何其他文字），格式如下：
{
  "era": "推测的拍摄年代（如：1980年代末—1990年代初）",
  "era_reason": "一句话说明依据",
  "clues": [
    {"type": "服饰", "detail": "观察到的具体细节", "inference": "由此推断出什么"},
    {"type": "建筑/环境", "detail": "...", "inference": "..."},
    {"type": "物件", "detail": "...", "inference": "..."},
    {"type": "文字/招牌", "detail": "...", "inference": "..."}
  ],
  "scene_guess": "一句话推测这是什么场合/地点",
  "confidence": "high | medium | low"
}
要求：clues 只写照片里真实可见的内容，看不到的类别就省略；detail 要具体（颜色、样式、位置）；不确定就在 inference 里说"可能"。`;

async function handleAnalyze(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
  if (!API_KEY) return json(res, 500, { error: "服务端未配置 API Key" });
  let payload;
  try { payload = JSON.parse(await readBody(req)); }
  catch (e) { return json(res, 400, { error: e.message || "请求体不合法" }); }
  const dataUrl = payload && payload.image;
  if (!dataUrl || !/^data:image\/(png|jpeg|jpg|webp);base64,/.test(dataUrl)) {
    return json(res, 400, { error: "请上传 png/jpg/webp 图片" });
  }
  try {
    const text = await callMiniMax([
      { role: "user", content: [
        { type: "image_url", image_url: { url: dataUrl } },
        { type: "text", text: ANALYZE_PROMPT },
      ] },
    ], 900);
    const parsed = extractJson(text);
    return json(res, 200, { result: parsed });
  } catch (e) {
    return json(res, 502, { error: "识别失败：" + e.message });
  }
}

async function handleStory(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
  if (!API_KEY) return json(res, 500, { error: "服务端未配置 API Key" });
  let payload;
  try { payload = JSON.parse(await readBody(req, 256 * 1024)); }
  catch { return json(res, 400, { error: "请求体不合法" }); }
  const { era = "", scene = "", clues = [], userNote = "" } = payload || {};
  const cluesText = (Array.isArray(clues) ? clues : []).slice(0, 10)
    .map((c) => `- ${String(c.type || "").slice(0, 20)}：${String(c.detail || "").slice(0, 100)}（${String(c.inference || "").slice(0, 100)}）`)
    .join("\n") || "（无）";
  const prompt = `根据下面这张老照片的线索，写一段温暖的"今昔故事"。

拍摄年代：${String(era).slice(0, 60)}
场景推测：${String(scene).slice(0, 100)}
画面线索：
${cluesText}
照片主人补充：${String(userNote).slice(0, 300) || "（无）"}

输出严格 JSON（不要其他文字）：
{
  "story": "300字左右的今昔故事，第二人称写给照片主人，从画面细节切入，写到时代变迁，结尾落回'照片还在，故事就没丢'的温度。不煽情堆砌，像老朋友讲述。",
  "titles": ["三个适合发朋友圈/公众号的分享标题", "...", "..."],
  "quote": "从故事里提炼的一句 20 字以内金句"
}`;
  try {
    const text = await callMiniMax([{ role: "user", content: prompt }], 1200);
    const parsed = extractJson(text);
    return json(res, 200, { result: parsed });
  } catch (e) {
    return json(res, 502, { error: "生成失败：" + e.message });
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/api/analyze") { handleAnalyze(req, res); return; }
  if (url.pathname === "/api/story") { handleStory(req, res); return; }
  if (url.pathname === "/healthz") { res.writeHead(200); res.end("ok"); return; }
  let file = url.pathname === "/" ? "/index.html" : url.pathname;
  serveStatic(res, file.replace(/^\/+/, ""));
});

server.listen(PORT, () => console.log(`[time-machine] listening on :${PORT}`));
