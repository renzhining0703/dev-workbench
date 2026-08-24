#!/usr/bin/env bash
#
# 一键发布 dev-workbench 到服务器
#   用法：yarn pub
#
# 设计要点：
#   1. 本地先 npm run build（typecheck + 生产构建）
#   2. scp 上传到远端临时目录（不上传正式目录，避免中途失败导致 nginx 指向空目录）
#   3. 远端先把旧版 mv 到 .bak/dev-workbench-<时间戳>/ 备份，再 mv 临时目录为正式目录
#      （同文件系统 mv 是 rename(2) 原子操作，nginx 看到的要么是旧版要么是新版）
#   4. 自动清理过期备份，保留最近 KEEP_BACKUPS（默认 5）个
#
# 可通过环境变量覆盖默认值：
#   DEPLOY_SERVER       SSH 地址（默认 root@211.159.169.153）
#   DEPLOY_REMOTE_DIR   远端正式目录（默认 /var/www/dev-workbench）
#   DEPLOY_BAK_DIR      远端备份根目录（默认 /var/www/.bak）
#   KEEP_BACKUPS        保留几个历史版本（默认 5）
#

set -euo pipefail

# ---------- 配置 ----------
SERVER="${DEPLOY_SERVER:-root@211.159.169.153}"
REMOTE_DIR="${DEPLOY_REMOTE_DIR:-/var/www/dev-workbench}"
BAK_DIR="${DEPLOY_BAK_DIR:-/var/www/.bak}"
UPLOAD_DIR="$(dirname "$REMOTE_DIR")/.upload-dev-workbench"
KEEP_BACKUPS="${KEEP_BACKUPS:-5}"
LOCAL_DIST="${LOCAL_DIST:-./dist}"

# ---------- 颜色 ----------
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()   { echo -e "${YELLOW}>>>${NC} $*"; }
ok()    { echo -e "${GREEN}✓${NC} $*"; }
fail()  { echo -e "${RED}✗${NC} $*" >&2; exit 1; }

# ---------- 预检 ----------
[ -d node_modules ] || fail "未安装依赖，请先 npm install"
command -v ssh >/dev/null || fail "未找到 ssh，请确认 PATH 包含 OpenSSH 客户端"
command -v scp >/dev/null || fail "未找到 scp，请确认 PATH 包含 OpenSSH 客户端"

log "服务器:  $SERVER"
log "目标目录: $REMOTE_DIR"

# ---------- 1/4 类型检查 + 构建 ----------
log "1/4 类型检查 + 构建产物"
rm -rf "$LOCAL_DIST"
npm run build
[ -d "$LOCAL_DIST" ] || fail "构建失败，未生成 $LOCAL_DIST"
ok "构建完成: $(du -sh "$LOCAL_DIST" | cut -f1)"

# ---------- 2/4 准备远端临时目录并上传 ----------
log "2/4 上传产物到远端临时目录 $UPLOAD_DIR"
ssh "$SERVER" "rm -rf '$UPLOAD_DIR' && mkdir -p '$UPLOAD_DIR'"
scp -r "$LOCAL_DIST"/* "$SERVER:$UPLOAD_DIR/"
ok "上传完成"

# ---------- 3/4 备份旧版 + 原子替换 ----------
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_PATH="$BAK_DIR/dev-workbench-$TIMESTAMP"

log "3/4 备份旧版 + 原子替换"
ssh "$SERVER" "
  set -e
  mkdir -p '$BAK_DIR'
  if [ -d '$REMOTE_DIR' ]; then
    mv '$REMOTE_DIR' '$BACKUP_PATH'
  fi
  mv '$UPLOAD_DIR' '$REMOTE_DIR'
"
ok "旧版已备份到 $BACKUP_PATH"

# ---------- 4/4 清理过期备份 ----------
log "4/4 清理过期备份（保留最近 $KEEP_BACKUPS 个）"
ssh "$SERVER" "
  cd '$BAK_DIR'
  ls -1t | grep '^dev-workbench-' | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm -rf
"
ok "备份清理完成"

# ---------- 4.5/5 同步后端（独立部署在 /var/www/dev-workbench-sync/） ----------
SYNC_REMOTE_DIR="${SYNC_REMOTE_DIR:-/var/www/dev-workbench-sync}"
log "4.5/5 同步后端到 $SERVER:$SYNC_REMOTE_DIR"

# 检查本地 server/ 是否存在
[ -d server ] || fail "本地 server/ 目录不存在"

# 远端临时目录 + 原子替换（与前端同样的 mv-replace 模式）
SYNC_UPLOAD_DIR="$(dirname "$SYNC_REMOTE_DIR")/.upload-dev-workbench-sync"
SYNC_BAK_DIR="${SYNC_BAK_DIR:-/var/www/.bak-sync}"

# 把 server/ 内容打到压缩包上传，再远端解压
# v2：node_modules（express 等纯 JS 依赖）一并打包——服务器零安装零编译；
#     远端 npm install 仅作依赖漂移兜底（失败不影响启动）
#
# ⚠️ 排除模式必须匹配打包后的相对路径（./data），带 server/ 前缀的旧写法
#    在 -C server . 模式下不生效——v1 曾因此把本地 data/ 一起上传并覆盖生产数据
TMP_TGZ="$(mktemp -t dev-workbench-sync.XXXXXX.tar.gz)"
trap 'rm -f "$TMP_TGZ"' EXIT

[ -d server/node_modules ] || fail "server/node_modules 不存在，请先在 server/ 下 npm install"

tar --exclude='data' --exclude='*.log' --exclude='.git' -czf "$TMP_TGZ" -C server .
# 部署包里绝不允许出现用户数据
if tar -tzf "$TMP_TGZ" | grep -qE '^\./data/'; then
  fail "部署包中混入了 data/ 用户数据，已中止"
fi

ssh "$SERVER" "rm -rf '$SYNC_UPLOAD_DIR' && mkdir -p '$SYNC_UPLOAD_DIR'"
scp "$TMP_TGZ" "$SERVER:$SYNC_UPLOAD_DIR/sync.tar.gz"
ssh "$SERVER" "
  set -e
  mkdir -p '$SYNC_BAK_DIR'
  if [ -d '$SYNC_REMOTE_DIR' ]; then
    rm -rf '$SYNC_BAK_DIR/.latest'
    mv '$SYNC_REMOTE_DIR' '$SYNC_BAK_DIR/.latest'
  fi
  mkdir -p '$SYNC_REMOTE_DIR'
  # 生产数据（v1 JSON / v2 SQLite）不在部署包里——从旧目录原样带回，跨版本保留
  if [ -d '$SYNC_BAK_DIR/.latest/data' ]; then
    cp -a '$SYNC_BAK_DIR/.latest/data' '$SYNC_REMOTE_DIR/data'
  fi
  tar -xzf '$SYNC_UPLOAD_DIR/sync.tar.gz' -C '$SYNC_REMOTE_DIR'
  rm -rf '$SYNC_UPLOAD_DIR'
  # node_modules 已随包携带（纯 JS）；npm install 仅作兜底，失败不影响启动
  if [ -f '$SYNC_REMOTE_DIR/package.json' ]; then
    (cd '$SYNC_REMOTE_DIR' && npm install --omit=dev --no-audit --no-fund) || true
  fi
  # pm2 reload / start
  if [ -f '$SYNC_REMOTE_DIR/ecosystem.config.cjs' ]; then
    cd '$SYNC_REMOTE_DIR'
    pm2 reload ecosystem.config.cjs --update-env 2>/dev/null || pm2 start ecosystem.config.cjs
    pm2 save 2>/dev/null || true
  fi
"
ok "同步后端部署完成"
# 不清空 SYNC_BAK_DIR/.latest：万一新版本启动失败，可手动回滚

# ---------- 完成 ----------
echo ""
echo -e "${GREEN}==============================${NC}"
echo -e "${GREEN}  部署成功${NC}"
echo -e "${GREEN}==============================${NC}"
echo -e "  前端 URL: ${GREEN}http://211.159.169.153/dev-workbench/${NC}"
echo -e "  后端 URL: ${GREEN}http://211.159.169.153/dev-workbench/api/${NC}"
echo -e "  前端备份: ${YELLOW}$BACKUP_PATH${NC}"
echo -e "  回滚:    ssh $SERVER 'mv $BACKUP_PATH $REMOTE_DIR'"