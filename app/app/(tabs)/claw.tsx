import { useEffect, useState, useRef } from "react";
import { View, Text, TextInput, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { sendChat, getChatHistory } from "../../services/api";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export default function ClawScreen() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    getChatHistory().then((data) => setMessages(data.messages)).catch(() => {});
  }, []);

  const send = async () => {
    if (!input.trim() || sending) return;
    const text = input.trim();
    setInput("");
    setSending(true);
    try {
      const { userMessage, assistantMessage } = await sendChat(text);
      setMessages((prev) => [...prev, userMessage, assistantMessage]);
      setTimeout(() => scrollRef.current?.scrollToEnd(), 100);
    } catch {}
    setSending(false);
  };

  return (
    <View style={styles.container}>
      <ScrollView ref={scrollRef} style={styles.messages} onContentSizeChange={() => scrollRef.current?.scrollToEnd()}>
        {messages.length === 0 && (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>🪺</Text>
            <Text style={styles.emptyTitle}>Nest Assistant</Text>
            <Text style={styles.emptyText}>Ask about server status, containers, or anything else.</Text>
          </View>
        )}
        {messages.map((m) => (
          <View key={m.id} style={[styles.bubble, m.role === "user" ? styles.userBubble : styles.assistantBubble]}>
            <Text style={[styles.bubbleText, m.role === "user" && styles.userText]}>{m.content}</Text>
          </View>
        ))}
        {sending && (
          <View style={[styles.bubble, styles.assistantBubble]}>
            <ActivityIndicator size="small" color="#999" />
          </View>
        )}
      </ScrollView>

      <View style={styles.inputBar}>
        <TextInput
          style={styles.textInput}
          placeholder="Ask something..."
          placeholderTextColor="#999"
          value={input}
          onChangeText={setInput}
          onSubmitEditing={send}
          returnKeyType="send"
        />
        <Pressable style={[styles.sendBtn, (!input.trim() || sending) && styles.sendBtnDisabled]} onPress={send} disabled={!input.trim() || sending}>
          <Text style={styles.sendBtnText}>↑</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5" },
  messages: { flex: 1, padding: 16 },
  empty: { alignItems: "center", marginTop: 60 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 20, fontWeight: "600", color: "#1a1a2e", marginBottom: 4 },
  emptyText: { fontSize: 14, color: "#999" },
  bubble: { maxWidth: "80%", padding: 12, borderRadius: 16, marginBottom: 8 },
  userBubble: { alignSelf: "flex-end", backgroundColor: "#1a1a2e" },
  assistantBubble: { alignSelf: "flex-start", backgroundColor: "#fff" },
  bubbleText: { fontSize: 14, color: "#333", lineHeight: 20 },
  userText: { color: "#fff" },
  inputBar: { flexDirection: "row", padding: 12, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: "#e0e0e0", gap: 8 },
  textInput: { flex: 1, backgroundColor: "#f5f5f5", borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, color: "#333" },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#1a1a2e", justifyContent: "center", alignItems: "center" },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText: { color: "#fff", fontSize: 18, fontWeight: "700" },
});
