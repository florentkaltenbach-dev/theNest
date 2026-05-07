#!/usr/bin/env python3
"""Nest Agent — reports metrics and container status to the Hub via WebSocket."""

import asyncio
import json
import os
import signal
import sys
import logging

import websockets

from .metrics import collect_system_metrics
from .containers import collect_containers

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("nest-agent")

HUB_URL = os.environ.get("NEST_HUB_URL", "ws://localhost:3000/ws/agent")
AGENT_TOKEN = os.environ.get("NEST_AGENT_TOKEN", "")
METRICS_INTERVAL = int(os.environ.get("NEST_METRICS_INTERVAL", "30"))
CONTAINERS_INTERVAL = int(os.environ.get("NEST_CONTAINERS_INTERVAL", "60"))


async def send_loop(ws, msg_type: str, collector, interval: int):
    while True:
        try:
            data = await asyncio.get_event_loop().run_in_executor(None, collector)
            msg = json.dumps({"type": msg_type, "data": data})
            await ws.send(msg)
            log.debug("Sent %s", msg_type)
        except (websockets.ConnectionClosed, asyncio.CancelledError):
            raise
        except Exception:
            log.exception("Error in %s send loop", msg_type)
        await asyncio.sleep(interval)


async def handle_commands(ws):
    """Listen for commands from the hub."""
    async for raw in ws:
        try:
            msg = json.loads(raw)
            cmd = msg.get("command")
            log.info("Received command: %s", cmd)

            if cmd == "container_action":
                import docker
                client = docker.from_env()
                container = client.containers.get(msg["container_id"])
                action = msg["action"]
                if action == "start":
                    container.start()
                elif action == "stop":
                    container.stop(timeout=10)
                elif action == "restart":
                    container.restart(timeout=10)
                await ws.send(json.dumps({
                    "type": "command_result",
                    "command": cmd,
                    "success": True,
                    "container_id": msg["container_id"],
                    "action": action,
                    "requestId": msg.get("requestId"),
                }))
            elif cmd == "container_logs":
                import docker
                client = docker.from_env()
                container = client.containers.get(msg["container_id"])
                lines = container.logs(tail=msg.get("tail", 100), timestamps=True).decode("utf-8", errors="replace")
                await ws.send(json.dumps({
                    "type": "container_logs",
                    "data": {
                        "container_id": msg["container_id"],
                        "lines": lines.split("\n"),
                    },
                }))
            elif cmd == "install_appendage":
                import os
                import docker
                client = docker.from_env()
                image = msg["image"]
                name = msg["name"]
                ports = msg.get("ports", {})
                env = msg.get("env", {}) or {}
                volumes_in = msg.get("volumes", [])
                # docker-py wants either {host_path: {bind: container_path, mode}} or
                # named-volume strings via the `volumes` list. We accept the same
                # short syntax we use in JSON contracts ("NAME:PATH" or "/host:/ct"),
                # and translate to docker-py's preferred mapping form.
                volumes_map = {}
                for v in volumes_in:
                    parts = v.split(":")
                    if len(parts) < 2:
                        continue
                    host, container_path = parts[0], parts[1]
                    mode = parts[2] if len(parts) > 2 else "rw"
                    # Only auto-create host paths that don't yet exist. If the
                    # path *does* exist (file or dir), trust the operator —
                    # blindly calling makedirs on an existing file raises.
                    if host.startswith("/") and not os.path.exists(host):
                        os.makedirs(host, exist_ok=True)
                    volumes_map[host] = {"bind": container_path, "mode": mode}
                log.info("Installing appendage: %s (%s) ports=%s volumes=%s", name, image, ports, list(volumes_map))
                client.images.pull(image)
                # If a stale container with this name exists, remove it before re-running.
                try:
                    existing = client.containers.get(name)
                    log.info("Removing existing container %s", name)
                    existing.remove(force=True)
                except docker.errors.NotFound:
                    pass
                container = client.containers.run(
                    image,
                    name=name,
                    detach=True,
                    ports=ports,
                    environment=env or None,
                    volumes=volumes_map or None,
                    restart_policy={"Name": "unless-stopped"},
                )
                await ws.send(json.dumps({
                    "type": "command_result",
                    "command": cmd,
                    "success": True,
                    "container_id": container.short_id,
                    "name": name,
                    "requestId": msg.get("requestId"),
                }))
            elif cmd == "remove_appendage":
                import docker
                client = docker.from_env()
                name = msg["name"]
                request_id = msg.get("requestId")
                result = {"type": "command_result", "command": cmd, "name": name, "success": False}
                if request_id:
                    result["requestId"] = request_id
                try:
                    container = client.containers.get(name)
                    log.info("Removing appendage container: %s", name)
                    container.remove(force=True)
                    result["success"] = True
                except docker.errors.NotFound:
                    # Idempotent: already gone is success.
                    result["success"] = True
                    result["already_absent"] = True
                except Exception as e:
                    result["error"] = str(e)
                await ws.send(json.dumps(result))
            elif cmd in ("install_compose_appendage", "remove_compose_appendage"):
                import os
                import shutil
                import subprocess
                name = msg["name"]
                base = f"/opt/nest/data/appendages/{name}"
                file = msg.get("file") or "docker-compose.yml"
                request_id = msg.get("requestId")
                result = {"type": "command_result", "command": cmd, "name": name, "success": False}
                if request_id:
                    result["requestId"] = request_id

                # Build subprocess env: inherit current env, layer the explicit
                # contract env on top (so docker compose interpolates ${VAR}).
                proc_env = os.environ.copy()
                for k, v in (msg.get("env") or {}).items():
                    proc_env[k] = str(v)

                try:
                    if cmd == "install_compose_appendage":
                        git_url = msg.get("git")
                        inline = msg.get("inline")
                        branch = msg.get("branch") or "main"
                        init_script = msg.get("init_script")
                        os.makedirs(os.path.dirname(base), exist_ok=True)
                        if inline:
                            # Inline mode: write the compose YAML literal into the
                            # working dir. Idempotent — just rewrite the file.
                            os.makedirs(base, exist_ok=True)
                            with open(os.path.join(base, file), "w") as fh:
                                fh.write(inline)
                        elif git_url:
                            if not os.path.isdir(os.path.join(base, ".git")):
                                log.info("git clone %s -> %s", git_url, base)
                                if os.path.isdir(base):
                                    shutil.rmtree(base)
                                subprocess.run(
                                    ["git", "clone", "--depth", "1", "--branch", branch, git_url, base],
                                    check=True, env=proc_env, timeout=300,
                                )
                                if init_script:
                                    init_path = os.path.join(base, init_script)
                                    if os.path.isfile(init_path):
                                        log.info("running init_script %s", init_script)
                                        os.chmod(init_path, 0o755)
                                        subprocess.run([init_path], cwd=base, check=True, env=proc_env, timeout=600)
                                    else:
                                        log.warning("init_script %s not found in repo", init_script)
                            else:
                                log.info("git pull (already cloned)")
                                subprocess.run(["git", "-C", base, "pull", "--ff-only"], check=False, env=proc_env, timeout=120)
                        else:
                            raise ValueError("compose install requires git or inline")
                        log.info("docker compose -f %s up -d", file)
                        proc = subprocess.run(
                            ["docker", "compose", "-f", file, "up", "-d", "--quiet-pull"],
                            cwd=base, env=proc_env, timeout=900,
                            capture_output=True, text=True,
                        )
                        result["stdout"] = (proc.stdout or "")[-1000:]
                        result["stderr"] = (proc.stderr or "")[-1000:]
                        result["success"] = (proc.returncode == 0)
                    else:  # remove_compose_appendage
                        if not os.path.isdir(base):
                            result["success"] = True
                            result["already_absent"] = True
                        else:
                            log.info("docker compose -f %s down", file)
                            proc = subprocess.run(
                                ["docker", "compose", "-f", file, "down"],
                                cwd=base, env=proc_env, timeout=300,
                                capture_output=True, text=True,
                            )
                            result["stdout"] = (proc.stdout or "")[-1000:]
                            result["stderr"] = (proc.stderr or "")[-1000:]
                            result["success"] = (proc.returncode == 0)
                except subprocess.TimeoutExpired as e:
                    result["error"] = f"timeout: {e.cmd}"
                except subprocess.CalledProcessError as e:
                    result["error"] = f"command failed ({e.returncode}): {e.cmd}"
                except Exception as e:
                    result["error"] = str(e)
                await ws.send(json.dumps(result))
            elif cmd == "enhance":
                import subprocess
                action = msg.get("action")
                request_id = msg.get("requestId")
                result = {"type": "command_result", "command": cmd, "success": False}
                if request_id:
                    result["requestId"] = request_id

                if action == "add-dependency":
                    target = msg.get("target", "hub")
                    packages = msg.get("packages", [])
                    if not packages:
                        result["error"] = "No packages specified"
                    else:
                        target_dir = f"/opt/nest/{target}"
                        proc = subprocess.run(
                            ["npm", "install", "--save"] + packages,
                            cwd=target_dir,
                            capture_output=True, text=True, timeout=120,
                        )
                        result["success"] = proc.returncode == 0
                        result["stdout"] = proc.stdout[-500:] if proc.stdout else ""
                        result["stderr"] = proc.stderr[-500:] if proc.stderr else ""

                elif action == "rebuild":
                    target = msg.get("target", "hub")
                    if target == "all":
                        targets = ["hub"]
                    else:
                        targets = [target]
                    outputs = []
                    for t in targets:
                        if t == "hub":
                            proc = subprocess.run(
                                ["npm", "run", "build"],
                                cwd="/opt/nest/hub",
                                capture_output=True, text=True, timeout=120,
                            )
                        else:
                            continue
                        outputs.append({"target": t, "success": proc.returncode == 0, "output": proc.stdout[-300:] + proc.stderr[-300:]})
                    result["success"] = all(o["success"] for o in outputs)
                    result["outputs"] = outputs

                elif action == "pull":
                    proc = subprocess.run(
                        ["git", "pull", "--ff-only"],
                        cwd="/opt/nest",
                        capture_output=True, text=True, timeout=30,
                    )
                    result["success"] = proc.returncode == 0
                    result["stdout"] = proc.stdout[-500:] if proc.stdout else ""
                    result["stderr"] = proc.stderr[-500:] if proc.stderr else ""

                elif action == "deploy":
                    # Full pipeline: pull + rebuild hub + restart
                    steps = []
                    proc = subprocess.run(["git", "pull", "--ff-only"], cwd="/opt/nest", capture_output=True, text=True, timeout=30)
                    steps.append({"step": "pull", "success": proc.returncode == 0, "output": proc.stdout[-200:] + proc.stderr[-200:]})
                    if proc.returncode == 0:
                        proc = subprocess.run(["npm", "run", "build"], cwd="/opt/nest/hub", capture_output=True, text=True, timeout=120)
                        steps.append({"step": "build-hub", "success": proc.returncode == 0, "output": proc.stdout[-200:] + proc.stderr[-200:]})
                        proc = subprocess.run(["sudo", "systemctl", "restart", "nest-hub", "nest-agent"], capture_output=True, text=True, timeout=30)
                        steps.append({"step": "restart", "success": proc.returncode == 0, "output": proc.stderr[-200:] if proc.stderr else ""})
                    result["success"] = all(s["success"] for s in steps)
                    result["steps"] = steps

                elif action == "restart":
                    services = msg.get("services", ["nest-hub"])
                    proc = subprocess.run(
                        ["sudo", "systemctl", "restart"] + services,
                        capture_output=True, text=True, timeout=30,
                    )
                    result["success"] = proc.returncode == 0
                    result["stderr"] = proc.stderr[-300:] if proc.stderr else ""

                else:
                    result["error"] = f"Unknown enhance action: {action}"

                await ws.send(json.dumps(result))
            elif cmd == "clone_repo":
                import subprocess
                request_id = msg.get("requestId")
                repo_url = msg.get("url")
                name = msg.get("name")
                repos_dir = msg.get("reposDir", "/opt/repos")
                result = {"type": "command_result", "command": cmd, "success": False}
                if request_id:
                    result["requestId"] = request_id

                if not repo_url or not name:
                    result["error"] = "url and name required"
                else:
                    target = os.path.join(repos_dir, name)
                    if os.path.isdir(target):
                        proc = subprocess.run(
                            ["git", "-C", target, "pull", "--ff-only"],
                            capture_output=True, text=True, timeout=60,
                        )
                        result["action"] = "pull"
                    else:
                        os.makedirs(repos_dir, exist_ok=True)
                        proc = subprocess.run(
                            ["git", "clone", "--depth", "1", repo_url, target],
                            capture_output=True, text=True, timeout=120,
                        )
                        result["action"] = "clone"
                    result["success"] = proc.returncode == 0
                    result["stdout"] = proc.stdout[-500:] if proc.stdout else ""
                    result["stderr"] = proc.stderr[-500:] if proc.stderr else ""
                    result["path"] = target

                await ws.send(json.dumps(result))
            elif cmd == "discover":
                from .discovery import find_git_repos
                request_id = msg.get("requestId")
                repos = await asyncio.get_event_loop().run_in_executor(None, find_git_repos)
                result = {
                    "type": "command_result",
                    "command": cmd,
                    "success": True,
                    "repos": repos,
                }
                if request_id:
                    result["requestId"] = request_id
                await ws.send(json.dumps(result))
            elif cmd == "ping":
                await ws.send(json.dumps({"type": "pong"}))
        except Exception as e:
            log.error("Error handling command: %s", e)
            await ws.send(json.dumps({"type": "command_result", "success": False, "error": str(e), "requestId": msg.get("requestId", "")}))


async def connect():
    headers = {}
    if AGENT_TOKEN:
        headers["Authorization"] = f"Bearer {AGENT_TOKEN}"

    while True:
        try:
            log.info("Connecting to hub at %s", HUB_URL)
            async with websockets.connect(HUB_URL, additional_headers=headers) as ws:
                log.info("Connected to hub")

                # Send initial heartbeat
                hostname = os.uname().nodename
                await ws.send(json.dumps({"type": "hello", "hostname": hostname}))

                # Run metric senders and command listener concurrently.
                # FIRST_EXCEPTION + explicit cancel ensures siblings don't orphan
                # when handle_commands raises ConnectionClosed on disconnect.
                tasks = [
                    asyncio.create_task(send_loop(ws, "metrics", collect_system_metrics, METRICS_INTERVAL)),
                    asyncio.create_task(send_loop(ws, "containers", collect_containers, CONTAINERS_INTERVAL)),
                    asyncio.create_task(handle_commands(ws)),
                ]
                try:
                    done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_EXCEPTION)
                    for t in pending:
                        t.cancel()
                    await asyncio.gather(*pending, return_exceptions=True)
                    for t in done:
                        exc = t.exception()
                        if exc is not None:
                            raise exc
                finally:
                    for t in tasks:
                        if not t.done():
                            t.cancel()
        except (websockets.ConnectionClosed, ConnectionRefusedError, OSError) as e:
            log.warning("Connection lost: %s. Reconnecting in 5s...", e)
            await asyncio.sleep(5)
        except Exception as e:
            log.error("Unexpected error: %s. Reconnecting in 10s...", e)
            await asyncio.sleep(10)


def main():
    loop = asyncio.new_event_loop()

    def shutdown(sig, frame):
        log.info("Shutting down...")
        loop.stop()
        sys.exit(0)

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    loop.run_until_complete(connect())


if __name__ == "__main__":
    main()
