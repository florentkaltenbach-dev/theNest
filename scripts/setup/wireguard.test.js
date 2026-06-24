// scripts/setup/wireguard.test.js
//
// Verifies the WireGuard mesh pre-install (I5): tooling installed in baseline,
// mesh left dormant on single-server installs, activation explicitly gated on a
// peer. Run: node --test. Depends: node:test, node:fs.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SETUP_DIR = __dirname;
const bootstrap = fs.readFileSync(path.join(SETUP_DIR, 'bootstrap.sh'), 'utf8');
const mesh = fs.readFileSync(path.join(SETUP_DIR, 'wireguard-mesh.sh'), 'utf8');

test('baseline provisioning installs wireguard tooling', () => {
  assert.match(bootstrap, /apt-get install[^\n]*wireguard-tools/);
});

test('bootstrap does not activate the mesh on a single-server install', () => {
  // No interface brought up, no unit enabled during provisioning.
  // Strip comments so the "do NOT enable wg-quick@wg0" warning doesn't false-trip.
  const code = bootstrap.split('\n').filter((l) => !l.trimStart().startsWith('#')).join('\n');
  assert.doesNotMatch(code, /wg-quick\s+up/);
  assert.doesNotMatch(code, /systemctl\s+enable[^\n]*wg-quick@/);
});

test('bootstrap verifies tooling present and wg0 dormant', () => {
  assert.match(bootstrap, /command -v wg && command -v wg-quick/);
  assert.match(bootstrap, /! ip link show wg0/);
});

test('activation gate refuses without a peer (the second server)', () => {
  // The activate path requires all peer args before writing config / enabling units.
  assert.match(mesh, /activation requires a peer/);
  assert.match(mesh, /enable --now "wg-quick@\$\{WG_IFACE\}"/);
});
