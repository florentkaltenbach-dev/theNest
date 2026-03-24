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
                }))
            elif cmd == "ping":
                await ws.send(json.dumps({"type": "pong"}))
        except Exception as e:
            log.error("Error handling command: %s", e)
            await ws.send(json.dumps({"type": "command_result", "success": False, "error": str(e)}))


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
