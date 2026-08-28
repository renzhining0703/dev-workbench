# Web Push HTTPS 部署清单（Cloudflare 免备案方案）

> 版本：v1 · 日期：2026-08-27
> 适用：dev-workbench 生产环境（腾讯云 `211.159.169.153`，nginx 反代，页面/API 同源在 `/dev-workbench` 下）
> 目标：不备案，用「国际域名 + Cloudflare 托管」让浏览器能以 HTTPS 访问，从而解锁 Web Push

---

## 一、为什么必须走这条路（30 秒回顾）

| 访问方式 | Push API 可用？ |
|---|---|
| `https://域名` | ✅ |
| `http://localhost` | ✅（浏览器豁免） |
| `http://211.159.169.153`（现状） | ❌ 浏览器硬性禁用，代码无法绕过 |

**核心机制**：浏览器 → HTTPS → **Cloudflare 边缘（终止 TLS）** → HTTP → 源站 nginx:80 → Node。
源站**不用装证书、不用改 TLS**，CF 免费版帮你把 HTTPS 的活全干了。

**前置条件（缺一不可）**
- 域名：国际后缀（`.com / .net / .top / .xyz / .org` 等），**`.cn` 不行**（CF 不支持托管）
- 已注册 Cloudflare 免费账号
- 能 ssh 上服务器（`211.159.169.153`）

---

## 第 0 步：买域名 + 实名（约 10 分钟）

1. 注册商选择：推荐 **Cloudflare Registrar**（域名直接托管 CF，少一步改 NS）；也可在阿里云/腾讯云/Dynadot 买完再迁 CF
2. 选购：`.top` / `.xyz` 首年约 5-15 元（续费贵，几十元/年）；`.com` 约 60-70 元/年最稳
3. 国际域名**只需实名**（上传身份证），**不需要备案**，买完即用

**✅ 验证**：注册商控制台能看到域名状态为 Active。

---

## 第 1 步：域名托管到 Cloudflare（改 NS）

1. 登录 [dash.cloudflare.com](https://dash.cloudflare.com) → **Add a site** → 输入你的域名 → 选 **Free** 套餐
2. 按引导添加一条临时 DNS 记录（先随便加个 `@ → 211.159.169.153`，下一步会精调）
3. 页面会给你 **两条 NS 地址**（形如 `xxx.ns.cloudflare.com`）
4. 去**域名注册商**控制台 → DNS / Nameservers → 把默认 NS 换成 CF 给的两条
5. 保存后回 CF 点 **Done / Check nameservers**

**✅ 验证**：macOS 终端执行（`ns1/ns2` 换成 CF 实际给的名字）：
```bash
dig NS 你的域名 +short
# 预期输出：CF 的两条 NS（通常 5 分钟～2 小时内生效，最长 24h）
```

---

## 第 2 步：DNS 添加 A 记录（开橙色云朵）

在 CF 域名页 → **DNS → Records** 添加：

| 字段 | 值 |
|---|---|
| Type | A |
| Name | `@`（根域名） |
| IPv4 address | `211.159.169.153` |
| Proxy status | **Proxied（橙色云朵，必须开）** |

（可选）再加一条 `www` → `211.159.169.153`，同样开橙色云朵。

**✅ 验证**（本地执行，注意看返回 IP 是否 CF 段——开代理后全球解析都指向 CF 节点而非源站 IP）：
```bash
dig A 你的域名 +short
# 预期：CF 的 IP（如 104.x / 172.67.x 等），不是 211.159.169.153
```

---

## 第 3 步：SSL/TLS 模式设为 Flexible（关键）

CF 域名页 → **SSL/TLS → Overview** → Encryption mode 选 **Flexible**。

- Flexible = 浏览器↔CF 是 HTTPS，CF↔源站走 HTTP（80 端口）。源站不用任何证书。
- 不要选 Full / Full (strict)——源站没有证书会失败。

### ⚠️ 必须先排查源站 nginx：去掉 http→https 强制跳转

Flexible 模式下 CF 用 **HTTP** 请求源站，如果 nginx 里有「HTTP 一律 301 到 HTTPS」的规则，CF 会陷入重定向循环，页面直接打不开。

**ssh 上服务器检查**：
```bash
nginx -T 2>/dev/null | grep -n "return 301\|rewrite.*https" | head
```
- 无输出 → 安全，跳过本节
- 有输出 → 找到对应 server 块，**删掉/注释掉**那行强制跳转，然后：
```bash
nginx -t && nginx -s reload
```

---

## 第 4 步：预检源站对新域名的响应（改 DNS 前先测，避免空窗）

在**本地 Mac** 执行（模拟 CF 携带新域名 Host 请求源站）：

```bash
curl -s -o /dev/null -w "%{http_code}\n" -H "Host: 你的域名" http://211.159.169.153/dev-workbench/
```

- 返回 `200` → nginx 默认 server 能兜底，继续
- 返回 `404` / `444` / 其他 → nginx 按 Host 严格匹配了，需要 ssh 上服务器，给对应 server 块加一行：
  ```nginx
  server_name 你的域名;   # 加到现有 /dev-workbench 反代的 server 块里
  ```
  然后 `nginx -t && nginx -s reload`，重跑上面 curl 直到 200。

---

## 第 5 步：服务器配置 VAPID 三件套（密钥已生成，直接抄）

ssh 上服务器，编辑 `/var/www/dev-workbench-sync/server/data/env.local`，**追加**（`VAPID_SUBJECT` 的邮箱换成你自己的）：

```
VAPID_PUBLIC_KEY=BIu2qyENwg7ld3WWrS65mXn4DDjKDghKeKI93BSQFKZ-gIIi-q15w2p07Ud0GZ0ZNWeygGveRWq5ksUkjgEOYZ8
VAPID_PRIVATE_KEY=walAZeEXcGp30L9Pw-h4tnfLvsq7KCIPfrrKLlkM8dc
VAPID_SUBJECT=mailto:you@example.com
```

（可选但推荐）同文件把新域名加进 CORS 白名单——同源访问其实不需要，但加上以后万一有跨域场景不会踩坑：

```
ALLOWED_ORIGINS=http://localhost:5173,http://211.159.169.153,https://你的域名
```

**重启服务让配置生效**（env.local 跨部署保留，之后 `yarn pub` 不会冲掉）：
```bash
cd /var/www/dev-workbench-sync
pm2 reload dev-workbench-sync --update-env
```

**✅ 验证**：
```bash
curl -s http://127.0.0.1:3001/api/push/vapid-public-key   # 端口按实际 pm2 配置
# 预期：返回 VAPID_PUBLIC_KEY 字符串；返回空/404 说明 env 没加载成功
```

---

## 第 6 步：验证 HTTPS + Web Push 全链路

### 6.1 HTTPS 是否生效

本地浏览器打开 `https://你的域名/dev-workbench/`：
- 地址栏有小锁 🔒
- 页面正常加载（能看到工作台界面）

终端验证：
```bash
curl -sI https://你的域名/dev-workbench/ | grep -i "cf-ray"
# 有 cf-ray 头 = 确实走了 Cloudflare 边缘，HTTPS 生效
```

### 6.2 订阅推送（浏览器侧）

页面右上菜单 → **推送通知** → 点「开启」：
- 浏览器弹出权限询问 → 点**允许**
- 弹窗内状态变成「已开启」→ 成功

### 6.3 真实推送（服务器侧）

ssh 上服务器执行：
```bash
cd /var/www/dev-workbench-sync
node scripts/push-daily.mjs --dry-run   # 第一步：只预览文案，不真发
node scripts/push-daily.mjs             # 第二步：真实推送
```

预期：终端打印 `✓ 已推送 N 条`，**浏览器弹出系统通知**（今日待上线需求 + 未完成待办数）。点击通知应跳转到今日待办页。

### 6.4 等每日自动推送

pm2 已配 cron（09:05 每日），确认进程存在：
```bash
pm2 list | grep push
# 预期：dev-workbench-push-daily 存在（autorestart:false，跑完即退，到点由 cron 拉起）
```

---

## 七、日常运维速查

| 事项 | 命令/说明 |
|---|---|
| 预览今日推送文案 | `cd /var/www/dev-workbench-sync && node scripts/push-daily.mjs --dry-run` |
| 手动触发一次推送 | 同上，去掉 `--dry-run` |
| 查看订阅列表 | 页面「推送通知」弹窗可见，或看 DB：`sqlite3 data/dev-workbench.db "SELECT username,endpoint FROM push_subscriptions"` |
| 失效订阅 | 推送脚本自动清理（404/410），失败原因记在 `last_error` |
| 域名续费 | Cloudflare Registrar 到期前会自动扣款，留意邮件 |
| 旧域名备案注销 | 不急，走了 CF 方案后备案可永久搁置 |

---

## 八、常见问题排查表

| 现象 | 原因 | 处理 |
|---|---|---|
| 打开 `https://域名` 一直转圈/重定向循环 | nginx 有 http→https 强制跳转（Flexible 模式死循环） | 删掉 301 跳转规则，`nginx -s reload`（见第 3 步） |
| 页面能开，但 API 报错/登录不了 | nginx 默认 server 没匹配新 Host | 按第 4 步给 server 块加 `server_name` |
| 推送弹窗显示「服务端未配置」 | env.local 没写 VAPID 或没 reload | 检查第 5 步，确认 `vapid-public-key` 接口有返回值 |
| 点了开启后权限被拒 | 浏览器设置里通知被禁 | 地址栏左侧 🔒 → 网站设置 → 通知 → 允许 |
| 推送开启成功但收不到通知 | ① 浏览器未保持打开/通知被系统静音 ② 订阅 endpoint 已失效 | ① 系统设置检查通知权限 ② 重开订阅再跑一次 `push-daily.mjs` |
| 通知弹了但点击没跳转 | SW 的 notificationclick 路径不对 | 检查是否访问的是 `/dev-workbench/` 子路径（点击跳转写死了该前缀） |
| iOS Safari 收不到推送 | **Web Push 仅 Chrome/Edge/Firefox 桌面端 + Android Chrome**，iOS Safari 不支持网页推送 | 用 Chrome 验证；iOS 只能等系统通知不支持 |

---

## 九、回滚方案（万一出问题）

| 场景 | 回滚动作 |
|---|---|
| HTTPS 配好后页面挂了 | 访问 `http://211.159.169.153/dev-workbench/` 照常可用；把 CF DNS 记录关掉橙色云朵（DNS only）即回到原状，互不影响 |
| 推送功能异常 | 移除 env.local 里 VAPID 三行 → `pm2 reload dev-workbench-sync --update-env`，按钮回到「服务端未配置」，其余功能不受影响 |
| 想彻底换回纯 IP 访问 | 无需动任何代码，CF 侧删掉站点即可，源站从未被改过 |

**底线**：所有改动都在 CF 控制台 + 服务器配置文件层，代码零改动；源站 nginx 只可能动过 server_name / 跳转规则，均可用 `nginx -t` 校验后回滚。
