#!/usr/bin/env bash
# wb-admin-tree-sync.sh —— Mac 侧登录运营后台拉功能树，推送到 dev-workbench 供小朵搜索
# 背景: 服务器 IP 被运营后台 WAF 拦（130003），登录/拉树只能在本机宽带网络完成
# 用法: bash wb-admin-tree-sync.sh   （每日一次即可，缓存 TTL 24h）
# 凭据: 仅本脚本持有（也可后续迁移 wb-key.sh 机制），勿提交 git
set -euo pipefail

LOGIN_URL="https://t-api.zuifuli.com/api/admin/v2/login"
TREE_URL="https://t-api.zuifuli.com/api/admin/v1/secFunction/getAllFunctionTreeToJson"
LOGIN_NAME="linliming@baoyun.com"
PASSWD="Shyy_9033_tx"
HACE="934836"   # 登录风控固定参数（实测可长期复用）
REMOTE="dev-workbench:/root/.openclaw/workspace/data/zfl-admin-tree.json"

TMP_LOGIN=$(mktemp); TMP_TREE=$(mktemp); TMP_CJ=$(mktemp)
trap 'rm -f "$TMP_LOGIN" "$TMP_TREE" "$TMP_CJ"' EXIT

ENCODED_USER=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1],safe=''))" "$LOGIN_NAME")
curl -s --max-time 30 -c "$TMP_CJ" -X POST "$LOGIN_URL" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data "loginName=${ENCODED_USER}&passwd=${PASSWD}&hpvbeaFbjk=${HACE}" -o "$TMP_LOGIN"

if ! python3 -c "import json,sys; d=json.load(open(sys.argv[1])); assert d.get('code')=='0'" "$TMP_LOGIN"; then
  echo "ERR: 登录失败: $(head -c 200 "$TMP_LOGIN")" >&2
  exit 3
fi

curl -s --max-time 60 -b "$TMP_CJ" "$TREE_URL" -o "$TMP_TREE"
# 校验：数组 + 规模 >1000 节点（防拿到空树/伪 200）
python3 - "$TMP_TREE" << 'PYEOF'
import json, sys
d = json.load(open(sys.argv[1]))
assert isinstance(d, list) and len(d) >= 1
def count(ns): return sum(1 + count(n.get("children") or []) for n in ns)
assert count(d) > 1000, f"节点数异常: {count(d)}"
PYEOF

scp -q "$TMP_TREE" "$REMOTE"
echo "OK: 功能树已推送 $(date '+%F %T')（$(wc -c < "$TMP_TREE" | tr -d ' ') bytes）"
