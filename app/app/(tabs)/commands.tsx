import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import { router } from "expo-router";

interface CommandCard {
  id: string;
  icon: string;
  title: string;
  subtitle: string;
  onPress?: () => void;
  disabled?: boolean;
}

const commands: CommandCard[] = [
  {
    id: "terminal",
    icon: ">_",
    title: "Terminal",
    subtitle: "Open a shell on the server",
    onPress: () => router.push("/terminal"),
  },
  {
    id: "claude",
    icon: "C/",
    title: "Claude Code",
    subtitle: "Start a Claude Code session",
    onPress: () => router.push("/terminal?cmd=claude"),
  },
  {
    id: "tasks",
    icon: ">>",
    title: "Tasks",
    subtitle: "Sessions, dispatch, and monitor coding tasks",
    onPress: () => router.push("/tasks"),
  },
  {
    id: "projects",
    icon: "{}",
    title: "Projects",
    subtitle: "View all repos, instances, and agents",
    onPress: () => router.push("/projects"),
  },
  {
    id: "openclaw",
    icon: "OC",
    title: "OpenClaw",
    subtitle: "Install or open OpenClaw",
    disabled: true,
  },
];

export default function CommandsScreen() {
  return (
    <ScrollView style={styles.container}>
      <Text style={styles.heading}>Commands</Text>

      {commands.map((cmd) => (
        <Pressable
          key={cmd.id}
          style={[styles.card, cmd.disabled && styles.cardDisabled]}
          onPress={cmd.disabled ? undefined : cmd.onPress}
          disabled={cmd.disabled}
        >
          <View style={[styles.iconBox, cmd.disabled && styles.iconBoxDisabled]}>
            <Text style={[styles.iconText, cmd.disabled && styles.iconTextDisabled]}>{cmd.icon}</Text>
          </View>
          <View style={styles.cardContent}>
            <Text style={[styles.cardTitle, cmd.disabled && styles.cardTitleDisabled]}>{cmd.title}</Text>
            <Text style={[styles.cardSubtitle, cmd.disabled && styles.cardSubtitleDisabled]}>{cmd.subtitle}</Text>
          </View>
          {!cmd.disabled && (
            <Text style={styles.arrow}>›</Text>
          )}
          {cmd.disabled && (
            <View style={styles.comingSoon}>
              <Text style={styles.comingSoonText}>Soon</Text>
            </View>
          )}
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5", padding: 16 },
  heading: { fontSize: 24, fontWeight: "700", color: "#1a1a2e", marginBottom: 24 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  cardDisabled: {
    opacity: 0.55,
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: "#1a1a2e",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },
  iconBoxDisabled: {
    backgroundColor: "#999",
  },
  iconText: {
    color: "#7eb8ff",
    fontSize: 16,
    fontWeight: "700",
    fontFamily: "monospace",
  },
  iconTextDisabled: {
    color: "#ddd",
  },
  cardContent: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1a1a2e",
    marginBottom: 2,
  },
  cardTitleDisabled: {
    color: "#666",
  },
  cardSubtitle: {
    fontSize: 13,
    color: "#999",
  },
  cardSubtitleDisabled: {
    color: "#aaa",
  },
  arrow: {
    fontSize: 24,
    color: "#ccc",
    marginLeft: 8,
  },
  comingSoon: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: "#f0f0f0",
    borderRadius: 4,
    marginLeft: 8,
  },
  comingSoonText: {
    fontSize: 11,
    color: "#999",
    fontWeight: "600",
  },
});
