import { useEffect, useState } from "react";
import { View, Text, ScrollView, ActivityIndicator, Pressable } from "react-native";
import { router } from "expo-router";
import { getProjects, discoverProjects } from "../services/api";

const statusStyles: Record<string, { bg: string; color: string }> = {
  active: { bg: "#22c55e20", color: "#22c55e" },
  dirty: { bg: "#eab30820", color: "#eab308" },
  orphaned: { bg: "#ef444420", color: "#ef4444" },
  untracked: { bg: "#6b728020", color: "#6b7280" },
};

export default function ProjectsScreen() {
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProjects = () => {
    setLoading(true);
    setError(null);
    getProjects()
      .then((data) => {
        setProjects(data.projects || []);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || "Failed to load projects");
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  const handleDiscover = () => {
    setDiscovering(true);
    discoverProjects()
      .then(() => {
        fetchProjects();
      })
      .catch((err) => {
        setError(err.message || "Discovery failed");
      })
      .finally(() => {
        setDiscovering(false);
      });
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#1a1a2e" }}>
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
        <Text style={{ color: "#fff", fontSize: 20, fontWeight: "bold", flex: 1 }}>Projects</Text>
        <Pressable
          onPress={handleDiscover}
          disabled={discovering}
          style={{
            paddingVertical: 6,
            paddingHorizontal: 14,
            backgroundColor: discovering ? "#333" : "#7eb8ff",
            borderRadius: 6,
            opacity: discovering ? 0.6 : 1,
          }}
        >
          <Text style={{ color: discovering ? "#999" : "#1a1a2e", fontSize: 14, fontWeight: "600" }}>
            {discovering ? "Scanning..." : "Discover"}
          </Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <ActivityIndicator size="large" color="#7eb8ff" />
        </View>
      ) : error ? (
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 20 }}>
          <Text style={{ color: "#ef4444", fontSize: 16 }}>{error}</Text>
        </View>
      ) : projects.length === 0 ? (
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 20 }}>
          <Text style={{ color: "#6b7280", fontSize: 16, textAlign: "center" }}>
            No projects discovered yet. Press Discover to scan.
          </Text>
        </View>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          {projects.map((project, idx) => {
            const status = project.status || "untracked";
            const badge = statusStyles[status] || statusStyles.untracked;

            return (
              <View key={project.name || idx} style={{
                backgroundColor: "#16162a",
                borderRadius: 10,
                borderWidth: 1,
                borderColor: "#2a2a4a",
                padding: 16,
                marginBottom: 12,
              }}>
                <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
                  <Text style={{ color: "#fff", fontSize: 18, fontWeight: "bold", flex: 1 }}>
                    {project.name}
                  </Text>
                  <View style={{
                    paddingHorizontal: 10,
                    paddingVertical: 3,
                    borderRadius: 12,
                    backgroundColor: badge.bg,
                  }}>
                    <Text style={{ color: badge.color, fontSize: 12, fontWeight: "600" }}>
                      {status}
                    </Text>
                  </View>
                </View>

                {project.repoFullName && (
                  <Text style={{ color: "#6b7280", fontSize: 13, marginBottom: 10 }}>
                    {project.repoFullName}
                  </Text>
                )}

                {project.instances && project.instances.length > 0 && (
                  <View style={{ marginBottom: 8 }}>
                    <Text style={{ color: "#90caf9", fontSize: 13, fontWeight: "600", marginBottom: 4 }}>
                      Instances
                    </Text>
                    {project.instances.map((inst: any, i: number) => (
                      <View key={i} style={{
                        backgroundColor: "#0d0d1a",
                        borderRadius: 6,
                        padding: 8,
                        marginBottom: 4,
                      }}>
                        <Text style={{ color: "#d0d0d0", fontSize: 13 }}>
                          {inst.host}:{inst.path}
                        </Text>
                        <View style={{ flexDirection: "row", alignItems: "center", marginTop: 2 }}>
                          {inst.branch && (
                            <Text style={{ color: "#7eb8ff", fontSize: 12, fontFamily: "monospace", marginRight: 8 }}>
                              {inst.branch}
                            </Text>
                          )}
                          {inst.commit && (
                            <Text style={{ color: "#6b7280", fontSize: 11, fontFamily: "monospace", marginRight: 8 }}>
                              {inst.commit.substring(0, 8)}
                            </Text>
                          )}
                          {inst.dirty && (
                            <Text style={{ color: "#eab308", fontSize: 11, fontWeight: "600" }}>dirty</Text>
                          )}
                        </View>
                      </View>
                    ))}
                  </View>
                )}

                {project.containers && project.containers.length > 0 && (
                  <View style={{ marginBottom: 8 }}>
                    <Text style={{ color: "#90caf9", fontSize: 13, fontWeight: "600", marginBottom: 4 }}>
                      Containers
                    </Text>
                    {project.containers.map((c: any, i: number) => (
                      <View key={i} style={{
                        flexDirection: "row",
                        alignItems: "center",
                        backgroundColor: "#0d0d1a",
                        borderRadius: 6,
                        padding: 8,
                        marginBottom: 4,
                      }}>
                        <Text style={{ color: "#d0d0d0", fontSize: 13, flex: 1 }}>{c.name}</Text>
                        <Text style={{ color: "#6b7280", fontSize: 11, fontFamily: "monospace", marginRight: 8 }}>
                          {c.image}
                        </Text>
                        <Text style={{
                          color: c.status === "running" ? "#22c55e" : "#ef4444",
                          fontSize: 11,
                          fontWeight: "600",
                        }}>
                          {c.status}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}

                {project.agents && project.agents.length > 0 && (
                  <View>
                    <Text style={{ color: "#90caf9", fontSize: 13, fontWeight: "600", marginBottom: 4 }}>
                      Agents
                    </Text>
                    {project.agents.map((agent: string, i: number) => (
                      <Text key={i} style={{
                        color: "#d0d0d0",
                        fontSize: 13,
                        fontFamily: "monospace",
                        paddingVertical: 2,
                      }}>
                        {agent}
                      </Text>
                    ))}
                  </View>
                )}
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}
