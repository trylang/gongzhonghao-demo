# gongzhonghao-demo

公众号 demo 单体仓库。每个 demo 放在 `demos/<name>/` 下，各自是一个独立可部署的 Render 服务（独立 URL）。

## 结构

```
gongzhonghao-demo/
├── render.yaml              # Render 蓝图：声明所有 demo 服务（每个用 rootDir 指向子文件夹）
├── .gitignore               # 全局忽略 .env / node_modules
├── README.md
└── demos/
    └── content-generator/   # demo ①：代州黄酒 AI 内容营销生成器（四渠道文案 + 公众号格式复制）
        ├── server.js        # Node 后端代理，持有 MiniMax Key（环境变量）
        ├── package.json
        ├── index.html / style.css / app.js
        └── .env.example
```

## 新增一个 demo 的步骤

1. 在 `demos/` 下新建文件夹，例如 `demos/my-new-demo/`。
2. 放入你的应用（需自带 `package.json`，启动命令能 `node server.js` 或等价）。
3. 打开仓库根 `render.yaml`，在 `services:` 下复制一段配置，改两处：
   - `name:` 服务名（决定默认域名前缀 `<name>.onrender.com`）
   - `rootDir: demos/my-new-demo`
4. 提交并推送到 `main`。Render 连仓库后自动创建该新服务（首次需在后台填一次 `MINIMAX_API_KEY` 等环境变量）。

## 部署前提（一次性）

- GitHub 仓库需存在（用你能建仓的 PAT 推上来）。
- 每个服务在 Render 后台首次部署时，填入对应环境变量（如 `MINIMAX_API_KEY`）。
- 共享 Key 可改用 `envVarGroups` 避免重复填写（见 Render 文档）。

## 本地运行某个 demo

```bash
cd demos/content-generator
cp .env.example .env   # 填入 MINIMAX_API_KEY
node server.js         # 打开 http://localhost:3000
```
