# dev-workbench

个人开发工作台：需求管理 + 待办 + 上线提醒，React 18 + TypeScript + Vite + Tailwind。

数据持久化：**本地 localStorage + 可选的云端同步（多用户登录，每用户独立存储）**。

## 快速开始

```bash
npm install
npm run gen:icons    # 生成 PWA 图标（首次或改了 favicon.svg 时跑）
npm run dev          # 本地开发，base = /

# 启动同步后端（8787 端口）
cd server && INVITE_CODE=DEMO node index.mjs
```

打开 `http://localhost:5173/` 后会弹出登录 / 注册窗口 —— 没有云端账号就不能写数据（保留本地只读浏览能力后续会做）。

## 快速开始

```bash
npm install
npm run gen:icons    # 生成 PWA 图标（首次或改了 favicon.svg 时跑）
npm run dev          # 本地开发，base = /
```

## 发布到服务器

```bash
yarn pub             # 一键部署到 http://211.159.169.153/dev-workbench/
```

流程：本地 `npm run build`（base 自动为 `/dev-workbench/`）→ scp 到远端临时目录 → 远端原子替换正式目录（旧版自动备份到 `/var/www/.bak/dev-workbench-<时间戳>/`，保留最近 5 个版本）→ 自动清理过期备份。

### 环境变量覆盖

```bash
# 部署到其它服务器
DEPLOY_SERVER=other@1.2.3.4 DEPLOY_REMOTE_DIR=/data/www/dev-workbench yarn pub

# 保留更多历史版本
KEEP_BACKUPS=10 yarn pub
```

### 服务器 nginx 配置（参考）

```nginx
location /dev-workbench/ {
    alias /var/www/dev-workbench/;
    index index.html;
    try_files $uri $uri/ /dev-workbench/index.html;
}

# import-data.json 走根路径
location = /import-data.json {
    alias /var/www/dev-workbench/import-data.json;
}

# 同步后端反代
location /dev-workbench/api/ {
    proxy_pass http://127.0.0.1:8787/api/;
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_request_buffering off;   # sendBeacon 不被缓冲
    proxy_read_timeout 30s;
}
```

## 跨设备同步

`localStorage` 是按 origin 隔离的，所以本地 `http://localhost:5173/` 和线上 `http://211.159.169.153/dev-workbench/` 是两份数据。解决方案：新增一个轻量 Node 后端做中转 —— **多用户登录 + 每用户独立存储**，本地 + 线上两端都打这个 API。

### 同步范围

只同步核心业务数据：

- 需求（`requirements`）
- 待办（`todos`）
- 项目（`projects`）
- 自动归档月份（`settings.autoArchiveMonths`）

主题、PWA 状态、安装提示、权限弹窗等设备级数据仍保留本地。

### 登录 / 注册

应用启动后弹出登录 / 注册窗口：

- **登录**：填用户名 + 密码
- **注册**：填用户名 + 密码 + 邀请码（如果服务端配置了 `INVITE_CODE`）
- 勾选「保持登录」后，token 存 localStorage 30 天；不勾则在浏览器关闭时失效

服务端鉴权用 `Authorization: Bearer <token>`，每次登录都会重置 token（旧 token 立即失效）。

### 同步策略

| 事件 | 动作 |
|---|---|
| 登录 / 注册成功 | 先 `push` 本地快照到服务端，再 `pull` 取服务端最新合并结果（防止本地数据被服务端空快照覆盖） |
| 启动 / 切回前台 | `pull()` 拉一次服务端快照（与本地 LWW merge，不会清空本地未推送改动） |
| 任意本地 mutation | `schedulePush()` 300ms debounce 后推 |
| 30s 兜底轮询 | `pendingChanges` 时推，否则拉 |
| 关闭页面 / 切走 | `navigator.sendBeacon` fire-and-forget |
| 任意 401 | 弹登录框（用户名预填回） |

冲突解决：`applyRemote` 改成基于 `updatedAt` 的 LWW merge（last-write-wins）—— 服务端返回的快照会和本地按字段级合并，而不是整体替换。这样**任何本地未推送的改动都不会被服务端覆盖**。`TodoItem` / `Project` 已补 `updatedAt`，缺字段时降级 `createdAt`。

### 部署同步后端

后端是 `server/` 目录，零依赖的 Node `http` 服务。`yarn pub` 脚本会自动部署到 `/var/www/dev-workbench-sync/` 并用 pm2 守护。

首次手动部署（必须设 `INVITE_CODE` 才能注册新用户；不设 = 开放注册）：

```bash
INVITE_CODE=$(openssl rand -hex 8) \
BOOTSTRAP_USER=admin \
ALLOWED_ORIGINS='http://localhost:5173,http://211.159.169.153' \
  pm2 start server/ecosystem.config.cjs --update-env
pm2 save
pm2 startup   # 按提示执行返回的命令
```

启动日志会打印 admin 账户的随机密码 —— **只打印这一次**，记下立刻登录修改。

### 本地 dev 端

```bash
# 终端 A：起后端（不带 INVITE_CODE = 开放注册；带 BOOTSTRAP_USER 会自动创建 admin）
cd server
INVITE_CODE=DEMO BOOTSTRAP_USER=admin node index.mjs

# 终端 B：起前端
npm run dev
# → http://localhost:5173/
```

`vite.config.ts` 已配置 `server.proxy['/api']` → `127.0.0.1:8787`，所以 `npm run dev` 直接能用同步。`.env.development` 里只剩 `VITE_SYNC_API=/api`，token 来自运行时登录。

### 安全模型

- 密码用 scrypt (N=16384) + 16 字节 salt 哈希后存盘（明文不存）
- 登录失败统一 `invalid credentials`，不区分「用户名错 / 密码错」（防枚举）
- `/api/auth/*` 每 IP 每分钟 20 次限流
- 401 立即吊销旧 token；登出时服务端清掉 token

XSS 风险：localStorage 可被同源脚本读 token —— 项目无第三方脚本、无 `dangerouslySetInnerHTML`，安全模型够用。未来要上 httpOnly cookie 还需要 CORS `credentials: 'include'` + nginx 配置。

### API

| Method & Path | Auth | 说明 |
|---|---|---|
| `GET /api/health` | 否 | 健康检查 |
| `POST /api/auth/register` | 否 | `{ username, password, inviteCode? }` → 返回 token |
| `POST /api/auth/login` | 否 | `{ username, password }` → 返回新 token（rotation） |
| `POST /api/auth/logout` | bearer | 清掉 token |
| `GET /api/auth/me` | bearer | 返回当前用户 |
| `GET /api/snapshot` | bearer | 返回当前用户的全量快照 |
| `POST /api/push` | bearer | 客户端全量推送，服务端 LWW 合并后返回合并结果 |

响应统一格式：`{ ok: boolean, data?: ..., error?: string }`。

### 本地不带前缀构建

```bash
VITE_BASE=./ npm run build   # 资源使用相对路径，可直接打开 dist/index.html
```

### 手动回滚

```bash
ssh dev-workbench 'ls /var/www/.bak/'                                    # 查看备份列表
ssh dev-workbench 'mv /var/www/.bak/dev-workbench-20260815-120000 /var/www/dev-workbench'
```

### 前置条件

- SSH 密钥免密登录 `dev-workbench` 别名已配好（`~/.ssh/config`）
- 服务器存在 `/var/www/dev-workbench` 目录且 nginx 配置了对应 location

## PWA 支持（桌面图标 + 全屏体验）

部署到 `https://<your-domain>/dev-workbench/` 后，移动端浏览器会自动提示「安装到桌面」，装好后：

- 主屏幕图标 + 启动全屏（隐藏浏览器 UI）
- 离线可用（Service Worker 缓存资源）
- 主题色统一（地址栏 / 启动画面 / 状态栏都用 `#6366f1`）

### 安装方式

| 设备/浏览器 | 安装方式 |
|---|---|
| **Chrome / Edge（Android）** | 地址栏右侧出现「安装」图标；或在页面停留 30 秒后底部浮窗提示 |
| **iOS Safari** | 分享按钮 ⤴ → 添加到主屏幕（首次访问会弹引导 Modal） |
| **微信内置浏览器** | 顶部条提示：右上角 ··· → 在浏览器中打开 |

### 重新生成 PWA 图标

如果改了 `public/favicon.svg` 想要新的 PWA 图标：

```bash
npm run gen:icons
```

会重新生成 `public/pwa-192x192.png`、`pwa-512x512.png`、`pwa-maskable-512.png`、`apple-touch-icon.png`。

### Web Push

当前**未启用** Web Push（需要后端）。已装的 PWA 仍能：
- 通过浏览器内的桌面通知（用户在前台时）
- 应用启动后读取 localStorage 检查今日上线需求

要做真正的后台推送（浏览器被杀也能收到），需要新增一个后端服务接收 PushSubscription 并定时发推送，属于单独 PR 范围。
