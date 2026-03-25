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
        except Exception as e:
            log.warning("Error collecting %s: %s", msg_type, e)
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
                import docker
                client = docker.from_env()
                image = msg["image"]
                name = msg["name"]
                ports = msg.get("ports", {})
                log.info("Installing appendage: %s (%s)", name, image)
                client.images.pull(image)
                container = client.containers.run(
                    image,
                    name=name,
                    detach=True,
                    ports=ports,
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
                        targets = ["hub", "app"]
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
                        elif t == "app":
                            proc = subprocess.run(
                                ["npx", "expo", "export", "--platform", "web"],
                                cwd="/opt/nest/app",
                                capture_output=True, text=True, timeout=120,
                            )
                        else:
                            continue
                        outputs.append({"target": t, "success": proc.returncode == 0, "output": proc.stdout[-300:] + proc.stderr[-300:]})
                    result["success"] = all(o["success"] for o in outputs)
                    result["outputs"] = outputs

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

                # Run metric senders and command listener concurrently
                await asyncio.gather(
                    send_loop(ws, "metrics", collect_system_metrics, METRICS_INTERVAL),
                    send_loop(ws, "containers", collect_containers, CONTAINERS_INTERVAL),
                    handle_commands(ws),
                )
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
