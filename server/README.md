# dev-workbench-sync

轻量后端：为 dev-workbench 提供多用户登录 + 每用户独立数据存储。

零业务依赖，只用 Node.js 内置 `http / fs / crypto`。密码哈希用 `crypto.scrypt`，session token 是 32 字节随机 hex。

---

## 启动

```bash
# 首次部署：开放注册（不配置 INVITE_CODE）+ 自动建 admin 账户
INVITE_CODE=$(openssl rand -hex 8) \
BOOTSTRAP_USER=admin \
ALLOWED_ORIGINS='http://localhost:5173,http://211.159.169.153' \
  pm2 start ecosystem.config.cjs --update-env

pm2 save
pm2 startup   # 按提示执行返回的命令
```

启动后日志会打印 `[bootstrap]` 段，里面是 `admin` 账户的随机密码 —— **只打印这一次**，请立刻记下并登录修改。

`INVITE_CODE` 设置后，访问 `/` 时 UI 注册 tab 会要求填邀请码（与服务端 `INVITE_CODE` 必须一致）。不设置 = 开放注册。

---

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `8787` | HTTP 端口 |
| `HOST` | `127.0.0.1` | 监听地址（仅本机，由 nginx 反代） |
| `DATA_DIR` | `./data/` | 数据根目录（含 `users.json` + `users/<u>.json`） |
| `USERS_FILE` | `<DATA_DIR>users.json` | 用户表 JSON 路径 |
| `USER_DATA_DIR` | `<DATA_DIR>users/` | 每用户 snapshot 目录 |
| `LEGACY_STORE_FILE` | 空 | 旧版（单 token）`store.json` 路径；启动时若 `users.json` 不存在则自动迁移到 `BOOTSTRAP_USER` 名下 |
| `BOOTSTRAP_USER` | 空 | 首次启动时若 `users.json` 为空，自动创建该账户并打印密码 |
| `INVITE_CODE` | 空 | 注册时校验；空 = 开放注册 |
| `RATE_LIMIT_PER_MIN` | `20` | `/api/auth/*` 每 IP 每分钟上限 |
| `ALLOWED_ORIGINS` | `http://localhost:5173,http://211.159.169.153` | 逗号分隔允许 origin |

---

## 升级 / 迁移

如果是从旧版（共享 `AUTH_TOKEN`）升级：

1. 停服：`pm2 stop dev-workbench-sync`
2. 上传新代码
3. 启动时同时配置 `LEGACY_STORE_FILE=/var/www/dev-workbench-sync/data/store.json` + `BOOTSTRAP_USER=<你的用户名>`：
   ```bash
   LEGACY_STORE_FILE=/var/www/dev-workbench-sync/data/store.json \
   BOOTSTRAP_USER=alice \
   INVITE_CODE=<你定的> \
   ALLOWED_ORIGINS='http://localhost:5173,http://211.159.169.153' \
     pm2 start ecosystem.config.cjs --update-env
   ```
4. 启动日志会显示 `[migration] moved .../store.json → .../users/alice.json` —— 旧数据自动迁移完毕
5. 用 admin（或你迁过去的用户名）+ 日志里打印的密码登录；登录后即可正常使用

迁移完成后 `data/store.json` 不再被新代码读取，可以手动删掉。

---

## 数据格式

### `data/users.json`

```json
[
  {
    "username": "alice",
    "pwHashHex": "<scrypt hash hex>",
    "saltHex": "<16 字节 hex>",
    "tokenHex": "<32 字节 hex 或 null>",
    "createdAt": "ISO8601",
    "updatedAt": "ISO8601"
  }
]
```

### `data/users/<username>.json`

```json
{
  "version": 1,
  "serverTs": "ISO8601",
  "requirements": [...],
  "todos": [...],
  "projects": [...],
  "settings": { "autoArchiveMonths": 3 }
}
```

合并策略：同 id 两边都有 → `updatedAt` 大的胜；缺字段时降级 `createdAt`。

---

## API

所有响应统一：`{ ok: boolean, data?, error? }`。失败用 `error` 字段（不是 message）。

### 公开

| Method & Path | Body | 行为 |
|---|---|---|
| `GET /api/health` | — | `{ ok:true, data:{version, ts} }` |
| `POST /api/auth/register` | `{ username, password, inviteCode? }` | `{ ok, data:{user:{username}, token} }`；失败统一 401 `invalid credentials` |
| `POST /api/auth/login` | `{ username, password }` | 同上；登录会重置 token（token rotation） |

### 鉴权（`Authorization: Bearer <token>`）

| Method & Path | 行为 |
|---|---|
| `POST /api/auth/logout` | 204；服务端清掉该 token |
| `GET /api/auth/me` | `{ ok, data:{user:{username}} }` |
| `GET /api/snapshot` | 返回当前用户全量 + `serverTs` |
| `POST /api/push` | 接收客户端全量做字段级 LWW 合并，落盘当前用户文件，返回合并结果 |

---

## 安全模型

| 维度 | 当前 | 备注 |
|---|---|---|
| 密码存储 | scrypt (N=16384, r=8, p=1) + 16 字节 salt | 零依赖；~80ms/次 |
| 登录失败信息 | 统一 `invalid credentials` | 防用户名枚举；scrypt 始终跑（dummy hash） |
| 限流 | 20 req/min/IP，仅 `/api/auth/*` | 单进程内存计数器 |
| 用户名规则 | `^[a-z0-9_]{3,20}$` | 前后端都校验 |
| 忘记密码 | 无（v1） | 联系管理员用 `node -e` 改 `pwHashHex`；v2 加 UI |
| XSS 偷 token | localStorage 可读 | 项目无第三方脚本；v2 上 httpOnly cookie |

---

## nginx / vite 配置

nginx 已有的 `/dev-workbench/api/` location 不用动 —— 新端点 `/api/auth/*` 自动被转发。

vite dev 的 `vite.config.ts` 的 `server.proxy['/api']` 也不用动。