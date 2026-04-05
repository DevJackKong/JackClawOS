#!/usr/bin/env bash
# prepublish-check.sh — npm publish 预检脚本
# 用法: ./scripts/prepublish-check.sh
# 检查项: build → test → pack dry-run → dist 验证 → 依赖图

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# 公开包列表（排除 dashboard / pwa）
PUBLIC_PKGS=(
  cli
  create-jackclaw
  harness
  hub
  jackclaw-sdk
  llm-gateway
  memory
  node
  openclaw-plugin
  payment-vault
  protocol
  tunnel
  watchdog
)

PASS=0
FAIL=0
WARNINGS=()
ERRORS=()

# ─── 颜色 ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}✓${NC} $1"; PASS=$((PASS+1)); }
fail() { echo -e "  ${RED}✗${NC} $1"; ERRORS+=("$1"); FAIL=$((FAIL+1)); }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; WARNINGS+=("$1"); }
header() { echo -e "\n${BOLD}${CYAN}▶ $1${NC}"; }

# ─── 1. Build ────────────────────────────────────────────────────────────────
header "Step 1: Build (npm run build)"
if npm run build --silent 2>&1; then
  ok "Build succeeded"
else
  fail "Build failed"
  echo -e "${RED}Build errors block further checks — aborting.${NC}"
  exit 1
fi

# ─── 2. Tests ────────────────────────────────────────────────────────────────
header "Step 2: Tests (npm test)"
if npm test --silent 2>&1; then
  ok "All tests passed"
else
  fail "Test suite failed"
fi

# ─── 3. Per-package checks ───────────────────────────────────────────────────
header "Step 3: Per-package dist + pack dry-run"

for pkg in "${PUBLIC_PKGS[@]}"; do
  pkg_dir="$ROOT/packages/$pkg"
  pkg_name=$(node -e "process.stdout.write(require('$pkg_dir/package.json').name)" 2>/dev/null || echo "$pkg")
  echo -e "\n  ${BOLD}[$pkg_name]${NC}"

  # 3a. dist/ 目录存在
  if [[ ! -d "$pkg_dir/dist" ]]; then
    fail "$pkg: dist/ 目录不存在"
    continue
  fi

  # 3b. dist/ 下有 .js 文件
  js_count=$(find "$pkg_dir/dist" -name "*.js" | wc -l | tr -d ' ')
  if [[ "$js_count" -eq 0 ]]; then
    fail "$pkg: dist/ 下没有 .js 文件"
  else
    ok "$pkg: dist/ 有 ${js_count} 个 .js 文件"
  fi

  # 3c. main 入口文件存在
  main_file=$(node -e "process.stdout.write(require('$pkg_dir/package.json').main || '')" 2>/dev/null || true)
  if [[ -n "$main_file" ]]; then
    if [[ -f "$pkg_dir/$main_file" ]]; then
      ok "$pkg: main 入口 ($main_file) 存在"
    else
      fail "$pkg: main 入口 ($main_file) 不存在"
    fi
  else
    warn "$pkg: package.json 没有 main 字段"
  fi

  # 3d. npm pack --dry-run
  pack_output=$(npm pack --dry-run --workspace="packages/$pkg" 2>&1)
  if echo "$pack_output" | grep -q "total files"; then
    file_count=$(echo "$pack_output" | grep "total files" | grep -oE '[0-9]+' | head -1)
    pkg_size=$(echo "$pack_output" | grep "package size" | awk '{print $NF, $(NF-1)}' | head -1)
    ok "$pkg: pack dry-run OK — ${file_count} 文件, ${pkg_size}"
  else
    fail "$pkg: pack dry-run 失败"
    echo "$pack_output" | tail -5
  fi
done

# ─── 4. 依赖关系检查 ─────────────────────────────────────────────────────────
header "Step 4: 包间依赖关系验证"

check_dep() {
  local pkg=$1
  local dep=$2
  local pkg_json="$ROOT/packages/$pkg/package.json"
  if node -e "
    const d = require('$pkg_json');
    const all = Object.assign({}, d.dependencies, d.peerDependencies);
    process.exit(all['$dep'] ? 0 : 1);
  " 2>/dev/null; then
    ok "$pkg → $dep ✓"
  else
    fail "$pkg 缺少对 $dep 的依赖声明"
  fi
}

# @jackclaw/protocol 应被以下包依赖
for pkg in cli hub node harness openclaw-plugin payment-vault; do
  check_dep "$pkg" "@jackclaw/protocol"
done

# workspace:* 引用检查（发布前应为实际版本号）
echo ""
ws_star_found=false
for pkg in "${PUBLIC_PKGS[@]}"; do
  pkg_json="$ROOT/packages/$pkg/package.json"
  if grep -q '"workspace:' "$pkg_json" 2>/dev/null; then
    warn "$pkg: package.json 含 workspace:* 引用（发布前需替换为实际版本）"
    ws_star_found=true
  fi
done
if ! $ws_star_found; then
  ok "所有包：无 workspace:* 引用（版本号已固定）"
fi

# ─── 5. 汇总报告 ─────────────────────────────────────────────────────────────
echo -e "\n${BOLD}═══════════════════════════════════════${NC}"
echo -e "${BOLD}发布预检汇总${NC}"
echo -e "${BOLD}═══════════════════════════════════════${NC}"
echo -e "  ${GREEN}通过: $PASS${NC}"
echo -e "  ${RED}失败: $FAIL${NC}"
echo -e "  ${YELLOW}警告: ${#WARNINGS[@]}${NC}"

if [[ ${#ERRORS[@]} -gt 0 ]]; then
  echo -e "\n${RED}${BOLD}错误列表:${NC}"
  for e in "${ERRORS[@]}"; do
    echo -e "  ${RED}✗${NC} $e"
  done
fi

if [[ ${#WARNINGS[@]} -gt 0 ]]; then
  echo -e "\n${YELLOW}${BOLD}警告列表:${NC}"
  for w in "${WARNINGS[@]}"; do
    echo -e "  ${YELLOW}⚠${NC} $w"
  done
fi

echo ""
if [[ "$FAIL" -eq 0 ]]; then
  echo -e "${GREEN}${BOLD}✓ 预检通过，可以发布！${NC}"
  echo -e "  运行: ${CYAN}npm run publish:dry${NC}  （演练）"
  echo -e "  运行: ${CYAN}npm run publish:live${NC} （正式发布）"
  exit 0
else
  echo -e "${RED}${BOLD}✗ 预检失败，请修复上述问题后再发布。${NC}"
  exit 1
fi
