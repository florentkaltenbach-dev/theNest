import { Tabs } from "expo-router";
import { Text } from "react-native";

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: "#1a1a2e",
        tabBarStyle: { backgroundColor: "#fafafa", borderTopColor: "#e0e0e0" },
        headerStyle: { backgroundColor: "#1a1a2e" },
        headerTintColor: "#fff",
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Servers",
          tabBarIcon: ({ color }) => (
            <Text style={{ fontSize: 20, color }}>⬡</Text>
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color }) => (
            <Text style={{ fontSize: 20, color }}>⚙</Text>
          ),
        }}
      />
    </Tabs>
  );
}
