import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { acceptInvite, setToken } from "../services/api";

export default function InviteScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleAccept = async () => {
    if (!password.trim() || !token) return;
    setLoading(true);
    setError("");
    try {
      const result = await acceptInvite(token, password.trim());
      setToken(result.token);
      router.replace("/");
    } catch (e: any) {
      setError(e.message || "Invalid or expired invitation");
    }
    setLoading(false);
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.emoji}>🪺</Text>
        <Text style={styles.title}>You're Invited</Text>
        <Text style={styles.subtitle}>Set a password to access this Nest instance.</Text>

        <TextInput
          style={styles.input}
          placeholder="Choose a password"
          placeholderTextColor="#999"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoFocus
          onSubmitEditing={handleAccept}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable style={[styles.button, loading && { opacity: 0.5 }]} onPress={handleAccept} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Join</Text>}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#1a1a2e", justifyContent: "center", alignItems: "center", padding: 16 },
  card: { backgroundColor: "#fff", borderRadius: 16, padding: 32, width: "100%", maxWidth: 400, alignItems: "center" },
  emoji: { fontSize: 48, marginBottom: 12 },
  title: { fontSize: 28, fontWeight: "700", color: "#1a1a2e", marginBottom: 4 },
  subtitle: { fontSize: 15, color: "#666", textAlign: "center", marginBottom: 24 },
  input: { width: "100%", backgroundColor: "#f5f5f5", borderRadius: 8, padding: 14, fontSize: 16, color: "#333", borderWidth: 1, borderColor: "#e0e0e0", marginBottom: 12 },
  error: { color: "#ef4444", fontSize: 14, marginBottom: 12 },
  button: { width: "100%", backgroundColor: "#1a1a2e", borderRadius: 8, padding: 14, alignItems: "center" },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
