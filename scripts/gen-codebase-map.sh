#!/usr/bin/env bash
#
# 代码库知识生成器：扫描本地前端项目 → 生成三层知识结构（供 OpenClaw 机器人消费）
#
# 用法：
#   bash scripts/gen-codebase-map.sh <项目本地路径> <输出目录> [聚焦模块名,逗号分隔]
#
# 输出（<输出目录>/ 下）：
#   codebase-map.md                    # 总索引（追加式，重复生成不覆盖其它项目条目）
#   <项目名>/structure.md              # 目录树 + 技术栈 + 模块清单
#   <项目名>/CLAUDE.md                 # 项目自带约定（如有，原样复制）
#   <项目名>/modules/<模块>.md         # 聚焦模块的骨架（含 TODO 待补业务口径）
#
# 设计边界：只沉淀结构元信息（目录/文件名/技术栈），不拷贝业务源码内容。
set -euo pipefail

PROJECT_DIR="${1:?用法: gen-codebase-map.sh <项目路径> <输出目录> [聚焦模块]}"
OUT_DIR="${2:?缺少输出目录}"
FOCUS="${3:-}"

PROJECT_DIR="${PROJECT_DIR%/}"
PROJECT_NAME="$(basename "$PROJECT_DIR")"
TARGET="$OUT_DIR/$PROJECT_NAME"
mkdir -p "$TARGET/modules"

TREE_EXCLUDES='-name node_modules -o -name dist -o -name t-dist -o -name .git -o -name assets -o -name images -o -name yarn.lock -o -name package-lock.json'

# ---------- structure.md ----------
{
  echo "# $PROJECT_NAME — 结构速览"
  echo
  echo "- 本地路径: \`$PROJECT_DIR\`"
  echo "- 生成时间: $(date '+%Y-%m-%d %H:%M')"
  echo
  echo "## 技术栈（package.json）"
  echo '```json'
  node -e "
const p = require('$PROJECT_DIR/package.json');
console.log(JSON.stringify({ name: p.name, scripts: p.scripts, deps: Object.keys(p.dependencies ?? {}) }, null, 1));
" 2>/dev/null || echo '(package.json 解析失败)'
  echo '```'
  echo
  echo "## 根目录（1 层）"
  echo '```'
  eval find "'$PROJECT_DIR'" -maxdepth 1 -not -path "'$PROJECT_DIR'" \| sort | sed "s|$PROJECT_DIR/||"
  echo '```'
  echo
  echo "## 业务模块清单（src/*/index 入口，即 publishModule 口径）"
  echo
  echo "| 模块 | 说明 |"
  echo "| --- | --- |"
  for d in "$PROJECT_DIR"/src/*/; do
    m="$(basename "$d")"
    has_entry=" "
    for ext in js jsx ts tsx; do
      [ -f "$d/index.$ext" ] && has_entry="✓" && break
    done
    echo "| $m | $has_entry |"
  done
  echo
  echo "> ✓ = 独立打包入口；空 = 共享层（components/lib/utils/hooks 等非入口目录）"
  echo
  echo "## 目录树（2 层，已排除 node_modules/dist 等噪音）"
  echo '```'
  eval find "'$PROJECT_DIR/src'" -maxdepth 2 -not -path "'*/node_modules*'" -not -path "'*/dist*'" -not -name ".DS_Store" -type d 2>/dev/null \| sort | sed "s|$PROJECT_DIR/||"
  echo '```'
} > "$TARGET/structure.md"

# ---------- 项目自有约定 ----------
if [ -f "$PROJECT_DIR/CLAUDE.md" ]; then
  cp "$PROJECT_DIR/CLAUDE.md" "$TARGET/CLAUDE.md"
fi

# ---------- 聚焦模块骨架 ----------
if [ -n "$FOCUS" ]; then
  IFS=',' read -ra MODS <<< "$FOCUS"
  for m in "${MODS[@]}"; do
    d="$PROJECT_DIR/src/$m"
    [ -d "$d" ] || continue
    # 护栏：modules/*.md 可能已被机器人填充业务口径（TODO 区），已存在则跳过不覆盖
    if [ -f "$TARGET/modules/$m.md" ]; then
      echo "  - 跳过 modules/$m.md（已存在，保留人工/机器人内容）"
      continue
    fi
    {
      echo "# 模块: ${m} - ${PROJECT_NAME}"
      echo
      echo "> TODO(待确认)：本模块的业务口径、改动点提示由人工/机器人补充，以下是自动扫描部分。"
      echo
      echo "## 目录结构"
      echo '```'
      eval find "'$d'" -maxdepth 2 -not -path "'*/node_modules*'" -not -name ".DS_Store" 2>/dev/null \| sort | sed "s|$PROJECT_DIR/||"
      echo '```'
      echo
      echo "## 关键文件"
      echo '```'
      for f in "$d"/index.* "$d"/routes.* "$d"/App.* "$d"/README.md; do
        [ -f "$f" ] && echo "${f#$PROJECT_DIR/}"
      done
      echo '```'
    } > "$TARGET/modules/$m.md"
  done
fi

# ---------- 总索引（追加式） ----------
MAP="$OUT_DIR/codebase-map.md"
if [ ! -f "$MAP" ]; then
  { echo "# 代码库总索引"; echo; echo "| 项目 | 本地路径 | 知识文件 | 更新时间 |"; echo "| --- | --- | --- | --- |"; } > "$MAP"
fi
if ! grep -q "^\| $PROJECT_NAME " "$MAP"; then
  echo "| $PROJECT_NAME | \`$PROJECT_DIR\` | [$PROJECT_NAME/structure.md]($PROJECT_NAME/structure.md) | $(date '+%Y-%m-%d') |" >> "$MAP"
fi

echo "✓ 已生成 ${TARGET}（structure.md + modules）"
