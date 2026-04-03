#!/usr/bin/env bash
# @name        🚀 Bootstrap Server
# @description Takes a fresh Hetzner Ubuntu 24.04 with claude user to full Nest setup
# @author      florent
# @target      remote
# @args        server-ip-or-hostname
# @dangerous   true
# ── theNest Bootstrap ──────────────────────────────────
# Takes a fresh Hetzner Ubuntu 24.04 with claude user (from cloud-config.yaml)
# and gets it to full functionality.
#
# Usage: ./scripts/setup/bootstrap.sh <server-ip-or-hostname>

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/common.sh"

# ── Args ──────────────────────────────────────────────
SERVER="${1:-}"
[[ -z "${SERVER}" ]] && die "Usage: $0 <server-ip-or-hostname>"

# ── SSH setup ─────────────────────────────────────────
# Try ~/.ssh/config first (supports Host aliases like "nest"),
# fall back to key-based connection for raw IPs.
if ssh -o ConnectTimeout=10 -o BatchMode=yes "${SERVER}" true 2>/dev/null; then
  SSH_CMD="ssh"
  SCP_CMD="scp"
  SSH_TARGET="${SERVER}"
else
  SSH_KEY=""
  for candidate in "${HOME}/.ssh/id_ed25519_nest" "${HOME}/.ssh/id_ed25519_hetzner" "${HOME}/.ssh/id_ed25519"; do
    [[ -f "${candidate}" ]] && SSH_KEY="${candidate}" && break
  done
  [[ -z "${SSH_KEY}" ]] && die "No SSH key found and ssh config doesn't work for '${SERVER}'"

  SSH_CMD="ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -i ${SSH_KEY}"
  SCP_CMD="scp -o StrictHostKeyChecking=accept-new -i ${SSH_KEY}"
  SSH_TARGET="claude@$(ssh_host "${SERVER}")"
fi

# Verify connection
${SSH_CMD} ${SSH_TARGET} true || die "Cannot connect to ${SERVER}"
success "Connected to ${SERVER}"

# Helper to run commands on server
run() { ${SSH_CMD} ${SSH_TARGET} "$@"; }
run_sudo() { ${SSH_CMD} ${SSH_TARGET} "sudo bash -c '$*'"; }

# ══════════════════════════════════════════════════════
# 1. PACKAGES
# ══════════════════════════════════════════════════════
info "Installing packages..."

run "sudo bash -s" <<'PKG'
set -Eeuo pipefail
export DEBIAN_FRONTEND=noninteractive

apt-get update -qq

# Essentials missing from base image
apt-get install -y -qq build-essential jq unzip fail2ban python3-pip python3-venv > /dev/null

# Node.js 22 LTS
if ! node --version 2>/dev/null | grep -q "v22"; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - > /dev/null 2>&1
  apt-get install -y -qq nodejs > /dev/null
fi

# Docker CE
if ! command -v docker &>/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin > /dev/null
fi
usermod -aG docker claude

# GitHub CLI
if ! command -v gh &>/dev/null; then
  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg 2>/dev/null
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list
  apt-get update -qq
  apt-get install -y -qq gh > /dev/null
fi
PKG

success "Packages done"

# ── Git identity (so commits work out of the box) ────
if ! run "git config --global user.name" &>/dev/null; then
  info "Setting default git identity..."
  run "git config --global user.name 'nest'"
  REMOTE_HOST=$(run "hostname")
  run "git config --global user.email 'nest@${REMOTE_HOST}'"
  success "Git identity set"
fi

# ══════════════════════════════════════════════════════
# 2. CLAUDE CODE (native install as claude user)
# ══════════════════════════════════════════════════════
if ! run "command -v claude" &>/dev/null; then
  info "Installing Claude Code..."
  run "curl -fsSL https://claude.ai/install.sh | bash"
  success "Claude Code installed"
else
  info "Claude Code already installed, skipping"
fi

# ── Claude Code settings ─────────────────────────────
info "Writing Claude Code settings..."
run "mkdir -p ~/.claude"

# Permissions go in settings.json
run "cat > ~/.claude/settings.json" <<'PERMS'
{
  "skipDangerousModePermissionPrompt": true
}
PERMS

# MCP servers go in ~/.claude.json (merged with existing config)
run "python3 -c \"
import json, os
path = os.path.expanduser('~/.claude.json')
data = json.load(open(path)) if os.path.exists(path) else {}
data['mcpServers'] = {
    'chrome-devtools': {
        'command': 'npx',
        'args': ['-y', 'chrome-devtools-mcp@latest', '--browser-url=http://127.0.0.1:9222']
    }
}
json.dump(data, open(path, 'w'), indent=2)
\""
success "Claude Code settings written"

# ══════════════════════════════════════════════════════
# 3. HARDEN
# ══════════════════════════════════════════════════════
info "Hardening..."

run "sudo bash -s" <<'HARDEN'
set -Eeuo pipefail

# SSH
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#\?MaxAuthTries.*/MaxAuthTries 3/' /etc/ssh/sshd_config
systemctl restart ssh

# UFW
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
echo "y" | ufw enable

# fail2ban
cat > /etc/fail2ban/jail.local <<'F2B'
[sshd]
enabled  = true
port     = ssh
maxretry = 5
bantime  = 3600
findtime = 600
F2B
systemctl enable --now fail2ban

# Swap (2GB)
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile > /dev/null
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# sysctl
cat > /etc/sysctl.d/99-nest.conf <<'SC'
net.ipv4.tcp_syncookies = 1
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
kernel.randomize_va_space = 2
vm.swappiness = 10
SC
sysctl --system > /dev/null 2>&1
HARDEN

success "Hardened"

# ══════════════════════════════════════════════════════
# 4. CLONE REPO
# ══════════════════════════════════════════════════════
if ! run "test -d /opt/nest/.git"; then
  info "Cloning repo..."
  run "sudo mkdir -p /opt/nest && sudo chown claude:claude /opt/nest"
  run "git clone --branch main https://github.com/florentkaltenbach-dev/theNest.git /opt/nest"
  success "Repo cloned"
else
  info "Repo already at /opt/nest, pulling..."
  run "cd /opt/nest && git pull --ff-only"
fi

# ══════════════════════════════════════════════════════
# 5. CONFIG
# ══════════════════════════════════════════════════════
CONFIG_LOCAL="${SCRIPT_DIR}/../../config.env"
if [[ -f "${CONFIG_LOCAL}" ]]; then
  info "Uploading config.env..."
  ${SCP_CMD} "${CONFIG_LOCAL}" "${SSH_TARGET}:/tmp/nest-config.env"
  run "sudo mv /tmp/nest-config.env /opt/nest/config.env && sudo chown claude:claude /opt/nest/config.env && chmod 600 /opt/nest/config.env"
  success "Config uploaded"
else
  warn "No config.env found locally — skipping upload"
fi

# Source config.env from .bashrc
run "grep -q 'nest/config.env' ~/.bashrc 2>/dev/null || cat >> ~/.bashrc <<'RC'

if [[ -f /opt/nest/config.env ]]; then set -a; source /opt/nest/config.env; set +a; fi
RC"

# ══════════════════════════════════════════════════════
# 6. SYSTEMD SERVICE + TMUX HELPER
# ══════════════════════════════════════════════════════
info "Creating systemd service and tmux helper..."

run "sudo bash -s" <<'SVC'
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
Environment=PATH=/home/claude/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/home/claude/.local/bin/claude --dangerously-skip-permissions
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload

cat > /usr/local/bin/claude-session <<'TMUX'
#!/usr/bin/env bash
SESSION="claude"
if tmux has-session -t "${SESSION}" 2>/dev/null; then
  exec tmux attach-session -t "${SESSION}"
else
  exec tmux new-session -s "${SESSION}" -c /opt/nest "claude"
fi
TMUX
chmod +x /usr/local/bin/claude-session
SVC

success "Service and helper created"

# ══════════════════════════════════════════════════════
# 7. VERIFY
# ══════════════════════════════════════════════════════
echo ""
info "Verifying..."

PASS=0 TOTAL=0
check() {
  TOTAL=$((TOTAL + 1))
  if run "$2" &>/dev/null; then
    success "  $1"; PASS=$((PASS + 1))
  else
    error "  $1"
  fi
}

check "node v22"                "node --version | grep v22"
check "docker"                  "docker --version"
check "gh"                      "gh --version"
check "claude"                  "command -v claude"
check "python3"                 "python3 --version"
check "ufw active"              "sudo ufw status | grep -q active"
check "fail2ban running"        "sudo systemctl is-active fail2ban"
check "repo at /opt/nest"       "test -f /opt/nest/Nest.md"
check "claude-code.service"     "test -f /etc/systemd/system/claude-code.service"
check "claude-session"          "test -x /usr/local/bin/claude-session"
check "claude settings.json"    "test -f /home/claude/.claude/settings.json"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
[[ $PASS -eq $TOTAL ]] && success "${PASS}/${TOTAL} checks passed" || warn "${PASS}/${TOTAL} checks passed"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
