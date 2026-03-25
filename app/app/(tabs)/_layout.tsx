import { useEffect, useState } from "react";
import { Tabs } from "expo-router";
import { Text } from "react-native";
import { checkAuth } from "../../services/api";

export default function TabLayout() {
  const [role, setRole] = useState<string>("admin");

  useEffect(() => {
    checkAuth().then((ok) => {
      // checkAuth returns boolean, but we stored role in the JWT
      // Read from localStorage
      if (typeof window !== "undefined") {
        try {
          const token = localStorage.getItem("nest_token");
          if (token) {
            const payload = JSON.parse(atob(token.split(".")[1]));
            setRole(payload.role || "admin");
          }
        } catch {}
      }
    });
  }, []);

  const isAdmin = role === "admin";

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
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 18, color }}>⬡</Text>,
        }}
      />
      <Tabs.Screen
        name="scripts"
        options={{
          title: "Scripts",
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 18, color }}>▷</Text>,
          href: isAdmin ? "/scripts" : null,
        }}
      />
      <Tabs.Screen
        name="claw"
        options={{
          title: "Claw",
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 18, color }}>💬</Text>,
        }}
      />
      <Tabs.Screen
        name="commands"
        options={{
          title: "Commands",
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 18, color }}>⌘</Text>,
        }}
      />
      <Tabs.Screen
        name="secrets"
        options={{
          title: "Secrets",
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 18, color }}>🔑</Text>,
          href: isAdmin ? "/secrets" : null,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 18, color }}>⚙</Text>,
        }}
      />
    </Tabs>
  );
}
