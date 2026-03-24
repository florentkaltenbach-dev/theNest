import { useEffect, useState } from "react";
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

function StatusDot({ status }: { status: string }) {
  const color = status === "running" ? "#22c55e" : status === "off" ? "#ef4444" : "#eab308";
  return <View style={[styles.dot, { backgroundColor: color }]} />;
}

function GaugeBar({ label, percent, detail }: { label: string; percent: number; detail?: string }) {
  const color = percent > 80 ? "#ef4444" : percent > 60 ? "#eab308" : "#22c55e";
  return (
    <View style={styles.gauge}>
      <View style={styles.gaugeHeader}>
        <Text style={styles.gaugeLabel}>{label}</Text>
        <Text style={styles.gaugePercent}>{percent}%</Text>
      </View>
      <View style={styles.gaugeTrack}>
        <View style={[styles.gaugeFill, { width: `${Math.min(percent, 100)}%`, backgroundColor: color }]} />
      </View>
      {detail && <Text style={styles.gaugeDetail}>{detail}</Text>}
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

function ServerCard({ server, metrics }: { server: Server; metrics?: AgentMetrics }) {
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
        <View style={styles.gauges}>
          <GaugeBar label="CPU" percent={metrics.cpu.percent} />
          <GaugeBar
            label="RAM"
            percent={metrics.memory.percent}
            detail={`${metrics.memory.used_mb}MB / ${metrics.memory.total_mb}MB`}
          />
          <GaugeBar
            label="Disk"
            percent={metrics.disk.percent}
            detail={`${metrics.disk.used_gb}GB / ${metrics.disk.total_gb}GB`}
          />
        </View>
      ) : (
        <View style={styles.gauges}>
          <GaugeBar label="CPU" percent={0} detail={`${server.cores} cores`} />
          <GaugeBar label="RAM" percent={0} detail={`${server.memory} GB`} />
          <GaugeBar label="Disk" percent={0} detail={`${server.disk} GB`} />
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
        setAgentMetrics((prev) => ({ ...prev, [msg.hostname]: msg.data }));
      }
      if (msg.type === "agents" && Array.isArray(msg.data)) {
        const map: Record<string, AgentMetrics> = {};
        for (const a of msg.data) {
          if (a.metrics) map[a.hostname] = a.metrics;
        }
        setAgentMetrics(map);
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
        <ServerCard key={s.id} server={s} metrics={agentMetrics[s.name]} />
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
  gauges: { gap: 10 },
  gauge: {},
  gaugeHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 3 },
  gaugeLabel: { fontSize: 11, color: "#999", textTransform: "uppercase", letterSpacing: 0.5 },
  gaugePercent: { fontSize: 11, fontWeight: "600", color: "#1a1a2e" },
  gaugeTrack: { height: 6, backgroundColor: "#f0f0f0", borderRadius: 3, overflow: "hidden" },
  gaugeFill: { height: "100%", borderRadius: 3 },
  gaugeDetail: { fontSize: 10, color: "#bbb", marginTop: 2 },
  cardFooter: { flexDirection: "row", justifyContent: "space-between", marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: "#f0f0f0" },
  footerText: { fontSize: 11, color: "#999" },
});
