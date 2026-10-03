#!/usr/bin/env bash
# 在开发机上运行：打包服务器并部署到远程主机。
#   deploy/deploy.sh <用户@服务器IP> [端口]
# 需要已配置 SSH 公钥登录、远程账号有 sudo 权限；SSH 私钥可用 YYS_SSH_KEY 指定。
set -euo pipefail

TARGET="${1:?用法：deploy/deploy.sh <用户@服务器IP> [端口]}"
PORT="${2:-443}"
HOST="${TARGET#*@}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SSH_OPTS=(-o BatchMode=yes -o StrictHostKeyChecking=accept-new)
[ -n "${YYS_SSH_KEY:-}" ] && SSH_OPTS+=(-i "$YYS_SSH_KEY")

echo "==> 打包服务器"
pnpm --dir "$ROOT" --filter @yys/server build >/dev/null

echo "==> 上传到 ${TARGET}"
STAGE="/tmp/yiyeshuzhan-deploy"
ssh "${SSH_OPTS[@]}" "${TARGET}" "rm -rf $STAGE && mkdir -p $STAGE"
scp -q "${SSH_OPTS[@]}" "$ROOT/apps/server/dist/server.mjs" "$ROOT/deploy/setup-server.sh" \
  "$ROOT/deploy/yiyeshuzhan.service" "${TARGET}:$STAGE/"

echo "==> 安装并启动"
ssh "${SSH_OPTS[@]}" "${TARGET}" "sudo bash $STAGE/setup-server.sh ${HOST} ${PORT} && rm -rf $STAGE"

echo "==> 检查端口"
URL="https://${HOST}$([ "${PORT}" = 443 ] || echo ":${PORT}")"
if curl -sk --max-time 10 "${URL}/api/info"; then
  echo
  echo "部署完成：在客户端“连接设置”中填写 ${URL}，并核对上面输出的证书指纹。"
else
  echo "服务器已启动，但从这里访问不到 ${URL}：请在云服务器控制台的防火墙 / 安全组中放行 TCP ${PORT}。"
fi
