// 通用「交互工具」后端（脚手架）。
// 前端是固定的配置驱动框架（index.html + app.js + style.css），根据 config.json 渲染表单与结果。
// 本服务只做三件事：
//   1) 托管静态文件（config.json / index.html / app.js / style.css）
//   2) /healthz —— Render 健康检查
//   3) /api/generate —— 接收表单字段，调用 MiniMax（要求模型返回 JSON），原样回传解析后的 JSON
// 领域逻辑（"出什么成果"）全部写在 ./system_prompt.txt 里；表单与结果如何渲染写在 ./config.json 里。
// 安全铁律：API Key 只在服务端环境变量，前端永远拿不到。

import express from 'express';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.static('.'));

// Render 健康检查（render.yaml 的 healthCheckPath: /healthz 需要此路由）
app.get('/healthz', (_req, res) => res.status(200).send('ok'));

const SYSTEM_PROMPT = fs.existsSync('./system_prompt.txt')
  ? fs.readFileSync('./system_prompt.txt', 'utf-8')
  : '你是一个有帮助的助手，根据用户输入给出简洁有用的回答，并以 JSON 输出。';

const API_URL = process.env.MINIMAX_TEXT_URL || 'https://api.minimaxi.com/anthropic/v1/messages';
const API_KEY = process.env.MINIMAX_API_KEY;
const MODEL = process.env.MINIMAX_MODEL || 'MiniMax-Text-01';

function formatInput(fields, history, clarifications) {
  const lines = [];
  if (fields && typeof fields === 'object') {
    for (const [k, v] of Object.entries(fields)) {
      if (k === 'system') continue;
      const val = Array.isArray(v) ? v.filter(Boolean).join('、') : (v == null ? '' : String(v));
      if (val) lines.push(`${k}：${val}`);
    }
  }
  let user = lines.join('\n');
  if (history) {
    const h = typeof history === 'string' ? history : JSON.stringify(history, null, 2);
    user += `\n\n【上一轮草稿】\n${h}`;
  }
  if (clarifications && Object.keys(clarifications).length) {
    user += `\n\n【用户补充的澄清回答】\n` + Object.entries(clarifications).map(([k, v]) => `${k}：${v}`).join('\n');
  }
  return user;
}

// 尽力从模型输出里抠出 JSON（容忍 ```json 围栏 / 前后多余文字 / 数组）
function parseJSON(text) {
  if (!text) return null;
  let t = String(text).trim();
  t = t.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const slice = (s, e) => {
    if (s === -1 || e === -1) return null;
    try { return JSON.parse(t.slice(s, e + 1)); } catch { return null; }
  };
  let r = slice(t.indexOf('{'), t.lastIndexOf('}'));
  if (r) return r;
  r = slice(t.indexOf('['), t.lastIndexOf(']'));
  return r;
}

app.post('/api/generate', async (req, res) => {
  if (!API_KEY) return res.status(500).json({ error: 'MINIMAX_API_KEY 未配置' });
  const body = req.body || {};
  const userText = formatInput(body.fields, body.history, body.clarifications);
  if (!userText.trim()) return res.status(400).json({ error: '缺少输入' });

  try {
    const r = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userText }],
      }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: JSON.stringify(data) });
    const text = (data.content || []).map((c) => c.text || '').join('');
    const result = parseJSON(text);
    // 模型没返标准 JSON：降级把原文回传，前端以原文展示，demo 仍可用
    if (!result) return res.json({ raw: text, parseError: true });
    res.json({ result });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`demo running on :${port}`));
