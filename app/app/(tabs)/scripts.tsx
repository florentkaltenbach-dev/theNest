import { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from "react-native";
import {
  getScripts,
  getServers,
  getScriptContent,
  runScript,
  getScriptRun,
  Script,
  Server,
  ScriptRun,
} from "../../services/api";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: color }]}>
      <Text style={styles.badgeText}>{label}</Text>
    </View>
  );
}

function ScriptCard({
  script,
  onRun,
  onView,
}: {
  script: Script;
  onRun: (path: string, repo: string | null) => void;
  onView: (path: string, repo: string | null) => void;
}) {
  const targetColors: Record<string, string> = {
    remote: "#3b82f6",
    local: "#8b5cf6",
    any: "#6b7280",
  };
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>{script.name}</Text>
        <View style={styles.badgeRow}>
          {script.repo && <Badge label={script.repo} color="#7c3aed" />}
          {script.dangerous && <Badge label="dangerous" color="#ef4444" />}
          <Badge label={script.target === "local" ? "library" : script.target} color={targetColors[script.target] || "#6b7280"} />
        </View>
      </View>
      <Text style={styles.cardPath}>{script.path}</Text>
      {script.description && (
        <Text style={styles.cardDesc}>{script.description}</Text>
      )}
      <View style={styles.cardMeta}>
        <Text style={styles.metaText}>{script.lines} lines</Text>
        <Text style={styles.metaDot}>{" \u00b7 "}</Text>
        <Text style={styles.metaText}>{timeAgo(script.modified)}</Text>
      </View>
      {script.args && (
        <Text style={styles.metaLine}>Args: {script.args}</Text>
      )}
      {script.sources.length > 0 && (
        <Text style={styles.metaLine}>Sources: {script.sources.join(", ")}</Text>
      )}
      <View style={styles.cardActions}>
        <Pressable style={styles.btnView} onPress={() => onView(script.path, script.repo)}>
          <Text style={styles.btnViewText}>View</Text>
        </Pressable>
        {script.target !== "local" && (
          <Pressable style={styles.btnRun} onPress={() => onRun(script.path, script.repo)}>
            <Text style={styles.btnRunText}>Run</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

export default function ScriptsScreen() {
  const [scripts, setScripts] = useState<Script[]>([]);
  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeRun, setActiveRun] = useState<ScriptRun | null>(null);
  const [selectedServer, setSelectedServer] = useState<Server | null>(null);
  const [showServerPicker, setShowServerPicker] = useState<{ path: string; repo: string | null } | null>(null);
  const [viewContent, setViewContent] = useState<{ path: string; content: string; repo?: string | null } | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    Promise.all([getScripts(), getServers()]).then(([s, srv]) => {
      setScripts(s);
      setServers(srv);
      if (srv.length > 0) setSelectedServer(srv[0]);
      setLoading(false);
    });
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const handleRun = async (scriptPath: string, repo: string | null = null) => {
    if (!selectedServer) {
      setShowServerPicker({ path: scriptPath, repo });
      return;
    }
    if (servers.length > 1 && !showServerPicker) {
      setShowServerPicker({ path: scriptPath, repo });
      return;
    }
    await executeRun(scriptPath, selectedServer.ip, repo);
  };

  const handleView = async (scriptPath: string, repo: string | null = null) => {
    setViewLoading(true);
    try {
      const data = await getScriptContent(scriptPath, repo);
      setViewContent(data);
    } catch (e: any) {
      setViewContent({ path: scriptPath, content: `Error loading script: ${e.message}`, repo });
    } finally {
      setViewLoading(false);
    }
  };

  const executeRun = async (scriptPath: string, serverIp: string, repo: string | null = null) => {
    setShowServerPicker(null);
    setViewContent(null);
    try {
      const { id } = await runScript(scriptPath, serverIp, repo);
      setActiveRun({ id, script: scriptPath, server: serverIp, status: "running", output: [], outputOffset: 0, totalLines: 0, startedAt: Date.now() });

      let offset = 0;
      pollRef.current = setInterval(async () => {
        try {
          const run = await getScriptRun(id, offset);
          setActiveRun((prev) => {
            if (!prev) return prev;
            const newOutput = [...prev.output, ...run.output];
            offset = prev.output.length + run.output.length;
            return { ...prev, ...run, output: newOutput, outputOffset: 0 };
          });
          if (run.status !== "running") {
            if (pollRef.current) clearInterval(pollRef.current);
          }
        } catch {}
      }, 1000);
    } catch (e: any) {
      setActiveRun({ id: "", script: scriptPath, server: serverIp, status: "failed", output: [`Error: ${e.message}`], outputOffset: 0, totalLines: 1, startedAt: Date.now() });
    }
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#1a1a2e" /></View>;
  }

  // Script content viewer
  if (viewContent) {
    return (
      <View style={styles.container}>
        <View style={styles.outputHeader}>
          <Pressable onPress={() => setViewContent(null)}>
            <Text style={styles.backText}>← Back</Text>
          </Pressable>
          <Text style={styles.outputTitle} numberOfLines={1}>{viewContent.path}</Text>
          <Pressable style={styles.btnRun} onPress={() => { setViewContent(null); handleRun(viewContent.path, viewContent.repo); }}>
            <Text style={styles.btnRunText}>Run</Text>
          </Pressable>
        </View>
        {viewLoading ? (
          <ActivityIndicator size="large" color="#1a1a2e" style={{ marginTop: 32 }} />
        ) : (
          <ScrollView style={styles.terminal}>
            <Text style={styles.termLine} selectable>{viewContent.content}</Text>
          </ScrollView>
        )}
      </View>
    );
  }

  // Run output view
  if (activeRun) {
    return (
      <View style={styles.container}>
        <View style={styles.outputHeader}>
          <Pressable onPress={() => { setActiveRun(null); if (pollRef.current) clearInterval(pollRef.current); }}>
            <Text style={styles.backText}>← Back</Text>
          </Pressable>
          <Text style={styles.outputTitle}>{activeRun.script}</Text>
          <View style={[styles.statusBadge, { backgroundColor: activeRun.status === "running" ? "#3b82f6" : activeRun.status === "completed" ? "#22c55e" : "#ef4444" }]}>
            <Text style={styles.statusText}>{activeRun.status}</Text>
          </View>
        </View>
        <ScrollView
          ref={scrollRef}
          style={styles.terminal}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd()}
        >
          {activeRun.output.map((line, i) => (
            <Text key={i} style={[
              styles.termLine,
              line.startsWith("[ERROR]") || line.startsWith("[STDERR]") ? styles.termError :
              line.startsWith("[INFO]") ? styles.termInfo : null,
            ]}>{line}</Text>
          ))}
          {activeRun.status === "running" && (
            <Text style={styles.termCursor}>{"\u2588"}</Text>
          )}
        </ScrollView>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.heading}>Scripts</Text>

      {showServerPicker && (
        <View style={styles.pickerSection}>
          <Text style={styles.pickerTitle}>Run on which server?</Text>
          {servers.map((srv) => (
            <Pressable key={srv.id} style={styles.pickerItem} onPress={() => executeRun(showServerPicker.path, srv.ip, showServerPicker.repo)}>
              <Text style={styles.pickerName}>{srv.name}</Text>
              <Text style={styles.pickerIp}>{srv.ip}</Text>
            </Pressable>
          ))}
          <Pressable style={styles.pickerCancel} onPress={() => setShowServerPicker(null)}>
            <Text style={{ color: "#999" }}>Cancel</Text>
          </Pressable>
        </View>
      )}

      {scripts.length === 0 ? (
        <Text style={styles.empty}>No scripts found in scripts/ directory</Text>
      ) : (
        <View style={styles.section}>
          {scripts.map((s) => (
            <ScriptCard key={s.path} script={s} onRun={handleRun} onView={handleView} />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5", padding: 16 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#f5f5f5" },
  heading: { fontSize: 24, fontWeight: "700", color: "#1a1a2e", marginBottom: 16 },
  empty: { fontSize: 14, color: "#999", textAlign: "center", marginTop: 32 },
  section: { gap: 12 },
  // Card
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 14, gap: 6 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: { fontSize: 15, fontWeight: "600", color: "#1a1a2e", flex: 1 },
  cardPath: { fontSize: 11, color: "#999" },
  cardDesc: { fontSize: 13, color: "#555", marginTop: 2 },
  cardMeta: { flexDirection: "row", alignItems: "center", marginTop: 2 },
  metaText: { fontSize: 11, color: "#999" },
  metaDot: { fontSize: 11, color: "#ccc" },
  metaLine: { fontSize: 11, color: "#999" },
  badgeRow: { flexDirection: "row", gap: 4 },
  badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  badgeText: { fontSize: 10, color: "#fff", fontWeight: "600", textTransform: "uppercase" },
  cardActions: { flexDirection: "row", gap: 8, marginTop: 6 },
  btnView: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 6, backgroundColor: "#f0f0f0" },
  btnViewText: { fontSize: 13, fontWeight: "500", color: "#1a1a2e" },
  btnRun: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 6, backgroundColor: "#22c55e" },
  btnRunText: { fontSize: 13, fontWeight: "600", color: "#fff" },
  // Pickers
  pickerSection: { backgroundColor: "#fff", borderRadius: 12, padding: 16, marginBottom: 16 },
  pickerTitle: { fontSize: 14, fontWeight: "600", color: "#1a1a2e", marginBottom: 12 },
  pickerItem: { flexDirection: "row", justifyContent: "space-between", padding: 12, backgroundColor: "#f8f9fa", borderRadius: 8, marginBottom: 8 },
  pickerName: { fontSize: 14, fontWeight: "500", color: "#1a1a2e" },
  pickerIp: { fontSize: 13, color: "#999" },
  pickerCancel: { alignItems: "center", paddingTop: 8 },
  // Output / viewer
  outputHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  backText: { fontSize: 15, color: "#1a1a2e", fontWeight: "500" },
  outputTitle: { flex: 1, fontSize: 14, fontWeight: "500", color: "#1a1a2e" },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  statusText: { fontSize: 11, color: "#fff", fontWeight: "600", textTransform: "uppercase" },
  terminal: { flex: 1, backgroundColor: "#1a1a2e", borderRadius: 8, padding: 12 },
  termLine: { fontSize: 12, color: "#d4d4d4", fontFamily: "monospace", lineHeight: 18 },
  termError: { color: "#ef4444" },
  termInfo: { color: "#3b82f6" },
  termCursor: { color: "#22c55e", fontSize: 14 },
});
