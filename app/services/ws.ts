import { getToken } from "./api";

type MessageHandler = (msg: any) => void;

let socket: WebSocket | null = null;
let listeners: MessageHandler[] = [];
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function getWsUrl(): string {
  if (typeof window === "undefined") return "";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws/client`;
}

export function connectWs() {
  if (typeof window === "undefined") return;
  if (socket?.readyState === WebSocket.OPEN) return;

  const url = getWsUrl();
  if (!url) return;

  socket = new WebSocket(url);

  socket.onopen = () => {
    console.log("[ws] connected");
  };

  socket.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      for (const fn of listeners) fn(msg);
    } catch {}
  };

  socket.onclose = () => {
    console.log("[ws] disconnected, reconnecting in 3s...");
    reconnectTimer = setTimeout(connectWs, 3000);
  };

  socket.onerror = () => {
    socket?.close();
  };
}

export function disconnectWs() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  socket?.close();
  socket = null;
}

export function onWsMessage(handler: MessageHandler) {
  listeners.push(handler);
  return () => {
    listeners = listeners.filter((fn) => fn !== handler);
  };
}

export function sendWsCommand(hostname: string, command: string, payload: Record<string, any> = {}) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "command", hostname, command, ...payload }));
  }
}
