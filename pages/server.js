/**
 * gongzhonghao-articles — 公众号正文查看器（Render web 服务）
 *
 * 路由：/<slug>/  →  读取 pages/<slug>/index.html 并返回 text/html
 * 设计：单服务托管全部公众号正文，每篇文章一个目录，避免每篇建独立服务撑爆免费 plan。
 * 与 demo 服务机制一致（web + server.js），纯静态不需要 MINIMAX_API_KEY。
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || "3000", 10);

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

function serveArticle(res, slug) {
  // 防目录穿越：slug 只含字母数字连字符
  if (!/^[A-Za-z0-9_-]+$/.test(slug)) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Bad slug");
    return;
  }
  const idx = path.join(__dirname, slug, "index.html");
  if (!fs.existsSync(idx)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found: " + slug);
    return;
  }
  res.writeHead(200, {
    "Content-Type": MIME[".html"],
    "Cache-Control": "public, max-age=3600",
  });
  fs.createReadStream(idx).pipe(res);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  res.setHeader("Access-Control-Allow-Origin", "*");

  let p = url.pathname;
  if (p.endsWith("/")) p = p.slice(0, -1);
  if (!p) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<h1>gongzhonghao-articles</h1><p>公众号正文查看服务已就绪。</p>");
    return;
  }
  const slug = p.replace(/^\//, "");
  serveArticle(res, slug);
});

server.listen(PORT, () => {
  console.log(`gongzhonghao-articles listening on ${PORT}`);
});
