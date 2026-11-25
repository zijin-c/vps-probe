#!/bin/sh
# 只读版哪吒探针（vps-probe / nezha-ro）面板一键部署脚本
# 用法：
#   安装 / 更新：
#     curl -fsSL https://raw.githubusercontent.com/zijin-c/vps-probe/main/deploy/panel.sh | sudo sh
#   自定义端口与目录：
#     curl -fsSL https://raw.githubusercontent.com/zijin-c/vps-probe/main/deploy/panel.sh | sudo sh -s -- --port 8008 --dir /opt/vps-probe
#   卸载（保留 data 数据目录）：
#     curl -fsSL https://raw.githubusercontent.com/zijin-c/vps-probe/main/deploy/panel.sh | sudo sh -s -- --uninstall
set -eu

REPO="${REPO:-https://github.com/zijin-c/vps-probe.git}"
BRANCH="${BRANCH:-main}"
DIR="/opt/vps-probe"
PORT="8008"
UNINSTALL=0

while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DIR="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    --uninstall) UNINSTALL=1; shift ;;
    *) echo "未知参数: $1"; exit 1 ;;
  esac
done

[ "$(id -u)" = "0" ] || { echo "请使用 root 权限运行（例如加 sudo）"; exit 1; }

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
  else
    echo "未找到 docker compose，请先安装 Docker Compose 插件" >&2
    exit 1
  fi
}

if [ "$UNINSTALL" = 1 ]; then
  if [ -d "$DIR" ]; then
    cd "$DIR"
    compose down 2>/dev/null || true
  fi
  echo "面板容器已停止并移除。数据目录仍保留在 $DIR/data，如需彻底删除请手动执行: rm -rf $DIR"
  exit 0
fi

# 检查并安装 git
if ! command -v git >/dev/null 2>&1; then
  echo ">>> 未检测到 git，尝试自动安装..."
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -y && apt-get install -y git curl ca-certificates
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y git curl ca-certificates
  elif command -v yum >/dev/null 2>&1; then
    yum install -y git curl ca-certificates
  elif command -v apk >/dev/null 2>&1; then
    apk add --no-cache git curl ca-certificates
  else
    echo "请先手动安装 git 后重试" >&2
    exit 1
  fi
fi

# 检查并安装 Docker
if ! command -v docker >/dev/null 2>&1; then
  echo ">>> 未检测到 Docker，正在通过官方脚本安装..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker 2>/dev/null || true
fi

# 拉取或更新仓库
if [ -d "$DIR/.git" ]; then
  echo ">>> 检测到已有安装，拉取最新代码 ($DIR)..."
  cd "$DIR"
  git fetch origin "$BRANCH"
  git checkout "$BRANCH"
  git reset --hard "origin/$BRANCH"
else
  echo ">>> 克隆仓库到 $DIR..."
  mkdir -p "$(dirname "$DIR")"
  git clone --depth 1 -b "$BRANCH" "$REPO" "$DIR"
  cd "$DIR"
fi

# 自定义端口（仅在非默认 8008 时覆写映射）
if [ "$PORT" != "8008" ]; then
  sed -i "s/\"8008:8008\"/\"${PORT}:8008\"/" docker-compose.yml
fi

echo ">>> 开始构建并启动面板（首次构建需编译 Go 与前端，约 1~3 分钟）..."
compose up -d --build

IP=$(curl -fsS --max-time 4 https://api.ipify.org 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || echo "你的服务器IP")

echo ""
echo "=========================================="
echo "  只读版哪吒探针面板部署完成！"
echo "  前台地址: http://${IP}:${PORT}"
echo "  管理后台: http://${IP}:${PORT}/dashboard"
echo "  默认账号: admin / admin（请登录后立即修改）"
echo "  安装目录: ${DIR}"
echo "  数据目录: ${DIR}/data"
echo "=========================================="
echo "提示：建议前面套 Nginx / Caddy 反代开启 HTTPS（需启用 HTTP/2 / gRPC）。"
