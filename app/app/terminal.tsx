import { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, Platform } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

export default function TerminalScreen() {
  const params = useLocalSearchParams<{ cmd?: string }>();
  const cmd = params.cmd || "";
  const title = cmd === "claude" ? "Claude Code" : "Terminal";
  const termRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const termInstanceRef = useRef<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS !== "web") return;

    let disposed = false;
    let term: any = null;
    let ws: WebSocket | null = null;
    let fitAddon: any = null;

    async function init() {
      // Dynamically import xterm (DOM library, web-only)
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");

      if (disposed || !termRef.current) return;

      // Inject xterm CSS
      if (!document.getElementById("xterm-css")) {
        const style = document.createElement("style");
        style.id = "xterm-css";
        style.textContent = `
          .xterm { height: 100%; }
          .xterm-viewport { overflow-y: auto !important; }
          .xterm .xterm-screen { height: 100%; }
        `;
        document.head.appendChild(style);

        // Load the actual xterm.css from node_modules via a link tag
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = "/node_modules/@xterm/xterm/css/xterm.css";
        document.head.appendChild(link);

        // Fallback: inject critical xterm styles inline
        const fallbackStyle = document.createElement("style");
        fallbackStyle.id = "xterm-css-fallback";
        fallbackStyle.textContent = `
          .xterm {
            cursor: text;
            position: relative;
            user-select: none;
            -ms-user-select: none;
            -webkit-user-select: none;
          }
          .xterm.focus, .xterm:focus { outline: none; }
          .xterm .xterm-helpers { position: absolute; top: 0; z-index: 5; }
          .xterm .xterm-helper-textarea {
            padding: 0; border: 0; margin: 0;
            position: absolute; opacity: 0;
            left: -9999em; top: 0; width: 0; height: 0;
            z-index: -5; white-space: nowrap; overflow: hidden; resize: none;
          }
          .xterm .composition-view { display: none; }
          .xterm .xterm-viewport {
            background-color: #000;
            overflow-y: scroll;
            cursor: default;
            position: absolute; right: 0; left: 0; top: 0; bottom: 0;
          }
          .xterm .xterm-screen {
            position: relative;
          }
          .xterm .xterm-screen canvas {
            position: absolute; left: 0; top: 0;
          }
          .xterm .xterm-decoration-container { position: absolute; top: 0; left: 0; right: 0; bottom: 0; }
          .xterm-cursor-layer { z-index: 4; }
        `;
        document.head.appendChild(fallbackStyle);
      }

      // Create terminal
      term = new Terminal({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
        theme: {
          background: "#0d0d1a",
          foreground: "#e0e0e0",
          cursor: "#7eb8ff",
          selectionBackground: "#3a3a5c",
        },
        allowProposedApi: true,
      });
      termInstanceRef.current = term;

      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(termRef.current);

      // Small delay to let DOM settle before fitting
      setTimeout(() => {
        if (!disposed) {
          try { fitAddon.fit(); } catch {}
        }
      }, 100);

      // Connect WebSocket
      const token = localStorage.getItem("nest_token");
      if (!token) {
        setError("Not authenticated");
        return;
      }

      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${proto}//${window.location.host}/ws/terminal?cmd=${encodeURIComponent(cmd)}&token=${encodeURIComponent(token)}`;
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        // Send initial size
        ws!.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      };

      ws.onmessage = (event) => {
        if (typeof event.data === "string") {
          // Could be a JSON message or raw terminal data
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === "error") {
              term.write(`\r\n\x1b[31mError: ${msg.message}\x1b[0m\r\n`);
              return;
            }
            if (msg.type === "output") {
              term.write(msg.data);
              return;
            }
          } catch {
            // Not JSON, treat as raw terminal output
            term.write(event.data);
          }
        }
      };

      ws.onerror = () => {
        term.write("\r\n\x1b[31mWebSocket connection error\x1b[0m\r\n");
      };

      ws.onclose = (event) => {
        term.write(`\r\n\x1b[90m--- Session ended (code ${event.code}) ---\x1b[0m\r\n`);
      };

      // Send terminal input to server (raw, not JSON — server writes directly to PTY)
      term.onData((data: string) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      });

      // Handle resize
      term.onResize(({ cols, rows }: { cols: number; rows: number }) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "resize", cols, rows }));
        }
      });

      // Re-fit on window resize
      const handleResize = () => {
        try { fitAddon.fit(); } catch {}
      };
      window.addEventListener("resize", handleResize);

      // Store cleanup for resize listener
      (term as any)._nestResizeHandler = handleResize;
    }

    init();

    return () => {
      disposed = true;
      if ((termInstanceRef.current as any)?._nestResizeHandler) {
        window.removeEventListener("resize", (termInstanceRef.current as any)._nestResizeHandler);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (termInstanceRef.current) {
        termInstanceRef.current.dispose();
        termInstanceRef.current = null;
      }
    };
  }, [cmd]);

  if (Platform.OS !== "web") {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#0d0d1a" }}>
        <Text style={{ color: "#e0e0e0", fontSize: 16 }}>Terminal is only available on web</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#0d0d1a" }}>
      {/* Header */}
      <View style={{
        flexDirection: "row",
        alignItems: "center",
        paddingTop: 12,
        paddingBottom: 12,
        paddingHorizontal: 16,
        backgroundColor: "#16162a",
        borderBottomWidth: 1,
        borderBottomColor: "#2a2a4a",
      }}>
        <Pressable
          onPress={() => router.back()}
          style={{
            paddingVertical: 6,
            paddingHorizontal: 12,
            backgroundColor: "#2a2a4a",
            borderRadius: 6,
            marginRight: 16,
          }}
        >
          <Text style={{ color: "#7eb8ff", fontSize: 14 }}>Back</Text>
        </Pressable>
        <Text style={{ color: "#fff", fontSize: 20, fontWeight: "bold" }}>{title}</Text>
      </View>

      {/* Terminal container */}
      {error ? (
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <Text style={{ color: "#ef4444", fontSize: 16 }}>{error}</Text>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <div
            ref={termRef as any}
            style={{ width: "100%", height: "100%", overflow: "hidden" }}
          />
        </View>
      )}
    </View>
  );
}
