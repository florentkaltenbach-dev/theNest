// agent/test/discovery.test.js
//
// Fixture tests for discovery.py Docker/systemd/listening-port parsers.
// Drives the pure Python parse helpers via python3 — no Docker/systemd needed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const agentDir = join(dirname(fileURLToPath(import.meta.url)), '..');

// Run a single discovery.py parser over fixture text, return its parsed JSON.
const PY = `import sys, json
from nest_agent import discovery as d
parsers = {
    'docker': d._parse_docker_ps,
    'systemd': d._parse_systemd_units,
    'ports': d._parse_listening_ports,
}
print(json.dumps(parsers[sys.argv[1]](sys.stdin.read())))`;

function parse(category, fixture) {
  const out = execFileSync('python3', ['-c', PY, category], {
    cwd: agentDir,
    input: fixture,
    encoding: 'utf-8',
  });
  return JSON.parse(out);
}

test('docker: parses container rows, truncates id, skips junk', () => {
  const fixture = [
    '{"ID":"412a7955f967abc","Names":"portainer","Image":"portainer/portainer-ce:latest","State":"running","Status":"Up 19 hours","Ports":"0.0.0.0:9443->9443/tcp"}',
    '{"ID":"deadbeef0001","Names":"redis","Image":"redis:7","State":"exited","Status":"Exited (0) 2 days ago","Ports":""}',
    '',
    'not-json',
  ].join('\n');

  const got = parse('docker', fixture);
  assert.equal(got.length, 2);
  assert.deepEqual(got[0], {
    id: '412a7955f967',  // 15-char ID truncated to 12
    name: 'portainer',
    image: 'portainer/portainer-ce:latest',
    state: 'running',
    status: 'Up 19 hours',
    ports: '0.0.0.0:9443->9443/tcp',
  });
  assert.equal(got[1].name, 'redis');
  assert.equal(got[1].state, 'exited');
  assert.equal(got[1].ports, '');
});

test('systemd: parses unit rows, strips failed-unit bullet', () => {
  const fixture = [
    'acpid.service                 loaded active   running ACPI event daemon',
    '● nginx.service           loaded failed   failed  A high performance web server',
    'ssh.service                   loaded active   running OpenBSD Secure Shell server',
    '',
  ].join('\n');

  const got = parse('systemd', fixture);
  assert.equal(got.length, 3);
  assert.equal(got[0].unit, 'acpid.service');
  assert.equal(got[0].sub, 'running');
  assert.equal(got[1].unit, 'nginx.service');
  assert.equal(got[1].active, 'failed');
  assert.equal(got[1].description, 'A high performance web server');
});

test('ports: parses listening sockets incl. IPv6 and process info', () => {
  const fixture = [
    'LISTEN 0 4096 0.0.0.0:3000 0.0.0.0:* users:(("node",pid=1234,fd=20))',
    'LISTEN 0 128  [::]:22 [::]:* users:(("sshd",pid=900,fd=3))',
    'LISTEN 0 4096 127.0.0.1:6379 0.0.0.0:*',
    'garbage line',
  ].join('\n');

  const got = parse('ports', fixture);
  assert.equal(got.length, 3);
  assert.deepEqual(got[0], {
    address: '0.0.0.0', port: 3000, protocol: 'tcp', process: 'node', pid: 1234,
  });
  assert.deepEqual(got[1], {
    address: '[::]', port: 22, protocol: 'tcp', process: 'sshd', pid: 900,
  });
  assert.deepEqual(got[2], {
    address: '127.0.0.1', port: 6379, protocol: 'tcp', process: '', pid: null,
  });
});
