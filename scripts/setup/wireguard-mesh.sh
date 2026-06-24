#!/usr/bin/env bash
# @name        🔗 WireGuard Mesh
# @description Activates the dormant WireGuard mesh once a second server (peer) is added
# @author      nest
# @target      remote
# @args        status | activate <address-cidr> <listen-port> <peer-pubkey> <peer-endpoint> <peer-allowed-ips>
# @dangerous   true
# ── theNest WireGuard Mesh Activation (I5) ─────────────
# WireGuard tooling is PRE-INSTALLED on every node by bootstrap.sh, but the mesh
# interface (wg0) is left DORMANT on single-server installs — no wg0.conf, no
# wg-quick@wg0 unit, no interface. This script is the EXPLICIT activation gate.
#
# Activation condition (dormant -> active):
#   The deployment has grown beyond one server, i.e. at least one peer (the
#   "second server") is supplied to `activate`. With no peer there is nothing to
#   mesh with, so the interface is never brought up.
#
# Usage:
#   wireguard-mesh.sh status
#       Report whether the mesh is dormant or active on this node.
#   wireguard-mesh.sh activate <address-cidr> <listen-port> \
#                              <peer-pubkey> <peer-endpoint> <peer-allowed-ips>
#       Generate this node's keypair (if absent), write /etc/wireguard/wg0.conf
#       with the given peer, and enable wg-quick@wg0. Requires root.
#
# Example (add nest as 10.0.0.3, peering with kaltenbach 10.0.0.1):
#   sudo wireguard-mesh.sh activate 10.0.0.3/24 51820 \
#       <kaltenbach-pubkey> kaltenbach.dev:51820 10.0.0.1/32

set -Eeuo pipefail

WG_CONF="/etc/wireguard/wg0.conf"
WG_KEY="/etc/wireguard/privatekey"
WG_PUB="/etc/wireguard/publickey"
WG_IFACE="wg0"

die() { echo "[ERROR] $*" >&2; exit 1; }

# ── Pre-flight ─────────────────────────────────────────
command -v wg >/dev/null 2>&1 || die "wireguard-tools not installed — run bootstrap.sh first"

# ── status ─────────────────────────────────────────────
mesh_status() {
  if ip link show "${WG_IFACE}" >/dev/null 2>&1; then
    echo "active — ${WG_IFACE} is up"
    wg show "${WG_IFACE}" 2>/dev/null || true
  elif [[ -f "${WG_CONF}" ]]; then
    echo "configured but down — ${WG_CONF} exists; start with: systemctl start wg-quick@${WG_IFACE}"
  else
    echo "dormant — single-server install, no peer configured (no ${WG_CONF}, no ${WG_IFACE})"
  fi
}

# ── activate ───────────────────────────────────────────
mesh_activate() {
  local address="${1:-}" port="${2:-}" peer_pubkey="${3:-}" peer_endpoint="${4:-}" peer_allowed="${5:-}"

  # The gate: refuse to leave dormant state without a second server (a peer).
  if [[ -z "${address}" || -z "${port}" || -z "${peer_pubkey}" || -z "${peer_endpoint}" || -z "${peer_allowed}" ]]; then
    die "activation requires a peer (the second server). Usage: $0 activate <address-cidr> <listen-port> <peer-pubkey> <peer-endpoint> <peer-allowed-ips>"
  fi

  [[ "${EUID}" -eq 0 ]] || die "activation must run as root (writes ${WG_CONF}, manages systemd)"

  umask 077
  install -d -m 700 /etc/wireguard

  # Generate this node's keypair on first activation.
  if [[ ! -f "${WG_KEY}" ]]; then
    wg genkey | tee "${WG_KEY}" | wg pubkey > "${WG_PUB}"
    echo "[OK] generated keypair (public: $(cat "${WG_PUB}"))"
  fi

  cat > "${WG_CONF}" <<EOF
# Managed by scripts/setup/wireguard-mesh.sh — Nest mesh (I5)
[Interface]
Address = ${address}
ListenPort = ${port}
PrivateKey = $(cat "${WG_KEY}")

[Peer]
PublicKey = ${peer_pubkey}
Endpoint = ${peer_endpoint}
AllowedIPs = ${peer_allowed}
PersistentKeepalive = 25
EOF
  chmod 600 "${WG_CONF}"

  systemctl enable --now "wg-quick@${WG_IFACE}"
  echo "[OK] mesh active — share this node's public key with peers: $(cat "${WG_PUB}")"
}

# ── Dispatch ───────────────────────────────────────────
case "${1:-status}" in
  status)   mesh_status ;;
  activate) shift; mesh_activate "$@" ;;
  *)        die "unknown action '${1}' — use 'status' or 'activate'" ;;
esac
