import { useEffect, useState, useCallback, useRef } from "react";
import { View, Text, ScrollView, Pressable, TextInput, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import { getSessions, createSession, deleteSession, getTasks, dispatchTask } from "../services/api";

interface Session {
  name: string;
  created: string;
  attached?: boolean;
}

interface Task {
  id: string;
  prompt: string;
  status: "running" | "done" | "failed";
  started: string;
  gitDiff?: string;
}

export default function TasksScreen() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [taskPrompt, setTaskPrompt] = useState("");
  const [dispatching, setDispatching] = useState(false);
  const [dispatchResult, setDispatchResult] = useState<string | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchSessions = useCallback(async () => {
    try {
      const data = await getSessions();
      setSessions(data.sessions || []);
    } catch {
      setSessions([]);
    } finally {
      setLoadingSessions(false);
    }
  }, []);

  const fetchTasks = useCallback(async () => {
    try {
      const data = await getTasks();
      setTasks(data.tasks || []);
    } catch {
      setTasks([]);
    } finally {
      setLoadingTasks(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
    fetchTasks();
  }, [fetchSessions, fetchTasks]);

  // Auto-refresh if any task is running
  useEffect(() => {
    const hasRunning = tasks.some((t) => t.status === "running");
    if (hasRunning) {
      intervalRef.current = setInterval(() => {
        fetchTasks();
      }, 15000);
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [tasks, fetchTasks]);

  const handleNewTerminal = async () => {
    const name = "term-" + Date.now();
    setCreating("terminal");
    try {
      await createSession(name, "bash");
      router.push(`/terminal?session=${encodeURIComponent(name)}`);
    } catch {
      // ignore
    } finally {
      setCreating(null);
    }
  };

  const handleNewClaude = async () => {
    const name = "claude-" + Date.now();
    setCreating("claude");
    try {
      await createSession(name, "claude --dangerously-skip-permissions");
      router.push(`/terminal?session=${encodeURIComponent(name)}`);
    } catch {
      // ignore
    } finally {
      setCreating(null);
    }
  };

  const handleKillSession = async (name: string) => {
    try {
      await deleteSession(name);
      setSessions((prev) => prev.filter((s) => s.name !== name));
    } catch {
      // ignore
    }
  };

  const handleDispatch = async () => {
    if (!taskPrompt.trim()) return;
    setDispatching(true);
    setDispatchResult(null);
    try {
      const result = await dispatchTask(taskPrompt.trim());
      setDispatchResult(`Task dispatched: ${result.id}`);
      setTaskPrompt("");
      fetchTasks();
    } catch (err: any) {
      setDispatchResult(`Error: ${err.message || "Failed to dispatch"}`);
    } finally {
      setDispatching(false);
    }
  };

  const statusColor = (status: string) => {
    if (status === "running") return "#f59e0b";
    if (status === "done") return "#22c55e";
    if (status === "failed") return "#ef4444";
    return "#888";
  };

  const formatTime = (ts: string) => {
    try {
      const d = new Date(ts);
      return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch {
      return ts;
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#1a1a2e" }}>
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
        <Text style={{ color: "#fff", fontSize: 20, fontWeight: "bold" }}>Tasks & Sessions</Text>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {/* Quick-launch buttons */}
        <View style={{ flexDirection: "row", gap: 12, marginBottom: 20 }}>
          <Pressable
            onPress={handleNewTerminal}
            disabled={creating !== null}
            style={{
              flex: 1,
              backgroundColor: "#2a2a4a",
              borderRadius: 8,
              padding: 14,
              alignItems: "center",
              opacity: creating ? 0.6 : 1,
            }}
          >
            {creating === "terminal" ? (
              <ActivityIndicator size="small" color="#7eb8ff" />
            ) : (
              <>
                <Text style={{ color: "#7eb8ff", fontSize: 18, fontWeight: "bold", fontFamily: "monospace" }}>{">"}_</Text>
                <Text style={{ color: "#ccc", fontSize: 12, marginTop: 4 }}>New Terminal</Text>
              </>
            )}
          </Pressable>
          <Pressable
            onPress={handleNewClaude}
            disabled={creating !== null}
            style={{
              flex: 1,
              backgroundColor: "#2a2a4a",
              borderRadius: 8,
              padding: 14,
              alignItems: "center",
              opacity: creating ? 0.6 : 1,
            }}
          >
            {creating === "claude" ? (
              <ActivityIndicator size="small" color="#7eb8ff" />
            ) : (
              <>
                <Text style={{ color: "#7eb8ff", fontSize: 18, fontWeight: "bold", fontFamily: "monospace" }}>C/</Text>
                <Text style={{ color: "#ccc", fontSize: 12, marginTop: 4 }}>New Claude Code</Text>
              </>
            )}
          </Pressable>
        </View>

        {/* Active Sessions */}
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
          <Text style={{ color: "#7eb8ff", fontSize: 17, fontWeight: "bold", flex: 1 }}>Active Sessions</Text>
          <Pressable
            onPress={() => { setLoadingSessions(true); fetchSessions(); }}
            style={{
              paddingVertical: 4,
              paddingHorizontal: 10,
              backgroundColor: "#2a2a4a",
              borderRadius: 6,
            }}
          >
            <Text style={{ color: "#7eb8ff", fontSize: 12 }}>Refresh</Text>
          </Pressable>
        </View>

        {loadingSessions ? (
          <ActivityIndicator size="small" color="#7eb8ff" style={{ marginVertical: 20 }} />
        ) : sessions.length === 0 ? (
          <Text style={{ color: "#666", fontSize: 14, marginBottom: 20 }}>No active sessions</Text>
        ) : (
          sessions.map((s) => (
            <Pressable
              key={s.name}
              onPress={() => router.push(`/terminal?session=${encodeURIComponent(s.name)}`)}
              style={{
                backgroundColor: "#22223a",
                borderRadius: 10,
                borderWidth: 1,
                borderColor: "#2a2a4a",
                padding: 14,
                marginBottom: 10,
                flexDirection: "row",
                alignItems: "center",
              }}
            >
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}>
                  <Text style={{ color: "#e0e0e0", fontSize: 15, fontWeight: "600", fontFamily: "monospace" }}>{s.name}</Text>
                  {s.attached && (
                    <View style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: "#22c55e",
                      marginLeft: 8,
                    }} />
                  )}
                </View>
                {s.created && (
                  <Text style={{ color: "#888", fontSize: 12 }}>{formatTime(s.created)}</Text>
                )}
              </View>
              <Pressable
                onPress={(e) => {
                  e.stopPropagation?.();
                  handleKillSession(s.name);
                }}
                style={{
                  paddingVertical: 4,
                  paddingHorizontal: 10,
                  backgroundColor: "#3a1a1a",
                  borderRadius: 6,
                  marginLeft: 10,
                }}
              >
                <Text style={{ color: "#ef4444", fontSize: 12 }}>Kill</Text>
              </Pressable>
            </Pressable>
          ))
        )}

        {/* New Task */}
        <Pressable
          onPress={() => setTaskFormOpen(!taskFormOpen)}
          style={{
            flexDirection: "row",
            alignItems: "center",
            marginTop: 16,
            marginBottom: 8,
          }}
        >
          <Text style={{ color: "#7eb8ff", fontSize: 17, fontWeight: "bold", flex: 1 }}>New Task</Text>
          <Text style={{ color: "#7eb8ff", fontSize: 14 }}>{taskFormOpen ? "Hide" : "Show"}</Text>
        </Pressable>

        {taskFormOpen && (
          <View style={{
            backgroundColor: "#22223a",
            borderRadius: 10,
            borderWidth: 1,
            borderColor: "#2a2a4a",
            padding: 14,
            marginBottom: 16,
          }}>
            <TextInput
              value={taskPrompt}
              onChangeText={setTaskPrompt}
              placeholder="Describe the task..."
              placeholderTextColor="#666"
              multiline
              style={{
                color: "#e0e0e0",
                fontSize: 14,
                fontFamily: "monospace",
                backgroundColor: "#1a1a2e",
                borderRadius: 6,
                padding: 10,
                minHeight: 60,
                marginBottom: 10,
                borderWidth: 1,
                borderColor: "#333",
              }}
            />
            <Pressable
              onPress={handleDispatch}
              disabled={dispatching || !taskPrompt.trim()}
              style={{
                backgroundColor: dispatching || !taskPrompt.trim() ? "#333" : "#7eb8ff",
                borderRadius: 6,
                padding: 10,
                alignItems: "center",
              }}
            >
              {dispatching ? (
                <ActivityIndicator size="small" color="#1a1a2e" />
              ) : (
                <Text style={{ color: "#1a1a2e", fontSize: 14, fontWeight: "bold" }}>Dispatch</Text>
              )}
            </Pressable>
            {dispatchResult && (
              <Text style={{
                color: dispatchResult.startsWith("Error") ? "#ef4444" : "#22c55e",
                fontSize: 13,
                marginTop: 8,
              }}>
                {dispatchResult}
              </Text>
            )}
          </View>
        )}

        {/* Task History */}
        <Text style={{ color: "#7eb8ff", fontSize: 17, fontWeight: "bold", marginTop: 16, marginBottom: 12 }}>Task History</Text>

        {loadingTasks ? (
          <ActivityIndicator size="small" color="#7eb8ff" style={{ marginVertical: 20 }} />
        ) : tasks.length === 0 ? (
          <Text style={{ color: "#666", fontSize: 14 }}>No tasks yet</Text>
        ) : (
          tasks.map((t) => (
            <View
              key={t.id}
              style={{
                backgroundColor: "#22223a",
                borderRadius: 10,
                borderWidth: 1,
                borderColor: "#2a2a4a",
                padding: 14,
                marginBottom: 10,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 6 }}>
                <Text style={{ color: "#888", fontSize: 12, fontFamily: "monospace", flex: 1 }}>{t.id}</Text>
                <View style={{
                  paddingHorizontal: 8,
                  paddingVertical: 2,
                  borderRadius: 4,
                  backgroundColor: statusColor(t.status) + "22",
                }}>
                  <Text style={{ color: statusColor(t.status), fontSize: 11, fontWeight: "bold" }}>
                    {t.status.toUpperCase()}
                  </Text>
                </View>
              </View>
              <Text
                style={{ color: "#e0e0e0", fontSize: 14, marginBottom: 4 }}
                numberOfLines={2}
              >
                {t.prompt}
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                {t.started && (
                  <Text style={{ color: "#666", fontSize: 12 }}>{formatTime(t.started)}</Text>
                )}
                {t.gitDiff && (
                  <Text style={{ color: "#888", fontSize: 12, marginLeft: 12 }}>{t.gitDiff}</Text>
                )}
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}
