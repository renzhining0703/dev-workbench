# dev-workbench-sync v2

轻量后端：为 dev-workbench 提供多用户登录 + 每用户独立数据同步。

**v2 架构**：Express 4 + `node:sqlite`（Node ≥ 22.5 内置，零原生编译）。仅 2 个直接依赖（express、express-rate-limit），API 契约与 v1 完全一致，前端零改动。

```
server/
├── index.mjs        # 入口：listen + 优雅关闭
├── app.mjs          # createApp()：中间件挂载（可单测）
├── config.mjs       # 环境变量 → 配置对象（loadConfig(env) 可注入）
├── db.mjs           # node:sqlite 初始化 + WAL + schema 迁移
├── startup.mjs      # 首启钩子：v1 JSON 自动导入 + bootstrap 账户
├── migrate.mjs      # v1 JSON → SQLite 导入/校验（被 startup 与脚本复用）
├── middleware/
│   └── auth.mjs     # Bearer 校验（sessions 表索引查询）
├── routes/
│   ├── auth.mjs     # register/login/logout/me + 限流
│   └── sync.mjs     # health/snapshot/push（事务化 LWW 合并）
├── store/
│   ├── users.mjs    # 用户表 CRUD
│   ├── sessions.mjs # 会话（token 只存 SHA-256；单会话互踢）
│   └── snapshots.mjs# 快照（update() 事务包住读-改-写）
├── lib/
│   ├── password.mjs # scrypt 三件套（v1 平移）
│   ├── token.mjs    # token 生成/哈希
│   └── merge.mjs    # LWW 合并纯函数（零 IO，test 固化行为）
├── scripts/
│   └── migrate-json-to-sqlite.mjs  # 手动迁移（dry-run / --apply，幂等）
└── test/
    ├── smoke.mjs        # 行为基线冒烟（新旧后端通用对拍，49 断言）
    ├── merge.test.mjs   # 合并纯函数单测
    └── api.test.mjs     # in-process 集成测试（跑同一套冒烟断言）
```

---

## 快速开始

```bash
cd server
npm install          # express + express-rate-limit
npm test             # 12 项单测 + 49 项行为对拍，全绿才可部署
npm start            # 默认 127.0.0.1:8787
```

生产部署走根目录 `yarn pub`（publish.sh 会连 server 一起发布并 pm2 reload）。

---

## v1 → v2 数据迁移（自动）

**无需手动操作**：v2 首次启动发现 users 表为空且 `data/users.json` 存在时，自动导入全部用户、快照与已登录会话（token 不失效）。v1 JSON 文件保留原位，确认服务正常后可删。

手动迁移（推荐先 dry-run 验证）：

```bash
cd server
node scripts/migrate-json-to-sqlite.mjs           # dry-run：临时库试迁移 + 逐字段校验
node scripts/migrate-json-to-sqlite.mjs --apply   # 写入真实库（幂等，可重跑）
```

校验内容：密码哈希/盐逐字段比对、快照逐字节比对、会话存在性。任何不一致即中止。

---

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `8787` | HTTP 端口 |
| `HOST` | `127.0.0.1` | 监听地址（仅本机，由 nginx 反代） |
| `DATA_DIR` | `./data/` | 数据根目录（`sync.db` 与旧 JSON 都在这里） |
| `DB_FILE` | `<DATA_DIR>sync.db` | SQLite 数据库文件 |
| `LEGACY_USERS_FILE` | `<DATA_DIR>users.json` | v1 用户表（首启自动导入） |
| `LEGACY_USER_DATA_DIR` | `<DATA_DIR>users/` | v1 快照目录 |
| `LEGACY_STORE_FILE` | 空 | 更早期单 token 的 store.json（导入为 BOOTSTRAP_USER 快照） |
| `BOOTSTRAP_USER` | 空 | 首启自动创建的账户；密码写入 `<DATA_DIR>bootstrap-password.txt`（0600），不再打日志 |
| `INVITE_CODE` | 空 | 注册时校验；空 = 开放注册 |
| `RATE_LIMIT_PER_MIN` | `20` | `/api/auth/register|login` 每 IP 每分钟上限 |
| `ALLOWED_ORIGINS` | `http://localhost:5173,http://211.159.169.153` | 逗号分隔允许 origin |

---

## 数据格式（SQLite）

```sql
users     (username PK, pw_hash, salt, created_at, updated_at)
sessions  (token_hash PK, username FK, created_at)   -- token 只存 SHA-256
snapshots (username PK, data)                        -- 快照整包 JSON
```

合并策略与 v1 完全一致：同 id 两边都有 → `updatedAt` 大的胜（缺则降级 `createdAt`）；settings 对象展开合并。

---

## API

所有响应统一：`{ ok: boolean, data?, error? }`。失败用 `error` 字段（不是 message）。

### 公开

| Method & Path | Body | 行为 |
|---|---|---|
| `GET /api/health` | — | `{ ok:true, data:{version, ts} }` |
| `POST /api/auth/register` | `{ username, password, inviteCode? }` | `{ ok, data:{user:{username}, token} }`；失败统一 401 `invalid credentials` |
| `POST /api/auth/login` | `{ username, password }` | 同上；登录轮换 token（单会话互踢） |

### 鉴权（`Authorization: Bearer <token>`）

| Method & Path | 行为 |
|---|---|
| `POST /api/auth/logout` | 204；服务端清掉该 token |
| `GET /api/auth/me` | `{ ok, data:{user:{username}} }` |
| `GET /api/snapshot` | 返回当前用户全量 + `serverTs` |
| `POST /api/push` | 接收客户端全量做字段级 LWW 合并（事务内），落盘并返回合并结果 |

---

## 安全模型

| 维度 | v2 | 备注 |
|---|---|---|
| 密码存储 | scrypt (N=16384, r=8, p=1) + 16 字节 salt | 与 v1 一致 |
| 登录失败信息 | 统一 `invalid credentials` + dummy scrypt | 防枚举 |
| token 落库 | 只存 SHA-256 | v1 存明文；泄露库文件≠泄露会话 |
| 限流 | express-rate-limit，`trust proxy 1` 还原真实 IP | v1 手取 XFF 首段可被伪造 |
| 并发写 | push 读-改-写包在 `BEGIN IMMEDIATE` 事务 | v1 并发丢更新 |
| 忘记密码 | 无（v1 同） | CLI 改 `users` 表；后续可加 UI |

---

## 测试

```bash
npm test              # 单测 + 集成（in-process，49 项行为对拍）
npm run test:smoke    # 对任意运行中的服务跑冒烟（新旧通用）
```

`test/smoke.mjs` 是 v1 行为的固化基线：v2 上线前必须全绿，改动 API 前先改它。

---

## 回滚

```bash
# 服务器上：
pm2 stop dev-workbench-sync
cd /var/www/.bak-sync/.latest   # publish.sh 保留的上一版（v1）
# 用旧版目录重启 pm2 即可；data/users.json v2 从不删除，v1 直接可用
```
