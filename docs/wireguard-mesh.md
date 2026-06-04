# WireGuard Mesh (I5)

WireGuard is **pre-installed** on every Nest node for future mesh networking, but
the mesh is **only activated when the deployment expands beyond one server**. This
avoids a disruptive network retrofit later while keeping single-node installs
unchanged.

## What provisioning does

`scripts/setup/bootstrap.sh` installs the `wireguard` / `wireguard-tools` packages
as part of the standard baseline (verify: `command -v wg && command -v wg-quick`).
It deliberately does **not**:

- create `/etc/wireguard/wg0.conf`, or
- enable `wg-quick@wg0`.

So on a fresh single-server install no `wg0` interface comes up
(verify: `! ip link show wg0 >/dev/null 2>&1`). The bootstrap verify step asserts
both of these: "wireguard tools" and "wg0 mesh dormant".

## The activation gate

The dormant → active transition is explicit and lives in
`scripts/setup/wireguard-mesh.sh`:

| Condition | State |
|-----------|-------|
| Single server, no peer configured | **dormant** — no `wg0.conf`, no `wg0` interface |
| `activate` run with at least one peer (the second server) | **active** — `wg0.conf` written, `wg-quick@wg0` enabled |

The script **refuses to activate without a peer**, because a peer *is* the second
server — there is nothing to mesh with on a single node. Check the current state
any time with:

```bash
scripts/setup/wireguard-mesh.sh status
```

## Activating when a second server is added

On each node, run (as root) with the other node's details:

```bash
sudo scripts/setup/wireguard-mesh.sh activate <address-cidr> <listen-port> \
    <peer-pubkey> <peer-endpoint> <peer-allowed-ips>
```

Example — bring `nest` up as `10.0.0.3`, peering with `kaltenbach` (`10.0.0.1`):

```bash
sudo scripts/setup/wireguard-mesh.sh activate 10.0.0.3/24 51820 \
    <kaltenbach-pubkey> kaltenbach.dev:51820 10.0.0.1/32
```

The script generates the node's keypair on first activation and prints its public
key; share that key with the peers so they can add this node in turn. Open the
listen port in UFW (`ufw allow 51820/udp`) on nodes that accept inbound peers.
