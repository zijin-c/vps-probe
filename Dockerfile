# 只读探针：面板 + 各架构 Agent 一次构建
# 构建：docker build -t nezha-ro .
FROM golang:1.26-alpine AS build
RUN apk add --no-cache bash curl unzip yq git
WORKDIR /src
ARG VERSION=1.0.0-ro
ENV CGO_ENABLED=0 GOFLAGS=-trimpath

# 依赖层缓存
COPY dashboard/go.mod dashboard/go.sum ./dashboard/
COPY agent/go.mod agent/go.sum ./agent/
RUN cd dashboard && go mod download && cd ../agent && go mod download
RUN go install github.com/swaggo/swag/cmd/swag@v1.16.6

COPY dashboard ./dashboard
COPY agent ./agent
COPY deploy ./deploy

# 官方预编译前端（用户前台 + 管理后台），版本见 dashboard/service/singleton/frontend-templates.yaml
RUN cd dashboard && rm -rf cmd/dashboard/*-dist && bash script/fetch-frontends.sh
RUN cd dashboard && swag init --pd -d cmd/dashboard -g main.go -o cmd/dashboard/docs
RUN cd dashboard && go build -ldflags "-s -w -X github.com/nezhahq/nezha/service/singleton.Version=${VERSION}" -o /out/app ./cmd/dashboard

RUN mkdir -p /out/agent-dist && cd agent && \
    for a in amd64 arm64 386; do \
      GOOS=linux GOARCH=$a go build -ldflags "-s -w -X main.arch=$a -X github.com/nezhahq/agent/pkg/monitor.Version=${VERSION}" \
        -o /out/agent-dist/nezha-agent-linux-$a ./cmd/agent; \
    done && \
    GOOS=linux GOARCH=arm GOARM=7 go build -ldflags "-s -w -X main.arch=arm -X github.com/nezhahq/agent/pkg/monitor.Version=${VERSION}" \
      -o /out/agent-dist/nezha-agent-linux-armv7 ./cmd/agent && \
    cp ../deploy/install.sh /out/agent-dist/install.sh

FROM alpine:3.22
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /dashboard
COPY --from=build /out/app ./app
COPY --from=build /out/agent-dist ./agent-dist
ENV TZ=Asia/Shanghai PROBE_AGENT_DIR=/dashboard/agent-dist
VOLUME ["/dashboard/data"]
EXPOSE 8008
CMD ["./app"]
