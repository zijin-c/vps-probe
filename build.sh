#!/usr/bin/env bash
# 不用 Docker 时的本地构建：产物在 dist/
#   dist/app-linux-amd64          面板
#   dist/agent-dist/*             各架构 Agent + install.sh（把整个目录放到面板工作目录下）
# 依赖：go 1.26+、curl、unzip、yq（拉取官方前端）
set -euo pipefail
cd "$(dirname "$0")"
VERSION="${VERSION:-1.0.0-ro}"
export CGO_ENABLED=0 GOFLAGS=-trimpath
mkdir -p dist/agent-dist

(
  cd dashboard
  if [ ! -f cmd/dashboard/user-dist/index.html ]; then bash script/fetch-frontends.sh; fi
  command -v swag >/dev/null || go install github.com/swaggo/swag/cmd/swag@v1.16.6
  "$(go env GOPATH)/bin/swag" init --pd -d cmd/dashboard -g main.go -o cmd/dashboard/docs >/dev/null
  for a in amd64 arm64; do
    GOOS=linux GOARCH=$a go build -ldflags "-s -w -X github.com/nezhahq/nezha/service/singleton.Version=$VERSION" \
      -o ../dist/app-linux-$a ./cmd/dashboard
  done
)

(
  cd agent
  for a in amd64 arm64 386; do
    GOOS=linux GOARCH=$a go build -ldflags "-s -w -X main.arch=$a -X github.com/nezhahq/agent/pkg/monitor.Version=$VERSION" \
      -o ../dist/agent-dist/nezha-agent-linux-$a ./cmd/agent
  done
  GOOS=linux GOARCH=arm GOARM=7 go build -ldflags "-s -w -X main.arch=arm -X github.com/nezhahq/agent/pkg/monitor.Version=$VERSION" \
    -o ../dist/agent-dist/nezha-agent-linux-armv7 ./cmd/agent
)
cp deploy/install.sh dist/agent-dist/install.sh
ls -lh dist dist/agent-dist
