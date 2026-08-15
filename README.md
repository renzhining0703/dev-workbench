# dev-workbench

个人开发工作台：需求管理 + 待办 + 上线提醒，React 18 + TypeScript + Vite + Tailwind，纯前端 localStorage 持久化。

## 快速开始

```bash
npm install
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
