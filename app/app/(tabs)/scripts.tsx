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
  runScript,
  getScriptRun,
  Script,
  Server,
  ScriptRun,
} from "../../services/api";

function ScriptItem({ script, onRun }: { script: Script; onRun: (path: string) => void }) {
  return (
    <Pressable style={styles.scriptItem} onPress={() => onRun(script.path)}>
      <Text style={styles.scriptIcon}>📄</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.scriptName}>{script.name}</Text>
        <Text style={styles.scriptPath}>{script.path}</Text>
      </View>
      <Text style={styles.runArrow}>▶</Text>
    </Pressable>
  );
}

export default function ScriptsScreen() {
  const [scripts, setScripts] = useState<Script[]>([]);
  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeRun, setActiveRun] = useState<ScriptRun | null>(null);
  const [selectedServer, setSelectedServer] = useState<Server | null>(null);
  const [showServerPicker, setShowServerPicker] = useState<string | null>(null);
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

  const handleRun = async (scriptPath: string) => {
    if (!selectedServer) {
      setShowServerPicker(scriptPath);
      return;
    }
    if (servers.length > 1 && !showServerPicker) {
      setShowServerPicker(scriptPath);
      return;
    }
    await executeRun(scriptPath, selectedServer.ip);
  };

  const executeRun = async (scriptPath: string, serverIp: string) => {
    setShowServerPicker(null);
    try {
      const { id } = await runScript(scriptPath, serverIp);
      setActiveRun({ id, script: scriptPath, server: serverIp, status: "running", output: [], outputOffset: 0, totalLines: 0, startedAt: Date.now() });

      // Poll for output
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

  // Show output view if a run is active
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
            <Text style={styles.termCursor}>▊</Text>
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
            <Pressable key={srv.id} style={styles.pickerItem} onPress={() => executeRun(showServerPicker, srv.ip)}>
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
            <ScriptItem key={s.path} script={s} onRun={handleRun} />
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
  section: { backgroundColor: "#fff", borderRadius: 12, overflow: "hidden" },
  scriptItem: { flexDirection: "row", alignItems: "center", padding: 14, borderBottomWidth: 1, borderBottomColor: "#f0f0f0", gap: 10 },
  scriptIcon: { fontSize: 18 },
  scriptName: { fontSize: 14, fontWeight: "500", color: "#1a1a2e" },
  scriptPath: { fontSize: 11, color: "#999" },
  runArrow: { fontSize: 12, color: "#22c55e" },
  pickerSection: { backgroundColor: "#fff", borderRadius: 12, padding: 16, marginBottom: 16 },
  pickerTitle: { fontSize: 14, fontWeight: "600", color: "#1a1a2e", marginBottom: 12 },
  pickerItem: { flexDirection: "row", justifyContent: "space-between", padding: 12, backgroundColor: "#f8f9fa", borderRadius: 8, marginBottom: 8 },
  pickerName: { fontSize: 14, fontWeight: "500", color: "#1a1a2e" },
  pickerIp: { fontSize: 13, color: "#999" },
  pickerCancel: { alignItems: "center", paddingTop: 8 },
  // Output view
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
