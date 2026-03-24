import { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Pressable,
} from "react-native";
import { router } from "expo-router";
import { getServers, Server } from "../../services/api";
import { connectWs, onWsMessage } from "../../services/ws";

const HISTORY_SIZE = 30;

function barColor(percent: number): string {
  if (percent > 80) return "#ef4444";
  if (percent > 60) return "#eab308";
  return "#22c55e";
}

function StatusDot({ status }: { status: string }) {
  const color = status === "running" ? "#22c55e" : status === "off" ? "#ef4444" : "#eab308";
  return <View style={[styles.dot, { backgroundColor: color }]} />;
}

function Histogram({ label, current, history, detail }: {
  label: string;
  current: number;
  history: number[];
  detail?: string;
}) {
  const bars = history.length > 0 ? history : [0];
  // Auto-scale: find min/max and add headroom so low values still show variation
  const minVal = Math.min(...bars);
  const maxVal = Math.max(...bars);
  const range = maxVal - minVal;
  // Floor at 0, ceiling at max + headroom (at least 10% range)
  const scaleMin = Math.max(0, minVal - Math.max(range * 0.3, 2));
  const scaleMax = maxVal + Math.max(range * 0.3, 5);
  const scaleRange = scaleMax - scaleMin || 1;

  return (
    <View style={styles.histogram}>
      <View style={styles.histHeader}>
        <Text style={styles.histLabel}>{label}</Text>
        <Text style={[styles.histValue, { color: barColor(current) }]}>{current}%</Text>
      </View>
      <View style={styles.histBars}>
        {bars.map((val, i) => {
          const scaled = ((val - scaleMin) / scaleRange) * 100;
          return (
          <View key={i} style={styles.histBarSlot}>
            <View
              style={[
                styles.histBar,
                {
                  height: `${Math.max(scaled, 3)}%`,
                  backgroundColor: barColor(val),
                  opacity: 0.5 + (i / bars.length) * 0.5,
                },
              ]}
            />
          </View>
          );
        })}
      </View>
      {detail && <Text style={styles.histDetail}>{detail}</Text>}
    </View>
  );
}

interface AgentMetrics {
  cpu: { percent: number };
  memory: { percent: number; used_mb: number; total_mb: number };
  disk: { percent: number; used_gb: number; total_gb: number };
  load: { "1m": number };
  uptime_seconds: number;
}

interface MetricsHistory {
  cpu: number[];
  ram: number[];
  disk: number[];
}

function ServerCard({ server, metrics, history }: { server: Server; metrics?: AgentMetrics; history?: MetricsHistory }) {
  const cpuHistory = history?.cpu || [];
  const ramHistory = history?.ram || [];
  const diskHistory = history?.disk || [];

  return (
    <Pressable style={styles.card} onPress={() => router.push(`/server/${server.id}`)}>
      <View style={styles.cardHeader}>
        <StatusDot status={server.status} />
        <View style={styles.cardHeaderText}>
          <Text style={styles.cardTitle}>{server.name}</Text>
          <Text style={styles.cardSub}>{server.ip} · {server.location}</Text>
        </View>
        <Text style={styles.cardType}>{server.type}</Text>
      </View>

      {metrics ? (
        <View style={styles.histograms}>
          <Histogram label="CPU" current={metrics.cpu.percent} history={cpuHistory} />
          <Histogram
            label="RAM"
            current={metrics.memory.percent}
            history={ramHistory}
            detail={`${metrics.memory.used_mb}MB / ${metrics.memory.total_mb}MB`}
          />
          <Histogram
            label="Disk"
            current={metrics.disk.percent}
            history={diskHistory}
            detail={`${metrics.disk.used_gb}GB / ${metrics.disk.total_gb}GB`}
          />
        </View>
      ) : (
        <View style={styles.histograms}>
          <Histogram label="CPU" current={0} history={[]} detail={`${server.cores} cores`} />
          <Histogram label="RAM" current={0} history={[]} detail={`${server.memory} GB`} />
          <Histogram label="Disk" current={0} history={[]} detail={`${server.disk} GB`} />
        </View>
      )}

      {metrics && (
        <View style={styles.cardFooter}>
          <Text style={styles.footerText}>Load {metrics.load["1m"]}</Text>
          <Text style={styles.footerText}>Up {Math.floor(metrics.uptime_seconds / 3600)}h {Math.floor((metrics.uptime_seconds % 3600) / 60)}m</Text>
        </View>
      )}
    </Pressable>
  );
}

export default function ServersScreen() {
  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [agentMetrics, setAgentMetrics] = useState<Record<string, AgentMetrics>>({});
  const historyRef = useRef<Record<string, MetricsHistory>>({});
  const [historyState, setHistoryState] = useState<Record<string, MetricsHistory>>({});

  const load = async () => {
    try {
      const data = await getServers();
      setServers(data);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    connectWs();
    return onWsMessage((msg) => {
      if (msg.type === "metrics" && msg.hostname) {
        const m = msg.data;
        setAgentMetrics((prev) => ({ ...prev, [msg.hostname]: m }));

        // Append to history
        const h = historyRef.current[msg.hostname] || { cpu: [], ram: [], disk: [] };
        h.cpu = [...h.cpu.slice(-(HISTORY_SIZE - 1)), m.cpu.percent];
        h.ram = [...h.ram.slice(-(HISTORY_SIZE - 1)), m.memory.percent];
        h.disk = [...h.disk.slice(-(HISTORY_SIZE - 1)), m.disk.percent];
        historyRef.current[msg.hostname] = h;
        setHistoryState({ ...historyRef.current });
      }
      if (msg.type === "agents" && Array.isArray(msg.data)) {
        const map: Record<string, AgentMetrics> = {};
        for (const a of msg.data) {
          if (a.metrics) {
            map[a.hostname] = a.metrics;
            // Seed history with initial value
            if (!historyRef.current[a.hostname]) {
              historyRef.current[a.hostname] = {
                cpu: [a.metrics.cpu.percent],
                ram: [a.metrics.memory.percent],
                disk: [a.metrics.disk.percent],
              };
            }
          }
        }
        setAgentMetrics(map);
        setHistoryState({ ...historyRef.current });
      }
    });
  }, []);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1a1a2e" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
    >
      <Text style={styles.heading}>{servers.length} Server{servers.length !== 1 ? "s" : ""}</Text>
      {servers.map((s) => (
        <ServerCard key={s.id} server={s} metrics={agentMetrics[s.name]} history={historyState[s.name]} />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5", padding: 16 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#f5f5f5" },
  heading: { fontSize: 24, fontWeight: "700", color: "#1a1a2e", marginBottom: 16 },
  error: { color: "#ef4444", fontSize: 16 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", marginBottom: 14 },
  cardHeaderText: { flex: 1, marginLeft: 10 },
  cardTitle: { fontSize: 16, fontWeight: "600", color: "#1a1a2e" },
  cardSub: { fontSize: 12, color: "#999", marginTop: 2 },
  cardType: { fontSize: 12, color: "#999", backgroundColor: "#f0f0f0", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, overflow: "hidden", textTransform: "uppercase", fontWeight: "500" },
  dot: { width: 10, height: 10, borderRadius: 5 },
  histograms: { gap: 12 },
  histogram: {},
  histHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  histLabel: { fontSize: 11, color: "#999", textTransform: "uppercase", letterSpacing: 0.5 },
  histValue: { fontSize: 12, fontWeight: "700" },
  histBars: { flexDirection: "row", height: 40, alignItems: "flex-end", gap: 1, backgroundColor: "#f8f9fa", borderRadius: 4, overflow: "hidden", padding: 2 },
  histBarSlot: { flex: 1, height: "100%", justifyContent: "flex-end" },
  histBar: { width: "100%", borderRadius: 1, minHeight: 1 },
  histDetail: { fontSize: 10, color: "#bbb", marginTop: 2 },
  cardFooter: { flexDirection: "row", justifyContent: "space-between", marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: "#f0f0f0" },
  footerText: { fontSize: 11, color: "#999" },
});
