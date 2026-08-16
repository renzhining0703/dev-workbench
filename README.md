# dev-workbench

个人开发工作台：需求管理 + 待办 + 上线提醒，React 18 + TypeScript + Vite + Tailwind，纯前端 localStorage 持久化。

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
```

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
