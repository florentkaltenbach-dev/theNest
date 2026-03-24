import { useEffect, useState } from "react";
import { Slot, usePathname } from "expo-router";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { checkAuth, getToken, getSetupStatus } from "../services/api";

const PUBLIC_PATHS = ["/login", "/onboarding", "/invite"];

function navigate(path: string) {
  if (typeof window !== "undefined") {
    window.location.href = path;
  }
}

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
      setReady(true);
      return;
    }

    const verify = async () => {
      try {
        const setup = await getSetupStatus();
        if (setup.needsSetup) {
          navigate("/onboarding");
          return;
        }
      } catch {}

      const token = getToken();
      if (!token) {
        navigate("/login");
        return;
      }

      const ok = await checkAuth();
      if (!ok) {
        navigate("/login");
        return;
      }
      setReady(true);
    };
    verify();
  }, []);

  if (!ready && !PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#1a1a2e" />
      </View>
    );
  }

  return <Slot />;
}

const styles = StyleSheet.create({
  loading: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#f5f5f5" },
});
