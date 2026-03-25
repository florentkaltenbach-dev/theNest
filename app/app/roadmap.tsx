import { useEffect, useState } from "react";
import { View, Text, ScrollView, ActivityIndicator, Pressable } from "react-native";
import { router } from "expo-router";
import { getRoadmap } from "../services/api";

function renderMarkdown(content: string) {
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];

  let inCodeBlock = false;
  let codeLines: string[] = [];
  let codeKey = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code block toggle
    if (line.trimStart().startsWith("```")) {
      if (inCodeBlock) {
        elements.push(
          <View key={`code-${codeKey++}`} style={{
            backgroundColor: "#0d0d1a",
            borderRadius: 6,
            padding: 12,
            marginVertical: 6,
            borderWidth: 1,
            borderColor: "#333",
          }}>
            <Text style={{ fontFamily: "monospace", fontSize: 12, color: "#a0d0ff" }}>
              {codeLines.join("\n")}
            </Text>
          </View>
        );
        codeLines = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    // Empty line
    if (line.trim() === "") {
      elements.push(<View key={`sp-${i}`} style={{ height: 8 }} />);
      continue;
    }

    // Table separator lines (e.g., |---|---|)
    if (/^\s*\|[\s\-:|]+\|\s*$/.test(line)) {
      continue;
    }

    // Table rows
    if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
      const cells = line.split("|").filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
      elements.push(
        <View key={`tbl-${i}`} style={{ flexDirection: "row", paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: "#2a2a4a" }}>
          {cells.map((cell, ci) => (
            <Text key={ci} style={{
              flex: 1,
              color: "#ccc",
              fontSize: 12,
              fontFamily: "monospace",
              paddingHorizontal: 4,
            }}>
              {cell.trim()}
            </Text>
          ))}
        </View>
      );
      continue;
    }

    // Headers
    const headerMatch = line.match(/^(#{1,4})\s+(.*)/);
    if (headerMatch) {
      const level = headerMatch[1].length;
      const sizes = [24, 20, 17, 15];
      elements.push(
        <Text key={`h-${i}`} style={{
          fontSize: sizes[level - 1],
          fontWeight: "bold",
          color: level === 1 ? "#7eb8ff" : level === 2 ? "#90caf9" : "#b0bec5",
          marginTop: level <= 2 ? 20 : 12,
          marginBottom: 6,
        }}>
          {headerMatch[2]}
        </Text>
      );
      continue;
    }

    // Checkbox lines
    const checkMatch = line.match(/^(\s*)-\s+\[([ xX])\]\s+(.*)/);
    if (checkMatch) {
      const indent = Math.floor(checkMatch[1].length / 2);
      const checked = checkMatch[2] !== " ";
      const text = checkMatch[3];
      elements.push(
        <View key={`cb-${i}`} style={{ flexDirection: "row", paddingLeft: indent * 16, paddingVertical: 2 }}>
          <Text style={{
            color: checked ? "#22c55e" : "#eab308",
            fontSize: 14,
            width: 24,
            fontFamily: "monospace",
          }}>
            {checked ? "[x]" : "[ ]"}
          </Text>
          <Text style={{
            color: checked ? "#22c55e" : "#e0e0e0",
            fontSize: 14,
            flex: 1,
            textDecorationLine: checked ? "line-through" : "none",
            opacity: checked ? 0.7 : 1,
          }}>
            {text}
          </Text>
        </View>
      );
      continue;
    }

    // Bullet points
    const bulletMatch = line.match(/^(\s*)-\s+(.*)/);
    if (bulletMatch) {
      const indent = Math.floor(bulletMatch[1].length / 2);
      elements.push(
        <View key={`bl-${i}`} style={{ flexDirection: "row", paddingLeft: indent * 16, paddingVertical: 2 }}>
          <Text style={{ color: "#666", fontSize: 14, width: 16 }}>{"\u2022"}</Text>
          <Text style={{ color: "#d0d0d0", fontSize: 14, flex: 1 }}>{bulletMatch[2]}</Text>
        </View>
      );
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      elements.push(
        <View key={`hr-${i}`} style={{ height: 1, backgroundColor: "#333", marginVertical: 12 }} />
      );
      continue;
    }

    // Bold text handling in regular lines
    const parts = line.split(/(\*\*[^*]+\*\*)/);
    if (parts.length > 1) {
      elements.push(
        <Text key={`p-${i}`} style={{ color: "#d0d0d0", fontSize: 14, lineHeight: 22 }}>
          {parts.map((part, pi) => {
            const boldMatch = part.match(/^\*\*(.+)\*\*$/);
            if (boldMatch) {
              return <Text key={pi} style={{ fontWeight: "bold", color: "#fff" }}>{boldMatch[1]}</Text>;
            }
            return part;
          })}
        </Text>
      );
      continue;
    }

    // Plain text
    elements.push(
      <Text key={`t-${i}`} style={{ color: "#d0d0d0", fontSize: 14, lineHeight: 22 }}>
        {line}
      </Text>
    );
  }

  return elements;
}

export default function RoadmapScreen() {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getRoadmap()
      .then((data) => {
        setContent(data.content);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || "Failed to load roadmap");
        setLoading(false);
      });
  }, []);

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
        <Text style={{ color: "#fff", fontSize: 20, fontWeight: "bold" }}>Roadmap</Text>
      </View>

      {loading ? (
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <ActivityIndicator size="large" color="#7eb8ff" />
        </View>
      ) : error ? (
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 20 }}>
          <Text style={{ color: "#ef4444", fontSize: 16 }}>{error}</Text>
        </View>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          {content ? renderMarkdown(content) : null}
        </ScrollView>
      )}
    </View>
  );
}
