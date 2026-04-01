import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import { completeSetup, login } from "../../services/api";

type Step = "welcome" | "provider" | "password" | "done";

export default function OnboardingScreen() {
  const [step, setStep] = useState<Step>("welcome");
  const [hetznerToken, setHetznerToken] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [gitName, setGitName] = useState("");
  const [gitEmail, setGitEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleComplete = async () => {
    if (!hetznerToken.trim() || !adminPassword.trim()) {
      setError("Both fields are required");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await completeSetup(hetznerToken.trim(), adminPassword.trim(), gitName.trim() || undefined, gitEmail.trim() || undefined);
      await login(adminPassword.trim());
      setStep("done");
      setTimeout(() => router.replace("/"), 1500);
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        {step === "welcome" && (
          <>
            <Text style={styles.emoji}>🪺</Text>
            <Text style={styles.title}>Welcome to Nest</Text>
            <Text style={styles.subtitle}>Let's set up your server management platform.</Text>
            <Pressable style={styles.button} onPress={() => setStep("provider")}>
              <Text style={styles.buttonText}>Get Started</Text>
            </Pressable>
          </>
        )}

        {step === "provider" && (
          <>
            <Text style={styles.stepLabel}>Step 1 of 2</Text>
            <Text style={styles.title}>Connect Provider</Text>
            <Text style={styles.subtitle}>Enter your Hetzner Cloud API token to discover your servers.</Text>
            <TextInput
              style={styles.input}
              placeholder="Hetzner API Token"
              placeholderTextColor="#999"
              value={hetznerToken}
              onChangeText={setHetznerToken}
              secureTextEntry
              autoFocus
            />
            <Text style={styles.hint}>Get one at Hetzner Cloud → Security → API Tokens</Text>
            <Pressable style={styles.button} onPress={() => setStep("password")}>
              <Text style={styles.buttonText}>Next</Text>
            </Pressable>
          </>
        )}

        {step === "password" && (
          <>
            <Text style={styles.stepLabel}>Step 2 of 2</Text>
            <Text style={styles.title}>Set Admin Password</Text>
            <Text style={styles.subtitle}>This password protects your Nest dashboard.</Text>
            <TextInput
              style={styles.input}
              placeholder="Admin Password"
              placeholderTextColor="#999"
              value={adminPassword}
              onChangeText={setAdminPassword}
              secureTextEntry
              autoFocus
            />
            <Text style={[styles.hint, { marginTop: 8 }]}>Git identity (optional — defaults to "nest")</Text>
            <TextInput
              style={styles.input}
              placeholder="Git Name"
              placeholderTextColor="#999"
              value={gitName}
              onChangeText={setGitName}
            />
            <TextInput
              style={styles.input}
              placeholder="Git Email"
              placeholderTextColor="#999"
              value={gitEmail}
              onChangeText={setGitEmail}
              keyboardType="email-address"
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Pressable style={[styles.button, loading && { opacity: 0.5 }]} onPress={handleComplete} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Complete Setup</Text>}
            </Pressable>
            <Pressable onPress={() => setStep("provider")}>
              <Text style={styles.backLink}>← Back</Text>
            </Pressable>
          </>
        )}

        {step === "done" && (
          <>
            <Text style={styles.emoji}>✓</Text>
            <Text style={styles.title}>All Set!</Text>
            <Text style={styles.subtitle}>Redirecting to your dashboard...</Text>
            <ActivityIndicator color="#1a1a2e" style={{ marginTop: 16 }} />
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#1a1a2e", justifyContent: "center", alignItems: "center", padding: 16 },
  card: { backgroundColor: "#fff", borderRadius: 16, padding: 32, width: "100%", maxWidth: 440, alignItems: "center" },
  emoji: { fontSize: 48, marginBottom: 12 },
  stepLabel: { fontSize: 12, color: "#999", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 },
  title: { fontSize: 28, fontWeight: "700", color: "#1a1a2e", textAlign: "center", marginBottom: 8 },
  subtitle: { fontSize: 15, color: "#666", textAlign: "center", marginBottom: 24, lineHeight: 22 },
  input: { width: "100%", backgroundColor: "#f5f5f5", borderRadius: 8, padding: 14, fontSize: 16, color: "#333", borderWidth: 1, borderColor: "#e0e0e0", marginBottom: 12 },
  hint: { fontSize: 12, color: "#999", marginBottom: 16 },
  error: { color: "#ef4444", fontSize: 14, marginBottom: 12 },
  button: { width: "100%", backgroundColor: "#1a1a2e", borderRadius: 8, padding: 14, alignItems: "center", marginBottom: 8 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  backLink: { color: "#999", fontSize: 14, marginTop: 8 },
});
