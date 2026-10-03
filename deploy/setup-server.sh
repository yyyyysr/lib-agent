#!/usr/bin/env bash
# 在服务器上以 root 运行（deploy.sh 会自动调用）；可重复执行，已存在的证书、密钥与配置不会被覆盖。
#   sudo bash setup-server.sh <服务器公网 IP> [端口]
set -euo pipefail

PUBLIC_IP="${1:?用法：setup-server.sh <服务器公网 IP> [端口]}"
PORT="${2:-443}"
NODE_MAJOR=24
NODE_MIRROR="${NODE_MIRROR:-https://npmmirror.com/mirrors/node}"
APP_DIR=/opt/yiyeshuzhan
DATA_DIR=/var/lib/yiyeshuzhan
CONF_DIR=/etc/yiyeshuzhan
SERVICE_USER=yiyeshuzhan
HERE="$(cd "$(dirname "$0")" && pwd)"

log() { printf '\033[32m==>\033[0m %s\n' "$*"; }

# 1. Node.js（国内镜像，校验 SHA-256）
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt "$NODE_MAJOR" ]; then
  arch="$(uname -m)"
  case "$arch" in x86_64) arch=x64 ;; aarch64) arch=arm64 ;; *) echo "不支持的架构：$arch"; exit 1 ;; esac
  tmp="$(mktemp -d)"
  curl -fsSL "$NODE_MIRROR/latest-v$NODE_MAJOR.x/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
  file="$(grep -oE "node-v[0-9.]+-linux-$arch\.tar\.xz" "$tmp/SHASUMS256.txt" | head -1)"
  log "安装 Node.js：$file"
  curl -fsSL "$NODE_MIRROR/latest-v$NODE_MAJOR.x/$file" -o "$tmp/$file"
  (cd "$tmp" && grep " $file\$" SHASUMS256.txt | sha256sum -c -)
  rm -rf /opt/node && mkdir -p /opt/node
  tar -xJf "$tmp/$file" -C /opt/node --strip-components=1
  ln -sf /opt/node/bin/node /usr/local/bin/node
  rm -rf "$tmp"
fi
log "Node.js $(node -v)"

# 2. 服务账号与目录：数据目录只有服务账号可读写
id "${SERVICE_USER}" >/dev/null 2>&1 || useradd --system --home-dir "${DATA_DIR}" --shell /usr/sbin/nologin "${SERVICE_USER}"
install -d -m 755 "${APP_DIR}"
install -d -m 700 -o "${SERVICE_USER}" -g "${SERVICE_USER}" "${DATA_DIR}" "${DATA_DIR}/tls"
install -d -m 750 -o root -g "${SERVICE_USER}" "${CONF_DIR}"
install -m 644 "$HERE/server.mjs" "${APP_DIR}/server.mjs"

# 3. 自签名证书（没有域名时使用；客户端首次连接时核对指纹并固定这张证书）
if [ ! -f "${DATA_DIR}/tls/server.crt" ]; then
  log "生成自签名证书（IP：${PUBLIC_IP}，有效期 825 天）"
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 825 \
    -subj "/CN=yiyeshuzhan" -addext "subjectAltName=IP:${PUBLIC_IP}" \
    -keyout "${DATA_DIR}/tls/server.key" -out "${DATA_DIR}/tls/server.crt" 2>/dev/null
  chown "${SERVICE_USER}:${SERVICE_USER}" "${DATA_DIR}/tls/server.key" "${DATA_DIR}/tls/server.crt"
  chmod 600 "${DATA_DIR}/tls/server.key"
fi

# 4. 配置文件（只在不存在时写入，之后可手工修改）
if [ ! -f "${CONF_DIR}/server.env" ]; then
  cat > "${CONF_DIR}/server.env" <<EOF
YYS_DATA_DIR=$DATA_DIR
YYS_HOST=0.0.0.0
YYS_PORT=$PORT
YYS_SERVER_NAME=一页书展服务器
# 不设置 YYS_ADMIN_PASSWORD 时，首次启动随机生成并写入 ${DATA_DIR}/initial-admin-password.txt
EOF
  chown root:"${SERVICE_USER}" "${CONF_DIR}/server.env"
  chmod 640 "${CONF_DIR}/server.env"
fi

# 5. systemd 服务
install -m 644 "$HERE/yiyeshuzhan.service" /etc/systemd/system/yiyeshuzhan.service
systemctl daemon-reload
systemctl enable yiyeshuzhan >/dev/null
systemctl restart yiyeshuzhan

# 6. 本机防火墙（云服务器还需在控制台的防火墙 / 安全组中放行该端口）
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow "${PORT}/tcp" >/dev/null
fi

sleep 2
systemctl --no-pager --lines=0 status yiyeshuzhan | head -5
journalctl -u yiyeshuzhan --no-pager -n 20 | grep -E "已启动|证书指纹|错误|Error" || true
if [ -f "${DATA_DIR}/initial-admin-password.txt" ]; then
  echo "初始管理员密码保存在 ${DATA_DIR}/initial-admin-password.txt（sudo cat 查看，首次登录后会要求修改）"
fi
