import { useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import { getHealth, clearToken, getUsers, inviteUser, deleteUser } from "../../services/api";

export default function SettingsScreen() {
  const [health, setHealth] = useState<{ version: string; uptime: number } | null>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteName, setInviteName] = useState("");
  const [invitePassword, setInvitePassword] = useState("");
  const [inviting, setInviting] = useState(false);

  const loadData = async () => {
    getHealth().then(setHealth).catch(() => {});
    getUsers().then((data) => setUsers(data.users)).catch(() => {});
  };

  useEffect(() => { loadData(); }, []);

  const handleInvite = async () => {
    if (!inviteName.trim() || !invitePassword.trim()) return;
    setInviting(true);
    try {
      await inviteUser(inviteName.trim(), invitePassword.trim());
      setInviteName("");
      setInvitePassword("");
      setShowInvite(false);
      await loadData();
    } catch {}
    setInviting(false);
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteUser(id);
      await loadData();
    } catch {}
  };

  const handleLogout = () => {
    clearToken();
    router.replace("/login");
  };

  return (
    <ScrollView style={styles.container}>
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
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Users</Text>
          <Pressable style={styles.smallBtn} onPress={() => setShowInvite(!showInvite)}>
            <Text style={styles.smallBtnText}>{showInvite ? "Cancel" : "+ Invite"}</Text>
          </Pressable>
        </View>

        {showInvite && (
          <View style={styles.inviteForm}>
            <TextInput style={styles.input} placeholder="Name" placeholderTextColor="#999" value={inviteName} onChangeText={setInviteName} />
            <TextInput style={styles.input} placeholder="Password" placeholderTextColor="#999" value={invitePassword} onChangeText={setInvitePassword} secureTextEntry />
            <Pressable style={[styles.inviteBtn, inviting && { opacity: 0.5 }]} onPress={handleInvite} disabled={inviting}>
              <Text style={styles.inviteBtnText}>{inviting ? "Creating..." : "Create User"}</Text>
            </Pressable>
          </View>
        )}

        {users.length === 0 ? (
          <Text style={styles.itemSub}>No users loaded</Text>
        ) : (
          users.map((u) => (
            <View key={u.id} style={styles.userRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.item}>{u.name}</Text>
                <Text style={styles.itemSub}>{u.role} · {u.id}</Text>
              </View>
              {u.id !== "admin" && (
                <Pressable onPress={() => handleDelete(u.id)} style={styles.deleteBtn}>
                  <Text style={{ color: "#ef4444" }}>✕</Text>
                </Pressable>
              )}
            </View>
          ))
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>About</Text>
        <Text style={styles.item}>Nest v0.2.0</Text>
        <Text style={styles.itemSub}>Self-hosted platform manager</Text>
        <Pressable style={{ marginTop: 12, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: "#1a1a2e", borderRadius: 6, alignSelf: "flex-start" }} onPress={() => router.push("/roadmap")}>
          <Text style={{ color: "#7eb8ff", fontSize: 13, fontWeight: "600" }}>View Roadmap</Text>
        </Pressable>
      </View>

      <Pressable style={styles.logoutButton} onPress={handleLogout}>
        <Text style={styles.logoutText}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5", padding: 16 },
  heading: { fontSize: 24, fontWeight: "700", color: "#1a1a2e", marginBottom: 24 },
  section: { backgroundColor: "#fff", borderRadius: 12, padding: 16, marginBottom: 16 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  sectionTitle: { fontSize: 13, color: "#999", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },
  item: { fontSize: 15, color: "#333", marginBottom: 4 },
  itemSub: { fontSize: 13, color: "#999" },
  smallBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4, backgroundColor: "#1a1a2e" },
  smallBtnText: { color: "#fff", fontSize: 11, fontWeight: "600" },
  inviteForm: { marginBottom: 12, gap: 8 },
  input: { backgroundColor: "#f5f5f5", borderRadius: 8, padding: 10, fontSize: 14, color: "#333" },
  inviteBtn: { backgroundColor: "#22c55e", borderRadius: 8, padding: 10, alignItems: "center" },
  inviteBtnText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  userRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#f0f0f0" },
  deleteBtn: { padding: 8 },
  logoutButton: { backgroundColor: "#fff", borderRadius: 12, padding: 16, alignItems: "center", borderWidth: 1, borderColor: "#ef4444", marginBottom: 32 },
  logoutText: { color: "#ef4444", fontSize: 16, fontWeight: "600" },
});
