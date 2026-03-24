import { useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { getHealth } from "../../services/api";

export default function SettingsScreen() {
  const [health, setHealth] = useState<{ version: string; uptime: number } | null>(null);

  useEffect(() => {
    getHealth().then(setHealth).catch(() => {});
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Settings</Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Hub</Text>
        {health ? (
          <>
            <Text style={styles.item}>Version: {health.version}</Text>
            <Text style={styles.item}>Uptime: {Math.floor(health.uptime)}s</Text>
          </>
        ) : (
          <Text style={styles.item}>Connecting...</Text>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>About</Text>
        <Text style={styles.item}>Nest v0.1.0</Text>
        <Text style={styles.itemSub}>Self-hosted platform manager</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5", padding: 16 },
  heading: { fontSize: 24, fontWeight: "700", color: "#1a1a2e", marginBottom: 24 },
  section: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: { fontSize: 13, color: "#999", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },
  item: { fontSize: 15, color: "#333", marginBottom: 4 },
  itemSub: { fontSize: 13, color: "#999" },
});
