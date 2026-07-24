# 部署到 Render（免费）

本项目已改造为「前端 + Node 代理」架构，`content-generator/` 目录可直接部署到 Render 免费节点。
API Key 走服务端环境变量，**不会进代码库、前端看不到**。

## 一、准备 GitHub 仓库（一次性）

```bash
cd /Users/jane/Desktop/work/sharing/gongzhonghao/content-generator

# 1) 在 GitHub 新建一个空仓库（如 daizhou-ai-marketing），然后：
git init
git add .
git commit -m "feat: 代州黄酒 AI 内容营销生成器"
git branch -M main
git remote add origin https://github.com/<你的用户名>/daizhou-ai-marketing.git
git push -u origin main
```
> 注意：`.env` 已在 `.gitignore` 中，不会被推送。

## 二、Render 后台部署

1. 打开 https://dashboard.render.com → 注册/登录（可用 GitHub 授权）。
2. 点 **New → Web Service** → 连接刚才的 GitHub 仓库。
3. Render 会自动读取仓库里的 `render.yaml`，基本不用改：
   - Runtime: **Node**
   - Plan: **Free**
   - Build Command: `echo 'no build needed'`
   - Start Command: `node server.js`
4. 展开 **Environment → Add Environment Variable**：
   - `MINIMAX_API_KEY` = `sk-你的MiniMax密钥`
5. 点 **Create Web Service**，等待部署完成（约 1–2 分钟）。
6. 部署成功后，Render 会分配地址：`https://daizhou-huangjiu-ai.onrender.com`

## 三、使用

打开地址 → 填产品卖点 → 点「⚡ 一键生成四渠道文案」→ 真模型出四套文案。
点「📋 公众号格式」可弹窗预览并一键复制带格式内容，直接粘贴到公众号编辑器。

## 四、注意事项

- **免费版冷启动**：长时间无访问后首次打开会睡死，需等 10–40 秒自动唤醒，属正常。
- **Key 只在服务端**：本地用 `.env`，线上用 Render 环境变量，二者互不干扰。
- **改代码后重新部署**：在 Render 后台该服务页点 **Manual Deploy** 即可。
- 想换平台（Railway / Vercel）也完全兼容，只需保证设置 `MINIMAX_API_KEY` 环境变量 + 启动命令 `node server.js`。
