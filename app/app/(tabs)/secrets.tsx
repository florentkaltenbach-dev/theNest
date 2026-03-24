import { useEffect, useState } from "react";
import { View, Text, TextInput, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { getSecrets, setSecret, deleteSecret } from "../../services/api";

export default function SecretsScreen() {
  const [secrets, setSecretsState] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [adding, setAdding] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  const load = async () => {
    try {
      const data = await getSecrets();
      setSecretsState(data.secrets);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleAdd = async () => {
    if (!newKey.trim()) return;
    setAdding(true);
    try {
      await setSecret(newKey.trim(), newValue);
      setNewKey("");
      setNewValue("");
      setShowAdd(false);
      await load();
    } catch {}
    setAdding(false);
  };

  const handleDelete = async (key: string) => {
    try {
      await deleteSecret(key);
      await load();
    } catch {}
  };

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color="#1a1a2e" /></View>;

  return (
    <ScrollView style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.heading}>Secrets</Text>
        <Pressable style={styles.addBtn} onPress={() => setShowAdd(!showAdd)}>
          <Text style={styles.addBtnText}>{showAdd ? "Cancel" : "+ Add"}</Text>
        </Pressable>
      </View>

      {showAdd && (
        <View style={styles.addForm}>
          <TextInput style={styles.input} placeholder="KEY_NAME" placeholderTextColor="#999" value={newKey} onChangeText={setNewKey} autoCapitalize="characters" />
          <TextInput style={styles.input} placeholder="value" placeholderTextColor="#999" value={newValue} onChangeText={setNewValue} secureTextEntry />
          <Pressable style={[styles.saveBtn, adding && { opacity: 0.5 }]} onPress={handleAdd} disabled={adding}>
            <Text style={styles.saveBtnText}>{adding ? "Saving..." : "Save"}</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.section}>
        {secrets.map((s) => (
          <View key={s.key} style={styles.secretRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.secretKey}>{s.key}</Text>
              <Text style={styles.secretValue}>{s.masked}</Text>
            </View>
            {s.editable && (
              <Pressable onPress={() => handleDelete(s.key)} style={styles.deleteBtn}>
                <Text style={styles.deleteBtnText}>✕</Text>
              </Pressable>
            )}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5", padding: 16 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#f5f5f5" },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  heading: { fontSize: 24, fontWeight: "700", color: "#1a1a2e" },
  addBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, backgroundColor: "#1a1a2e" },
  addBtnText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  addForm: { backgroundColor: "#fff", borderRadius: 12, padding: 16, marginBottom: 16, gap: 10 },
  input: { backgroundColor: "#f5f5f5", borderRadius: 8, padding: 12, fontSize: 14, color: "#333" },
  saveBtn: { backgroundColor: "#22c55e", borderRadius: 8, padding: 12, alignItems: "center" },
  saveBtnText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  section: { backgroundColor: "#fff", borderRadius: 12, overflow: "hidden" },
  secretRow: { flexDirection: "row", alignItems: "center", padding: 14, borderBottomWidth: 1, borderBottomColor: "#f0f0f0" },
  secretKey: { fontSize: 13, fontWeight: "600", color: "#1a1a2e", fontFamily: "monospace" },
  secretValue: { fontSize: 12, color: "#999", marginTop: 2, fontFamily: "monospace" },
  deleteBtn: { padding: 8 },
  deleteBtnText: { color: "#ef4444", fontSize: 14 },
});
