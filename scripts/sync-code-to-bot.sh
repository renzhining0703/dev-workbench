#!/usr/bin/env bash
#
# 本地代码镜像 → OpenClaw 机器人 workspace（供其 grep/阅读源码）
#
# 用法：
#   bash scripts/sync-code-to-bot.sh <本地项目路径> [更多项目路径...]
#
# 目标：root@211.159.169.153:/root/.openclaw/workspace/code/<项目名>/
# 说明：--delete + --delete-excluded 严格镜像（目标目录是纯镜像，机器人不得在其中
#       存放自己的文件；新加的排除规则也会把远端对应文件删掉）；
#       排除依赖/构建产物/git 历史/编辑器噪音，只同步源码。
set -euo pipefail

SERVER="root@211.159.169.153"
DEST_BASE="/root/.openclaw/workspace/code"

[ $# -ge 1 ] || { echo "用法: sync-code-to-bot.sh <项目路径> [更多项目路径...]"; exit 1; }

for PROJECT_DIR in "$@"; do
  PROJECT_DIR="${PROJECT_DIR%/}"
  NAME="$(basename "$PROJECT_DIR")"
  [ -d "$PROJECT_DIR" ] || { echo "✗ 目录不存在: $PROJECT_DIR"; exit 1; }

  echo ">>> 同步 $NAME → $DEST_BASE/$NAME"
  rsync -az --delete --delete-excluded \
    --exclude 'node_modules/' \
    --exclude 'dist/' \
    --exclude 't-dist/' \
    --exclude 'assets/' \
    --exclude '.git/' \
    --exclude '.npmrc' \
    --exclude '.DS_Store' \
    --exclude '.history/' \
    --exclude '.idea/' \
    --exclude '.vscode/' \
    --exclude '.eslintcache' \
    --exclude '.cache-loader/' \
    --exclude '*.log' \
    --exclude '*.png' \
    --exclude '*.gif' \
    --exclude '*.jpg' \
    --exclude '*.jpeg' \
    --exclude '*.webp' \
    --exclude '*.ico' \
    --exclude '*.svg' \
    --exclude '*.bmp' \
    --exclude '*.ttf' \
    --exclude '*.otf' \
    --exclude '*.woff' \
    --exclude '*.woff2' \
    --exclude '*.eot' \
    --exclude '*.mp4' \
    --exclude '*.mp3' \
    --exclude '*.pdf' \
    --exclude '*.zip' \
    --max-size=1m \
    "$PROJECT_DIR/" "$SERVER:$DEST_BASE/$NAME/"
  echo "✓ $NAME 同步完成"
done
