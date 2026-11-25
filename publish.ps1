# 本地一键编译（前端 + Linux amd64/arm64 面板 + 全架构 Agent）并上传到 GitHub Release (latest)
# 用法：在项目根目录执行 .\publish.ps1
# 耗时约 20~30 秒，上传完成后 VPS 端跑一键部署命令即可秒级更新！
param(
  [string]$Version = "1.0.0-ro",
  [string]$Tag = "latest",
  [string]$Repo = "zijin-c/vps-probe"
)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$OutDir = Join-Path $Root "dist\release"
$AgentOut = Join-Path $OutDir "agent-dist"

if (Test-Path $OutDir) { Remove-Item -Recurse -Force $OutDir }
New-Item -ItemType Directory -Force -Path $AgentOut | Out-Null

Write-Host ">>> [1/4] 编译前端 (web)..." -ForegroundColor Cyan
Push-Location (Join-Path $Root "web")
try {
  if (-not (Test-Path "node_modules")) { npm ci --no-audit --no-fund }
  npm run build
} finally { Pop-Location }

foreach ($d in @("user-dist", "admin-dist")) {
  $dst = Join-Path $Root "dashboard\cmd\dashboard\$d"
  if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }
  Copy-Item -Recurse (Join-Path $Root "web\dist") $dst
  # 保留 .gitkeep 避免污染 git status
  New-Item -ItemType File -Force -Path (Join-Path $dst ".gitkeep") | Out-Null
}

Write-Host ">>> [2/4] 交叉编译 Linux 面板 (amd64 / arm64)..." -ForegroundColor Cyan
$env:CGO_ENABLED = "0"
$env:GOFLAGS = "-trimpath"
$env:GOOS = "linux"
Push-Location (Join-Path $Root "dashboard")
try {
  foreach ($arch in @("amd64", "arm64")) {
    $env:GOARCH = $arch
    $env:GOARM = ""
    $out = Join-Path $OutDir "dashboard-linux-$arch"
    Write-Host "    - dashboard-linux-$arch"
    go build -ldflags "-s -w -X github.com/nezhahq/nezha/service/singleton.Version=$Version" -o $out ./cmd/dashboard
  }
} finally { Pop-Location }

Write-Host ">>> [3/4] 交叉编译只读 Agent (amd64 / arm64 / 386 / armv7)..." -ForegroundColor Cyan
Push-Location (Join-Path $Root "agent")
try {
  foreach ($arch in @("amd64", "arm64", "386")) {
    $env:GOARCH = $arch
    $env:GOARM = ""
    $out = Join-Path $AgentOut "nezha-agent-linux-$arch"
    Write-Host "    - nezha-agent-linux-$arch"
    go build -ldflags "-s -w -X main.arch=$arch -X github.com/nezhahq/agent/pkg/monitor.Version=$Version" -o $out ./cmd/agent
  }
  $env:GOARCH = "arm"
  $env:GOARM = "7"
  $out = Join-Path $AgentOut "nezha-agent-linux-armv7"
  Write-Host "    - nezha-agent-linux-armv7"
  go build -ldflags "-s -w -X main.arch=arm -X github.com/nezhahq/agent/pkg/monitor.Version=$Version" -o $out ./cmd/agent
} finally {
  Pop-Location
  Remove-Item Env:GOOS, Env:GOARCH, Env:GOARM, Env:CGO_ENABLED, Env:GOFLAGS -ErrorAction SilentlyContinue
}

Copy-Item (Join-Path $Root "deploy\install.sh") (Join-Path $AgentOut "install.sh")
$AgentTar = Join-Path $OutDir "agent-dist.tar.gz"
tar -czf $AgentTar -C $OutDir agent-dist

Write-Host ">>> [4/4] 上传产物到 GitHub Release ($Tag)..." -ForegroundColor Cyan
$Assets = @(
  (Join-Path $OutDir "dashboard-linux-amd64"),
  (Join-Path $OutDir "dashboard-linux-arm64"),
  $AgentTar
)

$prevPref = $ErrorActionPreference
$ErrorActionPreference = "Continue"
gh release view $Tag --repo $Repo *> $null
$exists = ($LASTEXITCODE -eq 0)
$ErrorActionPreference = $prevPref

if (-not $exists) {
  gh release create $Tag @Assets --repo $Repo --title "Latest Prebuilt ($Version)" --notes "本地预编译产物（amd64/arm64 面板 + 全架构只读 Agent），供 deploy/panel.sh 秒级部署。"
} else {
  gh release upload $Tag @Assets --repo $Repo --clobber
}
if ($LASTEXITCODE -ne 0) { throw "GitHub Release 上传失败 (exit $LASTEXITCODE)" }

Write-Host ""
Write-Host "发布完成！VPS 上执行以下命令即可秒级更新：" -ForegroundColor Green
Write-Host "  curl -fsSL https://raw.githubusercontent.com/$Repo/main/deploy/panel.sh | sh" -ForegroundColor Yellow
