import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { getServer, Server } from "../../services/api";
import { connectWs, onWsMessage } from "../../services/ws";

function formatBytes(bytes: number | null): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let b = bytes;
  while (b >= 1024 && i < units.length - 1) { b /= 1024; i++; }
  return `${b.toFixed(1)} ${units[i]}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function StatusBadge({ status }: { status: string }) {
  const color = status === "running" ? "#22c55e" : status === "off" ? "#ef4444" : "#eab308";
  return (
    <View style={[styles.badge, { backgroundColor: color + "20", borderColor: color }]}>
      <View style={[styles.badgeDot, { backgroundColor: color }]} />
      <Text style={[styles.badgeText, { color }]}>{status}</Text>
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

export default function ServerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [server, setServer] = useState<Server | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [liveMetrics, setLiveMetrics] = useState<any>(null);
  const [liveContainers, setLiveContainers] = useState<any[]>([]);

  useEffect(() => {
    if (!id) return;
    getServer(parseInt(id, 10))
      .then((data) => { setServer(data.server); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    connectWs();
    const unsub = onWsMessage((msg) => {
      if (msg.type === "metrics") setLiveMetrics(msg.data);
      if (msg.type === "containers") setLiveContainers(msg.data);
      if (msg.type === "agents" && Array.isArray(msg.data) && msg.data.length > 0) {
        setLiveMetrics(msg.data[0].metrics);
        setLiveContainers(msg.data[0].containers || []);
      }
    });
    return unsub;
  }, []);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1a1a2e" />
      </View>
    );
  }

  if (error || !server) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error || "Server not found"}</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <Pressable onPress={() => router.back()} style={styles.backButton}>
        <Text style={styles.backText}>← Back</Text>
      </Pressable>

      <View style={styles.header}>
        <Text style={styles.name}>{server.name}</Text>
        <StatusBadge status={server.status} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Overview</Text>
        <InfoRow label="IP Address" value={server.ip} />
        <InfoRow label="IPv6" value={server.ipv6?.split("/")[0] || "—"} />
        <InfoRow label="Type" value={`${server.typeDescription || server.type}`} />
        <InfoRow label="Image" value={server.image} />
        <InfoRow label="Location" value={server.location} />
        <InfoRow label="Datacenter" value={server.datacenter} />
        <InfoRow label="Created" value={formatDate(server.created)} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Resources</Text>
        <View style={styles.resourceGrid}>
          <View style={styles.resourceCard}>
            <Text style={styles.resourceValue}>{server.cores}</Text>
            <Text style={styles.resourceLabel}>CPU Cores</Text>
          </View>
          <View style={styles.resourceCard}>
            <Text style={styles.resourceValue}>{server.memory}</Text>
            <Text style={styles.resourceLabel}>RAM (GB)</Text>
          </View>
          <View style={styles.resourceCard}>
            <Text style={styles.resourceValue}>{server.disk}</Text>
            <Text style={styles.resourceLabel}>Disk (GB)</Text>
          </View>
        </View>
      </View>

      {liveMetrics && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Live Metrics</Text>
          <View style={styles.resourceGrid}>
            <View style={styles.resourceCard}>
              <Text style={styles.resourceValue}>{liveMetrics.cpu.percent}%</Text>
              <Text style={styles.resourceLabel}>CPU</Text>
            </View>
            <View style={styles.resourceCard}>
              <Text style={styles.resourceValue}>{liveMetrics.memory.percent}%</Text>
              <Text style={styles.resourceLabel}>RAM ({liveMetrics.memory.used_mb}MB)</Text>
            </View>
            <View style={styles.resourceCard}>
              <Text style={styles.resourceValue}>{liveMetrics.disk.percent}%</Text>
              <Text style={styles.resourceLabel}>Disk ({liveMetrics.disk.used_gb}GB)</Text>
            </View>
          </View>
          <View style={{ marginTop: 8 }}>
            <InfoRow label="Load (1m / 5m / 15m)" value={`${liveMetrics.load["1m"]} / ${liveMetrics.load["5m"]} / ${liveMetrics.load["15m"]}`} />
            <InfoRow label="Uptime" value={`${Math.floor(liveMetrics.uptime_seconds / 3600)}h ${Math.floor((liveMetrics.uptime_seconds % 3600) / 60)}m`} />
          </View>
        </View>
      )}

      {liveContainers.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Containers ({liveContainers.length})</Text>
          {liveContainers.map((c: any) => (
            <View key={c.id} style={styles.containerRow}>
              <View style={[styles.badgeDot, { backgroundColor: c.status === "running" ? "#22c55e" : "#ef4444" }]} />
              <Text style={styles.containerName}>{c.name}</Text>
              <Text style={styles.containerImage}>{c.image}</Text>
              {c.cpu_percent !== undefined && (
                <Text style={styles.containerStat}>{c.cpu_percent}% / {c.memory_mb}MB</Text>
              )}
            </View>
          ))}
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Traffic</Text>
        <InfoRow label="Inbound" value={formatBytes(server.inTraffic)} />
        <InfoRow label="Outbound" value={formatBytes(server.outTraffic)} />
        <InfoRow label="Included" value={formatBytes(server.includedTraffic)} />
      </View>

      <View style={[styles.section, { marginBottom: 32 }]}>
        <Text style={styles.sectionTitle}>Features</Text>
        <InfoRow label="Backups" value={server.backups ? "Enabled" : "Disabled"} />
        <InfoRow label="Rescue Mode" value={server.rescue ? "Active" : "Off"} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5", padding: 16 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#f5f5f5" },
  errorText: { color: "#ef4444", fontSize: 16 },
  backButton: { marginBottom: 16 },
  backText: { fontSize: 15, color: "#1a1a2e", fontWeight: "500" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 20 },
  name: { fontSize: 26, fontWeight: "700", color: "#1a1a2e", flex: 1 },
  badge: { flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  badgeDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  badgeText: { fontSize: 13, fontWeight: "600", textTransform: "uppercase" },
  section: { backgroundColor: "#fff", borderRadius: 12, padding: 16, marginBottom: 12 },
  sectionTitle: { fontSize: 13, color: "#999", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 },
  infoRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#f0f0f0" },
  infoLabel: { fontSize: 14, color: "#666" },
  infoValue: { fontSize: 14, color: "#1a1a2e", fontWeight: "500" },
  resourceGrid: { flexDirection: "row", gap: 12 },
  resourceCard: { flex: 1, backgroundColor: "#f8f9fa", borderRadius: 8, padding: 16, alignItems: "center" },
  resourceValue: { fontSize: 28, fontWeight: "700", color: "#1a1a2e" },
  resourceLabel: { fontSize: 12, color: "#999", marginTop: 4 },
  containerRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#f0f0f0", gap: 8 },
  containerName: { fontSize: 14, fontWeight: "500", color: "#1a1a2e", flex: 1 },
  containerImage: { fontSize: 12, color: "#999" },
  containerStat: { fontSize: 12, color: "#666", minWidth: 80, textAlign: "right" },
});
