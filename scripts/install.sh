#!/bin/bash
# =============================================================================
# JackClaw One-Click Installer — Interactive Setup Wizard
# Usage: curl -fsSL https://jackclaw.dev/install | bash
#        OR: bash scripts/install.sh [--non-interactive] [--skip-health]
# =============================================================================
set -euo pipefail

# ─── Color / Logging ─────────────────────────────────────────────────────────
RESET='\033[0m'; BOLD='\033[1m'
GREEN='\033[0;32m'; CYAN='\033[0;36m'
YELLOW='\033[0;33m'; RED='\033[0;31m'
BLUE='\033[0;34m'; DIM='\033[2m'

log()    { echo -e "${CYAN}▸${RESET} $*"; }
ok()     { echo -e "${GREEN}✓${RESET} $*"; }
warn()   { echo -e "${YELLOW}⚠${RESET}  $*"; }
err()    { echo -e "${RED}✗${RESET} $*" >&2; }
header() { echo -e "\n${BOLD}${BLUE}$*${RESET}\n"; }
dim()    { echo -e "${DIM}$*${RESET}"; }

# ─── Flags ───────────────────────────────────────────────────────────────────
NON_INTERACTIVE=false
SKIP_HEALTH=false
SKIP_CLOUDFLARED=false
SKIP_INIT=false

for arg in "$@"; do
  case "$arg" in
    --non-interactive) NON_INTERACTIVE=true ;;
    --skip-health)     SKIP_HEALTH=true ;;
    --skip-cloudflared) SKIP_CLOUDFLARED=true ;;
    --skip-init)       SKIP_INIT=true ;;
    -h|--help)
      echo "Usage: $0 [--non-interactive] [--skip-health] [--skip-cloudflared] [--skip-init]"
      exit 0 ;;
  esac
done

# ─── Environment Detection ───────────────────────────────────────────────────
detect_os() {
  case "$(uname -s)" in
    Darwin) echo "macos" ;;
    Linux)
      if grep -qi microsoft /proc/version 2>/dev/null; then echo "wsl"
      elif [ -f /etc/alpine-release ]; then echo "alpine"
      else echo "linux"
      fi ;;
    *) echo "unsupported" ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64) echo "amd64" ;;
    arm64|aarch64) echo "arm64" ;;
    armv7l) echo "arm" ;;
    *) echo "unknown" ;;
  esac
}

detect_pkg_manager() {
  local os="$1"
  case "$os" in
    macos)
      command -v brew &>/dev/null && echo "brew" || echo "none" ;;
    linux|wsl)
      command -v apt-get &>/dev/null && echo "apt" ||
      command -v dnf    &>/dev/null && echo "dnf" ||
      command -v yum    &>/dev/null && echo "yum" ||
      command -v pacman &>/dev/null && echo "pacman" || echo "none" ;;
    alpine) echo "apk" ;;
    *) echo "none" ;;
  esac
}

OS=$(detect_os)
ARCH=$(detect_arch)
PKG=$(detect_pkg_manager "$OS")

# ─── Prompt helper ───────────────────────────────────────────────────────────
ask() {
  # ask "Question?" [default_value]
  local question="$1" default="${2:-}"
  if $NON_INTERACTIVE; then
    echo "$default"
    return
  fi
  local prompt_str="${CYAN}?${RESET} $question"
  [ -n "$default" ] && prompt_str+=" ${DIM}[$default]${RESET}"
  prompt_str+=": "
  echo -en "$prompt_str" >&2
  local answer
  read -r answer
  echo "${answer:-$default}"
}

ask_yn() {
  local question="$1" default="${2:-y}"
  if $NON_INTERACTIVE; then
    [[ "$default" == "y" ]] && return 0 || return 1
  fi
  local choices="[Y/n]"; [[ "$default" == "n" ]] && choices="[y/N]"
  local answer
  answer=$(ask "$question $choices" "$default")
  [[ "${answer,,}" =~ ^(y|yes|)$ ]]
}

# ─── Banner ──────────────────────────────────────────────────────────────────
print_banner() {
  echo ""
  echo -e "${BOLD}${CYAN}"
  echo "  ╔══════════════════════════════════════╗"
  echo "  ║      JackClaw Setup Wizard           ║"
  echo "  ║   Build AI-powered team automation   ║"
  echo "  ╚══════════════════════════════════════╝"
  echo -e "${RESET}"
  echo -e "  OS:   ${BOLD}$OS${RESET} ($ARCH)"
  echo -e "  Pkg:  ${BOLD}$PKG${RESET}"
  echo ""
}

# ─── System Check ────────────────────────────────────────────────────────────
check_system() {
  header "① System Check"

  # Node.js
  if command -v node &>/dev/null; then
    local ver major
    ver=$(node -e "process.stdout.write(process.version)")
    major="${ver#v}"; major="${major%%.*}"
    if (( major >= 20 )); then
      ok "Node.js $ver"
    else
      warn "Node.js $ver is below the required v20."
      err "Please upgrade Node.js from https://nodejs.org/ and re-run."
      exit 1
    fi
  else
    err "Node.js not found. Install v20+ from https://nodejs.org/"
    exit 1
  fi

  # npm
  if command -v npm &>/dev/null; then
    ok "npm $(npm --version)"
  else
    err "npm not found (should come with Node.js)"
    exit 1
  fi

  # curl
  command -v curl &>/dev/null && ok "curl available" || warn "curl not found (needed for some steps)"

  # Internet connectivity
  if curl -fsS --max-time 5 https://registry.npmjs.org/ -o /dev/null 2>&1; then
    ok "Internet reachable"
  else
    warn "Cannot reach npm registry — offline install may fail"
  fi
}

# ─── Install cloudflared ─────────────────────────────────────────────────────
install_cloudflared() {
  if $SKIP_CLOUDFLARED; then
    dim "  Skipping cloudflared (--skip-cloudflared)"
    return
  fi

  header "② Install cloudflared"

  if command -v cloudflared &>/dev/null; then
    ok "cloudflared already installed: $(cloudflared --version 2>&1 | head -1)"
    return
  fi

  log "Installing cloudflared…"

  case "$OS" in
    macos)
      if [[ "$PKG" == "brew" ]]; then
        brew install cloudflared
      else
        local url="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-${ARCH}"
        curl -fsSL "$url" -o /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared
      fi ;;
    linux|wsl)
      local url
      case "$ARCH" in
        amd64) url="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64" ;;
        arm64) url="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64" ;;
        *)
          warn "Unsupported arch $ARCH — skipping cloudflared"
          return ;;
      esac
      local dest=/usr/local/bin/cloudflared
      if [[ -w /usr/local/bin ]]; then
        curl -fsSL "$url" -o "$dest" && chmod +x "$dest"
      else
        sudo curl -fsSL "$url" -o "$dest" && sudo chmod +x "$dest"
      fi ;;
    alpine)
      warn "Alpine: install cloudflared manually from https://github.com/cloudflare/cloudflared/releases"
      return ;;
    *)
      warn "Unsupported OS for cloudflared auto-install"
      return ;;
  esac

  ok "cloudflared installed: $(cloudflared --version 2>&1 | head -1)"
}

# ─── Install jackclaw-cli ────────────────────────────────────────────────────
install_jackclaw() {
  header "③ Install JackClaw CLI"

  if command -v jackclaw &>/dev/null; then
    ok "jackclaw-cli already installed: $(jackclaw --version 2>&1 | head -1)"
    return
  fi

  log "Installing @jackclaw/cli from npm…"
  npm install -g @jackclaw/cli
  ok "jackclaw-cli installed: $(jackclaw --version 2>&1 | head -1)"
}

# ─── Interactive configuration ───────────────────────────────────────────────
configure() {
  header "④ Configuration"

  local node_name hub_url hub_token

  echo -e "  Let's configure your JackClaw node.\n"

  node_name=$(ask "Node name" "$(hostname -s 2>/dev/null || echo my-node)")
  hub_url=$(ask "Hub URL (leave blank to set up a local hub)" "")
  hub_token=$(ask "Hub token (leave blank to generate one)" "")

  # Write config
  local config_dir="$HOME/.jackclaw"
  mkdir -p "$config_dir"

  cat > "$config_dir/config.json" <<EOF
{
  "node": {
    "name": "$node_name"
  },
  "hub": {
    "url": "${hub_url:-}",
    "token": "${hub_token:-}"
  }
}
EOF
  ok "Config written to $config_dir/config.json"
}

# ─── Init ────────────────────────────────────────────────────────────────────
run_init() {
  if $SKIP_INIT; then
    dim "  Skipping jackclaw init (--skip-init)"
    return
  fi

  header "⑤ Initialize"

  if command -v jackclaw &>/dev/null; then
    log "Running jackclaw init…"
    jackclaw init
  else
    warn "jackclaw CLI not found — skipping init"
  fi
}

# ─── Health Check ────────────────────────────────────────────────────────────
run_health_check() {
  if $SKIP_HEALTH; then
    dim "  Skipping health check (--skip-health)"
    return
  fi

  header "⑥ Health Check"

  local passed=0 failed=0

  check_item() {
    local label="$1" cmd="$2"
    if eval "$cmd" &>/dev/null; then
      ok "$label"
      ((passed++))
    else
      err "$label"
      ((failed++))
    fi
  }

  check_item "Node.js available"        "command -v node"
  check_item "npm available"            "command -v npm"
  check_item "jackclaw CLI available"   "command -v jackclaw"
  check_item "cloudflared available"    "command -v cloudflared"
  check_item "Config file exists"       "test -f $HOME/.jackclaw/config.json"
  check_item "npm registry reachable"   "curl -fsS --max-time 5 https://registry.npmjs.org/ -o /dev/null"

  echo ""
  echo -e "  Health: ${GREEN}$passed passed${RESET} / ${RED}$failed failed${RESET}"
}

# ─── Summary ────────────────────────────────────────────────────────────────
print_summary() {
  echo ""
  echo -e "${BOLD}${GREEN}  ╔══════════════════════════════════╗"
  echo -e "  ║   🎉  JackClaw is ready!         ║"
  echo -e "  ╚══════════════════════════════════╝${RESET}"
  echo ""
  echo -e "  ${BOLD}Next steps:${RESET}"
  echo ""
  echo -e "  ${CYAN}jackclaw node start${RESET}            # start this node"
  echo -e "  ${CYAN}jackclaw plugin list${RESET}           # see loaded plugins"
  echo -e "  ${CYAN}npx create-jackclaw my-plugin${RESET}  # scaffold a plugin"
  echo ""
  echo -e "  ${DIM}Docs: https://jackclaw.dev/docs/plugin-development${RESET}"
  echo ""
}

# ─── Main ────────────────────────────────────────────────────────────────────
main() {
  print_banner

  if ! $NON_INTERACTIVE; then
    echo -e "  This wizard will:"
    echo "   1. Check your system environment"
    echo "   2. Install cloudflared (tunnel daemon)"
    echo "   3. Install the JackClaw CLI"
    echo "   4. Configure your node"
    echo "   5. Run jackclaw init"
    echo "   6. Run a health check"
    echo ""
    ask_yn "Continue?" "y" || { echo "Aborted."; exit 0; }
  fi

  check_system
  install_cloudflared
  install_jackclaw
  configure
  run_init
  run_health_check
  print_summary
}

main "$@"
