# 只读探针：自研前端 + 面板 + 各架构 Agent 一次构建
# 构建：docker build -t nezha-ro .
FROM --platform=$BUILDPLATFORM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web ./
RUN npm run build

FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS build
RUN apk add --no-cache git
WORKDIR /src
ARG VERSION=1.0.0-ro
ARG TARGETOS=linux
ARG TARGETARCH
ENV CGO_ENABLED=0 GOFLAGS=-trimpath

# 依赖层缓存
COPY dashboard/go.mod dashboard/go.sum ./dashboard/
COPY agent/go.mod agent/go.sum ./agent/
RUN cd dashboard && go mod download && cd ../agent && go mod download
RUN go install github.com/swaggo/swag/cmd/swag@v1.16.6

COPY dashboard ./dashboard
COPY agent ./agent
COPY deploy ./deploy

# 自研前端（web/）同时作为前台与后台：同一份产物放进 user-dist 与 admin-dist
COPY --from=web /web/dist ./web-dist
RUN cd dashboard/cmd/dashboard && rm -rf user-dist admin-dist && cp -r /src/web-dist user-dist && cp -r /src/web-dist admin-dist
RUN cd dashboard && swag init --pd -d cmd/dashboard -g main.go -o cmd/dashboard/docs
RUN cd dashboard && GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -ldflags "-s -w -X github.com/nezhahq/nezha/service/singleton.Version=${VERSION}" -o /out/app ./cmd/dashboard

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
