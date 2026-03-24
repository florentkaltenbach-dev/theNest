import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { getServers, Server } from "../../services/api";

function StatusDot({ status }: { status: string }) {
  const color = status === "running" ? "#22c55e" : status === "off" ? "#ef4444" : "#eab308";
  return <View style={[styles.dot, { backgroundColor: color }]} />;
}

function ServerCard({ server }: { server: Server }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <StatusDot status={server.status} />
        <Text style={styles.cardTitle}>{server.name}</Text>
        <Text style={styles.cardStatus}>{server.status}</Text>
      </View>
      <View style={styles.cardBody}>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>IP</Text>
          <Text style={styles.statValue}>{server.ip}</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Type</Text>
          <Text style={styles.statValue}>{server.type}</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>CPU</Text>
          <Text style={styles.statValue}>{server.cores} cores</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>RAM</Text>
          <Text style={styles.statValue}>{server.memory} GB</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Disk</Text>
          <Text style={styles.statValue}>{server.disk} GB</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Location</Text>
          <Text style={styles.statValue}>{server.location}</Text>
        </View>
      </View>
    </View>
  );
}

export default function ServersScreen() {
  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

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
        <ServerCard key={s.id} server={s} />
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
  cardHeader: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  cardTitle: { fontSize: 18, fontWeight: "600", color: "#1a1a2e", marginLeft: 8, flex: 1 },
  cardStatus: { fontSize: 13, color: "#666", textTransform: "uppercase", letterSpacing: 0.5 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  cardBody: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  stat: { minWidth: 100 },
  statLabel: { fontSize: 11, color: "#999", textTransform: "uppercase", letterSpacing: 0.5 },
  statValue: { fontSize: 14, color: "#333", fontWeight: "500" },
});
