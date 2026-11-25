#!/bin/sh
# 只读探针 Agent 安装脚本
# 用法：
#   curl -fsSL https://面板域名/probe/agent/install.sh | sudo sh -s -- \
#     --panel https://面板域名 --server 面板域名:443 --secret 面板的agent_secret_key [--tls] [--uuid 自定义UUID]
# 卸载：
#   curl -fsSL https://面板域名/probe/agent/install.sh | sudo sh -s -- --uninstall
set -eu

PANEL="" SERVER="" SECRET="" TLS="false" UUID="" UNINSTALL=0
DIR=/opt/nezha-ro
UNIT=/etc/systemd/system/nezha-ro-agent.service

while [ $# -gt 0 ]; do
  case "$1" in
    --panel) PANEL="$2"; shift 2 ;;
    --server) SERVER="$2"; shift 2 ;;
    --secret) SECRET="$2"; shift 2 ;;
    --uuid) UUID="$2"; shift 2 ;;
    --tls) TLS="true"; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    *) echo "未知参数: $1"; exit 1 ;;
  esac
done

[ "$(id -u)" = "0" ] || { echo "请用 root 运行"; exit 1; }

if [ "$UNINSTALL" = 1 ]; then
  systemctl disable --now nezha-ro-agent 2>/dev/null || true
  rm -f "$UNIT"; systemctl daemon-reload 2>/dev/null || true
  rm -rf "$DIR"
  echo "已卸载"; exit 0
fi

[ -n "$PANEL" ] && [ -n "$SERVER" ] && [ -n "$SECRET" ] || { echo "缺少 --panel / --server / --secret"; exit 1; }
command -v systemctl >/dev/null || { echo "需要 systemd"; exit 1; }

case "$(uname -m)" in
  x86_64|amd64) ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  armv7*|armv8l) ARCH=armv7 ;;
  i386|i686) ARCH=386 ;;
  *) echo "不支持的架构: $(uname -m)"; exit 1 ;;
esac

mkdir -p "$DIR"
URL="${PANEL%/}/probe/agent/nezha-agent-linux-$ARCH"
echo "下载 $URL"
if command -v curl >/dev/null; then curl -fL --retry 3 -o "$DIR/agent.new" "$URL"
else wget -O "$DIR/agent.new" "$URL"; fi
chmod 755 "$DIR/agent.new"
"$DIR/agent.new" -v >/dev/null 2>&1 || { echo "下载的文件无法运行"; rm -f "$DIR/agent.new"; exit 1; }
mv -f "$DIR/agent.new" "$DIR/agent"

if [ -z "$UUID" ]; then
  if [ -f "$DIR/config.yml" ] && grep -q '^uuid:' "$DIR/config.yml"; then
    UUID=$(sed -n 's/^uuid: *//p' "$DIR/config.yml")
  else
    UUID=$(cat /proc/sys/kernel/random/uuid)
  fi
fi

umask 077
cat > "$DIR/config.yml" <<EOF
server: $SERVER
client_secret: $SECRET
uuid: $UUID
tls: $TLS
# 以下开关在本分支中已被代码硬性禁用，这里再写一遍作为双保险
disable_auto_update: true
disable_force_update: true
disable_command_execute: true
disable_nat: true
EOF

cat > "$UNIT" <<EOF
[Unit]
Description=Nezha read-only probe agent
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=$DIR/agent -c $DIR/config.yml
Restart=always
RestartSec=5
# 需要 root 才能做 ICMP ping 和读取部分硬件信息；以下限制它写系统文件
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=$DIR
PrivateTmp=true
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now nezha-ro-agent
systemctl restart nezha-ro-agent
echo "安装完成，UUID: $UUID"
echo "查看日志: journalctl -u nezha-ro-agent -f"
