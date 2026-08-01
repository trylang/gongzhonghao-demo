import express from 'express';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.static('.'));

// Render 健康检查（render.yaml 的 healthCheckPath: /healthz 需要此路由）
app.get('/healthz', (_req, res) => { res.status(200).send('ok'); });

// 每个 demo 的"出什么成果"由 ./system_prompt.txt 决定（复制脚手架后修改此文件即可）
const SYSTEM_PROMPT = fs.existsSync('./system_prompt.txt')
  ? fs.readFileSync('./system_prompt.txt', 'utf-8')
  : '你是一个有帮助的助手，根据用户输入给出简洁有用的回答。';

const API_URL = process.env.MINIMAX_TEXT_URL || 'https://api.minimaxi.com/anthropic/v1/messages';
const API_KEY = process.env.MINIMAX_API_KEY;
const MODEL = process.env.MINIMAX_MODEL || 'MiniMax-Text-01';

app.post('/api/generate', async (req, res) => {
  if (!API_KEY) return res.status(500).json({ error: 'MINIMAX_API_KEY 未配置' });
  const body = req.body || {};
  // 前端表单字段自由定义，这里用通用 product/channel 作示例，按需改
  const userText = Object.entries(body)
    .filter(([k]) => k !== 'system')
    .map(([k, v]) => `${k}：${v}`)
    .join('\n');

  try {
    const r = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1200,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userText }]
      })
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: JSON.stringify(data) });
    const text = (data.content || []).map(c => c.text || '').join('');
    res.json({ result: text });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`demo running on :${port}`));
