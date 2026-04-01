import { useEffect, useState, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl, Pressable,
} from "react-native";
import { getTokenLimits, getTokenWaste } from "../../services/api";

interface RateWindow { utilization_pct: number; remaining_seconds: number }
interface TokenLimits {
  status: "allowed" | "limited"; subscription: string;
  session: RateWindow; weekly: RateWindow; overage_available: boolean;
}
interface TokenWaste {
  current_session_pct: number;
  completed_windows: Array<{ ended: string; peak_pct: number }>;
  week_total_windows: number; week_avg_pct: number; week_total_burned: number;
}

const barColor = (pct: number) => pct > 80 ? "#ef4444" : pct > 50 ? "#eab308" : "#22c55e";

function formatCountdown(s: number) {
  if (s <= 0) return "now";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h} hr ${m} min` : `${m} min`;
}

function formatAgo(ms: number) {
  const m = Math.floor(ms / 60000);
  return m < 1 ? "just now" : m === 1 ? "1 minute ago" : `${m} minutes ago`;
}

function formatRelativeTime(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

const Badge = ({ bg, color, label }: { bg: string; color: string; label: string }) => (
  <View style={[s.badge, { backgroundColor: bg }]}>
    <Text style={{ fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.3, color }}>{label}</Text>
  </View>
);

const Row = ({ label, value, color }: { label: string; value: string; color?: string }) => (
  <View style={s.row}>
    <Text style={{ fontSize: 13, color: "#666" }}>{label}</Text>
    <Text style={{ fontSize: 13, fontWeight: "600", color: color ?? "#1a1a2e" }}>{value}</Text>
  </View>
);

const Bar = ({ pct }: { pct: number }) => (
  <View style={s.track}>
    <View style={{ height: "100%", borderRadius: 5, width: `${Math.min(100, Math.max(0, pct))}%`, backgroundColor: barColor(pct) }} />
  </View>
);

function LimitCard({ title, window: w }: { title: string; window: RateWindow }) {
  const pct = Math.round(w.utilization_pct);
  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>{title}</Text>
      <Bar pct={pct} />
      <View style={[s.row, { marginTop: 8 }]}>
        <Text style={{ fontSize: 14, fontWeight: "700", color: barColor(pct) }}>{pct}% used</Text>
        <Text style={{ fontSize: 12, color: "#999" }}>Resets in {formatCountdown(w.remaining_seconds)}</Text>
      </View>
    </View>
  );
}

export default function TokensScreen() {
  const [limits, setLimits] = useState<TokenLimits | null>(null);
  const [waste, setWaste] = useState<TokenWaste | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastFetched, setLastFetched] = useState(Date.now());
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      const [l, w] = await Promise.all([getTokenLimits(), getTokenWaste()]);
      setLimits(l); setWaste(w); setError(null); setLastFetched(Date.now());
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 5 * 60_000); return () => clearInterval(t); }, [load]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);

  const refresh = () => { setRefreshing(true); load(); };

  if (loading) return <View style={s.center}><ActivityIndicator size="large" color="#1a1a2e" /></View>;
  if (error) return (
    <View style={s.center}>
      <Text style={{ color: "#ef4444", fontSize: 16, marginBottom: 12 }}>{error}</Text>
      <Pressable style={s.btn} onPress={() => { setLoading(true); load(); }}>
        <Text style={s.btnText}>Retry</Text>
      </Pressable>
    </View>
  );
  if (!limits) return null;

  const allowed = limits.status === "allowed";
  return (
    <ScrollView style={s.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
      <View style={s.row}>
        <Text style={{ fontSize: 24, fontWeight: "700", color: "#1a1a2e" }}>Rate Limits</Text>
        <Pressable style={[s.btn, { paddingHorizontal: 14, paddingVertical: 7 }]} onPress={refresh}>
          <Text style={[s.btnText, { fontSize: 13 }]}>Refresh</Text>
        </Pressable>
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginVertical: 16 }}>
        <Badge bg={allowed ? "#dcfce7" : "#fee2e2"} color={allowed ? "#16a34a" : "#dc2626"} label={limits.status} />
        <Badge bg="#ede9fe" color="#7c3aed" label={limits.subscription} />
        <Badge
          bg={limits.overage_available ? "#dbeafe" : "#f3f4f6"}
          color={limits.overage_available ? "#2563eb" : "#9ca3af"}
          label={`Overage ${limits.overage_available ? "available" : "disabled"}`}
        />
      </View>

      <LimitCard title="Session limit (5-hour window)" window={limits.session} />
      <LimitCard title="Weekly limit (7-day window)" window={limits.weekly} />

      {waste && (
        <View style={s.card}>
          <Text style={s.cardTitle}>Usage Tracker</Text>
          <Row label="This session peak" value={`${waste.current_session_pct}%`} color={barColor(waste.current_session_pct)} />
          <Bar pct={waste.current_session_pct} />
          <View style={{ height: 12 }} />
          <Row label="This week" value={`${waste.week_total_windows} windows completed`} />
          <Row label="Average burn" value={`${waste.week_avg_pct}% per window`} />
          <Row label="Total accumulated" value={`${waste.week_total_burned}%`} />
          {waste.completed_windows.length > 0 && (
            <View style={{ marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: "#f0f0f0" }}>
              <Text style={{ fontSize: 13, color: "#666", marginBottom: 6 }}>Recent windows</Text>
              {waste.completed_windows.map((w, i) => (
                <View key={i} style={[s.row, { paddingVertical: 4 }]}>
                  <Text style={{ fontSize: 12, color: "#999" }}>{formatRelativeTime(w.ended)}</Text>
                  <Text style={{ fontSize: 12, fontWeight: "600", color: barColor(w.peak_pct) }}>{w.peak_pct}% burned</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      <Text style={{ fontSize: 11, color: "#bbb", textAlign: "center", marginTop: 8, marginBottom: 32 }}>
        Last updated: {formatAgo(now - lastFetched)}
      </Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5", padding: 16 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#f5f5f5" },
  card: {
    backgroundColor: "#fff", borderRadius: 12, padding: 16, marginBottom: 12,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  cardTitle: { fontSize: 14, fontWeight: "600", color: "#1a1a2e", marginBottom: 12 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  track: { height: 10, backgroundColor: "#f0f0f0", borderRadius: 5, overflow: "hidden" },
  badge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6 },
  btn: { backgroundColor: "#1a1a2e", paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 },
  btnText: { color: "#fff", fontWeight: "600" },
});
