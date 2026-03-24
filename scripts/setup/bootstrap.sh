#!/usr/bin/env bash
# ── theNest Bootstrap ──────────────────────────────────
# One-click setup: fresh Hetzner Ubuntu 24.04 → hardened server with Claude Code.
#
# Usage:
#   ./scripts/setup/bootstrap.sh <server-ip>
#   ./scripts/setup/bootstrap.sh --config ./config.env <server-ip>
#   ./scripts/setup/bootstrap.sh --reset <server-ip>
#
# Today you run this from your laptop. Tomorrow the Nest app
# triggers it via IScriptRunner. Same script, different trigger.

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="${SCRIPT_DIR}/../../bootstrap-$(date +%Y%m%d-%H%M%S).log"

# Log to file if process substitution works (Linux/macOS), skip on Windows Git Bash
if [[ "$(uname -o 2>/dev/null)" != "Msys" ]] && [[ "$(uname -o 2>/dev/null)" != "Cygwin" ]]; then
  exec > >(tee -a "${LOG_FILE}") 2>&1
fi

# ── Parse Arguments ────────────────────────────────────
CONFIG_FILE=""
RESET=false
SERVER_IP=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --config) CONFIG_FILE="$2"; shift 2 ;;
    --reset)  RESET=true; shift ;;
    --help|-h)
      echo "Usage: $0 [--config <config.env>] [--reset] <server-ip>"
      exit 0
      ;;
    -*)
      echo "Unknown option: $1" >&2; exit 1 ;;
    *)
      SERVER_IP="$1"; shift ;;
  esac
done

[[ -z "${SERVER_IP}" ]] && { echo "Error: server IP required" >&2; echo "Usage: $0 [--config <config.env>] [--reset] <server-ip>"; exit 1; }

# ── Load Config ────────────────────────────────────────
if [[ -z "${CONFIG_FILE}" ]]; then
  for candidate in "./config.env" "${SCRIPT_DIR}/../../config.env"; do
    if [[ -f "${candidate}" ]]; then
      CONFIG_FILE="${candidate}"
      break
    fi
  done
fi

# If no config.env found, run interactive wizard
if [[ -z "${CONFIG_FILE}" || ! -f "${CONFIG_FILE}" ]]; then
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  No config.env found — let's create one."
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""

  mask() { local v="$1"; [[ ${#v} -gt 8 ]] && echo "${v:0:8}..." || echo "$v"; }

  prompt_var() {
    local var_name="$1" prompt_text="$2" default="${3:-}" is_secret="${4:-false}"
    local display_default=""
    if [[ -n "${default}" ]]; then
      if [[ "${is_secret}" == true ]]; then
        display_default=" [$(mask "${default}")]"
      else
        display_default=" [${default}]"
      fi
    fi
    read -rp "  ${prompt_text}${display_default}: " value
    value="${value:-${default}}"
    if [[ -z "${value}" ]]; then
      echo "  Error: ${var_name} is required." >&2
      prompt_var "$@"
      return
    fi
    printf -v "${var_name}" '%s' "${value}"
  }

  # Auto-detect SSH key (resolve to absolute path to avoid ~ issues across shells)
  SSH_KEY_DEFAULT=""
  for candidate in "${HOME}/.ssh/id_ed25519_hetzner" "${HOME}/.ssh/id_ed25519" "${HOME}/.ssh/id_rsa"; do
    if [[ -f "${candidate}" ]]; then
      SSH_KEY_DEFAULT="$(cd "$(dirname "${candidate}")" && pwd)/$(basename "${candidate}")"
      break
    fi
  done

  # ── Claude Code auth method ──────────────────────────
  echo "  How do you want to authenticate Claude Code?"
  echo "    1) API Key  — set ANTHROPIC_API_KEY (works headlessly)"
  echo "    2) OAuth    — run 'claude login' on server (opens URL to paste back)"
  echo ""
  read -rp "  Choose [1/2] (default: 1): " auth_choice
  auth_choice="${auth_choice:-1}"

  CLAUDE_AUTH_MODE="apikey"
  ANTHROPIC_API_KEY=""
  if [[ "${auth_choice}" == "2" ]]; then
    CLAUDE_AUTH_MODE="oauth"
    echo "  → OAuth selected. You'll log in on the server after install."
  else
    prompt_var "ANTHROPIC_API_KEY" "Anthropic API Key" "" true
  fi

  # ── Repo access method ───────────────────────────────
  echo ""
  echo "  How should the server access the GitHub repo?"
  echo "    1) Deploy Key — generate an SSH key pair (recommended)"
  echo "    2) Token      — use a GitHub personal access token"
  echo ""
  read -rp "  Choose [1/2] (default: 1): " repo_choice
  repo_choice="${repo_choice:-1}"

  REPO_AUTH_MODE="deploykey"
  GITHUB_TOKEN=""
  DEPLOY_KEY_PATH=""
  if [[ "${repo_choice}" == "2" ]]; then
    REPO_AUTH_MODE="token"
    prompt_var "GITHUB_TOKEN" "GitHub Token" "" true
  else
    DEPLOY_KEY_PATH="${SCRIPT_DIR}/../../.deploy-key"
    if [[ ! -f "${DEPLOY_KEY_PATH}" ]]; then
      echo ""
      echo "  Generating deploy key pair..."
      ssh-keygen -t ed25519 -C "theNest-deploy" -f "${DEPLOY_KEY_PATH}" -N "" -q
      echo ""
      echo "  ┌──────────────────────────────────────────────────┐"
      echo "  │  Add this PUBLIC KEY as a deploy key on GitHub:  │"
      echo "  │                                                  │"
      echo "  │  Repo → Settings → Deploy keys → Add deploy key │"
      echo "  └──────────────────────────────────────────────────┘"
      echo ""
      echo "  $(cat "${DEPLOY_KEY_PATH}.pub")"
      echo ""
      read -rp "  Press Enter after you've added the deploy key on GitHub... "
    else
      echo "  → Using existing deploy key: ${DEPLOY_KEY_PATH}"
      echo "  Public key: $(cat "${DEPLOY_KEY_PATH}.pub")"
    fi
  fi

  prompt_var "SSH_KEY_PATH" "SSH Key Path" "${SSH_KEY_DEFAULT}" false
  prompt_var "NEST_REPO" "Nest Repo URL" "https://github.com/florentkaltenbach-dev/theNest.git" false
  prompt_var "NEST_BRANCH" "Nest Branch" "main" false

  CONFIG_FILE="${SCRIPT_DIR}/../../config.env"
  cat > "${CONFIG_FILE}" <<ENVEOF
# ── theNest Configuration (generated $(date +%Y-%m-%d)) ──
# NEVER commit this file — it contains secrets.

CLAUDE_AUTH_MODE="${CLAUDE_AUTH_MODE}"
ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY}"
REPO_AUTH_MODE="${REPO_AUTH_MODE}"
GITHUB_TOKEN="${GITHUB_TOKEN}"
SSH_KEY_PATH="${SSH_KEY_PATH}"
NEST_REPO="${NEST_REPO}"
NEST_BRANCH="${NEST_BRANCH}"
ENVEOF

  chmod 600 "${CONFIG_FILE}" 2>/dev/null || true
  echo ""
  echo "  Config saved to: ${CONFIG_FILE}"
  echo ""
fi

set -a
source "${CONFIG_FILE}"
set +a

# ── Resolve SSH Key ────────────────────────────────────
SSH_KEY="${SSH_KEY_PATH:-}"
if [[ -z "${SSH_KEY}" ]]; then
  for candidate in "${HOME}/.ssh/id_ed25519_hetzner" "${HOME}/.ssh/id_ed25519" "${HOME}/.ssh/id_rsa"; do
    if [[ -f "${candidate}" ]]; then
      SSH_KEY="${candidate}"
      break
    fi
  done
fi

[[ -z "${SSH_KEY}" || ! -f "${SSH_KEY}" ]] && {
  echo "Error: SSH key not found. Set SSH_KEY_PATH in config.env." >&2
  exit 1
}

export SERVER_IP SSH_KEY

# ── Source Common Functions ────────────────────────────
source "${SCRIPT_DIR}/lib/common.sh"
build_ssh_opts

# ── Clear stale host keys (servers get rebuilt) ───────
ssh-keygen -R "${SERVER_IP}" 2>/dev/null || true

# ── Detect SSH User ────────────────────────────────────
info "Probing SSH access to ${SERVER_IP}..."
SSH_USER=$(detect_ssh_user)
[[ -z "${SSH_USER}" ]] && die "Cannot connect to ${SERVER_IP} via SSH"
export SSH_USER
info "Connected as '${SSH_USER}'"

# ── Reset State (if requested) ─────────────────────────
if [[ "${RESET}" == true ]]; then
  warn "Resetting bootstrap state on server..."
  run_remote "rm -f ${REMOTE_STATE_FILE}" 2>/dev/null || true
  success "State reset"
fi

# ── Ensure /opt/nest exists ────────────────────────────
run_remote_sudo "mkdir -p /opt/nest && chown claude:claude /opt/nest 2>/dev/null || mkdir -p /opt/nest"

# ════════════════════════════════════════════════════════
# PHASE 1: HARDEN
# ════════════════════════════════════════════════════════
if ! phase_done "harden"; then
  if [[ "${SSH_USER}" == "root" ]]; then
    info "Phase 1: Hardening server..."

    ssh "${SSH_OPTS[@]}" "root@${SERVER_IP}" "bash -s" <<'HARDEN_EOF'
set -Eeuo pipefail

export DEBIAN_FRONTEND=noninteractive

# ── Create claude user ─────────────────────────────────
if ! id claude &>/dev/null; then
  useradd -m -s /bin/bash -U -u 1001 claude
  echo "claude ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/claude
  chmod 0440 /etc/sudoers.d/claude

  mkdir -p /home/claude/.ssh
  cp /root/.ssh/authorized_keys /home/claude/.ssh/authorized_keys
  chown -R claude:claude /home/claude/.ssh
  chmod 700 /home/claude/.ssh
  chmod 600 /home/claude/.ssh/authorized_keys
fi

# ── Harden SSH ─────────────────────────────────────────
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#\?MaxAuthTries.*/MaxAuthTries 3/' /etc/ssh/sshd_config
sed -i 's/^#\?MaxSessions.*/MaxSessions 5/' /etc/ssh/sshd_config

# Ensure pubkey auth is enabled
grep -q "^PubkeyAuthentication" /etc/ssh/sshd_config \
  && sed -i 's/^PubkeyAuthentication.*/PubkeyAuthentication yes/' /etc/ssh/sshd_config \
  || echo "PubkeyAuthentication yes" >> /etc/ssh/sshd_config

systemctl restart ssh

# ── UFW Firewall ───────────────────────────────────────
apt-get update -qq
apt-get install -y -qq ufw fail2ban > /dev/null

ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
echo "y" | ufw enable

# ── fail2ban ───────────────────────────────────────────
cat > /etc/fail2ban/jail.local <<'F2B'
[sshd]
enabled  = true
port     = ssh
filter   = sshd
maxretry = 5
bantime  = 3600
findtime = 600
F2B
systemctl enable fail2ban
systemctl restart fail2ban

# ── sysctl hardening ──────────────────────────────────
cat > /etc/sysctl.d/99-nest-hardening.conf <<'SYSCTL'
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1
net.ipv4.tcp_syncookies = 1
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.default.send_redirects = 0
net.ipv4.icmp_echo_ignore_broadcasts = 1
kernel.randomize_va_space = 2
SYSCTL
sysctl --system > /dev/null 2>&1

# ── Swap ───────────────────────────────────────────────
if [[ ! -f /swapfile ]]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile > /dev/null
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo 'vm.swappiness = 10' >> /etc/sysctl.d/99-nest-hardening.conf
  sysctl vm.swappiness=10
fi

# ── Unattended Upgrades ───────────────────────────────
apt-get install -y -qq unattended-upgrades > /dev/null
cat > /etc/apt/apt.conf.d/50unattended-upgrades <<'UU'
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}-security";
    "${distro_id}ESMApps:${distro_codename}-apps-security";
};
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "03:00";
UU

# ── Create /opt/nest and write state ──────────────────
mkdir -p /opt/nest
chown claude:claude /opt/nest
echo "harden" > /opt/nest/.bootstrap-state
chown claude:claude /opt/nest/.bootstrap-state

# Reboot at end of hardening
reboot

HARDEN_EOF

    success "Server hardened"
    sleep 10

    # Switch to claude user after reboot
    SSH_USER="claude"
    export SSH_USER
    wait_for_ssh "claude"
  else
    info "Phase 1: Already hardened (connected as '${SSH_USER}'), skipping"
    # Still mark done if connecting as claude means hardening already happened
    run_remote_sudo "mkdir -p /opt/nest && chown claude:claude /opt/nest"
    mark_done "harden"
  fi
else
  info "Phase 1: harden — already done, skipping"
  # Ensure we're connecting as claude
  if [[ "${SSH_USER}" == "root" ]]; then
    SSH_USER="claude"
    export SSH_USER
  fi
fi

# ════════════════════════════════════════════════════════
# PHASE 2: INSTALL DEPENDENCIES
# ════════════════════════════════════════════════════════
if ! phase_done "install-deps"; then
  info "Phase 2: Installing dependencies..."

  ssh "${SSH_OPTS[@]}" "claude@${SERVER_IP}" "sudo bash -s" <<'DEPS_EOF'
set -Eeuo pipefail

export DEBIAN_FRONTEND=noninteractive

apt-get update -qq

# ── Build essentials ───────────────────────────────────
apt-get install -y -qq \
  build-essential curl jq tmux git unzip rsync \
  ca-certificates gnupg lsb-release > /dev/null

# ── Node.js 22 LTS (NodeSource) ───────────────────────
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - > /dev/null 2>&1
  apt-get install -y -qq nodejs > /dev/null
fi

# ── Python 3 + pip + venv ─────────────────────────────
apt-get install -y -qq python3 python3-pip python3-venv > /dev/null

# ── Docker CE + Compose ───────────────────────────────
if ! command -v docker &>/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
    gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg

  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
    > /etc/apt/sources.list.d/docker.list

  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin > /dev/null
fi

usermod -aG docker claude

# ── GitHub CLI ─────────────────────────────────────────
if ! command -v gh &>/dev/null; then
  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg 2>/dev/null
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] \
    https://cli.github.com/packages stable main" \
    > /etc/apt/sources.list.d/github-cli.list
  apt-get update -qq
  apt-get install -y -qq gh > /dev/null
fi

DEPS_EOF

  success "Dependencies installed"
  mark_done "install-deps"
else
  info "Phase 2: install-deps — already done, skipping"
fi

# ════════════════════════════════════════════════════════
# PHASE 3: CLONE REPO
# ════════════════════════════════════════════════════════
if ! phase_done "clone-repo"; then
  info "Phase 3: Cloning theNest repo..."

  NEST_REPO="${NEST_REPO:-https://github.com/florentkaltenbach-dev/theNest.git}"
  NEST_BRANCH="${NEST_BRANCH:-main}"

  if [[ "${REPO_AUTH_MODE:-token}" == "deploykey" ]]; then
    # Upload deploy key to server
    DEPLOY_KEY_LOCAL="${SCRIPT_DIR}/../../.deploy-key"
    if [[ -f "${DEPLOY_KEY_LOCAL}" ]]; then
      info "Uploading deploy key to server..."
      upload_file "${DEPLOY_KEY_LOCAL}" "/tmp/nest-deploy-key"
      ssh "${SSH_OPTS[@]}" "claude@${SERVER_IP}" "bash -s" <<'DKSETUP_EOF'
mkdir -p ~/.ssh
mv /tmp/nest-deploy-key ~/.ssh/nest-deploy-key
chmod 600 ~/.ssh/nest-deploy-key
# Configure SSH to use deploy key for github.com
if ! grep -q "nest-deploy-key" ~/.ssh/config 2>/dev/null; then
  cat >> ~/.ssh/config <<'SSHCFG'

Host github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/nest-deploy-key
  StrictHostKeyChecking accept-new
SSHCFG
  chmod 600 ~/.ssh/config
fi
DKSETUP_EOF
    fi

    # Convert HTTPS URL to SSH URL for git clone
    CLONE_URL=$(echo "${NEST_REPO}" | sed 's|https://github.com/|git@github.com:|')
  else
    # Token-based HTTPS clone via GIT_ASKPASS (avoids token in URL)
    CLONE_URL="${NEST_REPO}"
    USE_GIT_ASKPASS=""
    if [[ -n "${GITHUB_TOKEN:-}" ]]; then
      USE_GIT_ASKPASS="1"
    fi
  fi

  ssh "${SSH_OPTS[@]}" "claude@${SERVER_IP}" "bash -s" <<CLONE_EOF
set -Eeuo pipefail

# Set up GIT_ASKPASS if using token auth
if [[ -n "${USE_GIT_ASKPASS:-}" ]]; then
  ASKPASS_SCRIPT=\$(mktemp)
  cat > "\${ASKPASS_SCRIPT}" <<'ASKPASS'
#!/bin/sh
echo "${GITHUB_TOKEN}"
ASKPASS
  chmod +x "\${ASKPASS_SCRIPT}"
  export GIT_ASKPASS="\${ASKPASS_SCRIPT}"
fi

if [[ -d /opt/nest/.git ]]; then
  cd /opt/nest
  git pull origin ${NEST_BRANCH}
else
  # Clone into a temp dir then move contents (since /opt/nest already exists)
  TMP_DIR=\$(mktemp -d)
  git clone --branch ${NEST_BRANCH} "${CLONE_URL}" "\${TMP_DIR}"
  # Move everything including .git into /opt/nest
  shopt -s dotglob
  mv "\${TMP_DIR}"/* /opt/nest/
  rmdir "\${TMP_DIR}"
fi

# Clean up askpass script
rm -f "\${ASKPASS_SCRIPT:-}" 2>/dev/null || true
CLONE_EOF

  success "Repo cloned to /opt/nest"
  mark_done "clone-repo"
else
  info "Phase 3: clone-repo — already done, skipping"
fi

# ════════════════════════════════════════════════════════
# PHASE 4: SETUP CLAUDE CODE
# ════════════════════════════════════════════════════════
if ! phase_done "setup-claude-code"; then
  info "Phase 4: Setting up Claude Code..."

  # Upload config.env to server
  upload_file "${CONFIG_FILE}" "/tmp/nest-config.env"

  ssh "${SSH_OPTS[@]}" "claude@${SERVER_IP}" "sudo bash -s" <<'CLAUDE_EOF'
set -Eeuo pipefail

# ── Install Claude Code ────────────────────────────────
npm install -g @anthropic-ai/claude-code

# ── Place config.env ───────────────────────────────────
mv /tmp/nest-config.env /opt/nest/config.env
chown claude:claude /opt/nest/config.env
chmod 0600 /opt/nest/config.env

CLAUDE_EOF

  # Source config.env in bashrc (as claude user, not sudo)
  ssh "${SSH_OPTS[@]}" "claude@${SERVER_IP}" "bash -s" <<'BASHRC_EOF'
# Add env sourcing to .bashrc if not already present
if ! grep -q "nest/config.env" ~/.bashrc 2>/dev/null; then
  cat >> ~/.bashrc <<'INNER'

# ── theNest environment ───────────────────────────────
if [[ -f /opt/nest/config.env ]]; then
  set -a; source /opt/nest/config.env; set +a
fi
INNER
fi
BASHRC_EOF

  # If OAuth mode, defer login to user's first SSH session
  if [[ "${CLAUDE_AUTH_MODE:-apikey}" == "oauth" ]]; then
    warn "OAuth mode: run 'claude login' after SSHing into the server"
  fi

  success "Claude Code installed and configured"
  mark_done "setup-claude-code"
else
  info "Phase 4: setup-claude-code — already done, skipping"
fi

# ════════════════════════════════════════════════════════
# PHASE 5: SETUP CLAUDE CODE SERVICE
# ════════════════════════════════════════════════════════
if ! phase_done "setup-claude-code-service"; then
  info "Phase 5: Setting up Claude Code service and tmux helper..."

  ssh "${SSH_OPTS[@]}" "claude@${SERVER_IP}" "sudo bash -s" <<'SERVICE_EOF'
set -Eeuo pipefail

# ── Systemd service for headless mode ──────────────────
cat > /etc/systemd/system/claude-code.service <<'UNIT'
[Unit]
Description=Claude Code (headless)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=claude
Group=claude
WorkingDirectory=/opt/nest
EnvironmentFile=/opt/nest/config.env
ExecStart=/usr/bin/claude --dangerously-skip-permissions
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload

# ── tmux helper for interactive sessions ───────────────
cat > /usr/local/bin/claude-session <<'TMUX'
#!/usr/bin/env bash
# Start or attach to a Claude Code tmux session
SESSION_NAME="claude"

if tmux has-session -t "${SESSION_NAME}" 2>/dev/null; then
  exec tmux attach-session -t "${SESSION_NAME}"
else
  exec tmux new-session -s "${SESSION_NAME}" -c /opt/nest "claude"
fi
TMUX

chmod +x /usr/local/bin/claude-session

SERVICE_EOF

  success "Claude Code service and tmux helper created"
  mark_done "setup-claude-code-service"
else
  info "Phase 5: setup-claude-code-service — already done, skipping"
fi

# ════════════════════════════════════════════════════════
# PHASE 6: VERIFY
# ════════════════════════════════════════════════════════
info "Phase 6: Verifying setup..."

CHECKS_PASSED=0
CHECKS_TOTAL=0

check() {
  local label="$1"
  local cmd="$2"
  CHECKS_TOTAL=$((CHECKS_TOTAL + 1))
  if run_remote "${cmd}" &>/dev/null; then
    success "  ${label}"
    CHECKS_PASSED=$((CHECKS_PASSED + 1))
  else
    error "  ${label}"
  fi
}

echo ""
info "Running verification checks..."
echo ""

check "claude user exists"          "id claude"
check "sudo works"                  "sudo true"
check "Node.js installed"           "node --version"
check "npm installed"               "npm --version"
check "Python 3 installed"          "python3 --version"
check "Docker installed"            "docker --version"
check "Git installed"               "git --version"
check "gh CLI installed"            "gh --version"
check "tmux installed"              "tmux -V"
check "Claude Code installed"       "which claude"
if [[ "${CLAUDE_AUTH_MODE:-apikey}" == "apikey" ]]; then
  check "ANTHROPIC_API_KEY set"     "source /opt/nest/config.env && test -n \"\${ANTHROPIC_API_KEY:-}\""
else
  check "OAuth mode (login later)"  "true"
fi
check "Repo cloned at /opt/nest"    "test -f /opt/nest/Nest.md"
check "UFW active"                  "sudo ufw status | grep -q active"
check "fail2ban running"            "sudo systemctl is-active fail2ban"
check "claude-code.service exists"  "test -f /etc/systemd/system/claude-code.service"
check "claude-session helper"       "test -x /usr/local/bin/claude-session"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [[ ${CHECKS_PASSED} -eq ${CHECKS_TOTAL} ]]; then
  success "All ${CHECKS_TOTAL}/${CHECKS_TOTAL} checks passed!"
else
  warn "${CHECKS_PASSED}/${CHECKS_TOTAL} checks passed"
fi
echo ""
info "Connect with:  ssh claude@${SERVER_IP}"
info "Interactive:   claude-session"
info "Headless:      sudo systemctl start claude-code"
info "Log file:      ${LOG_FILE}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
