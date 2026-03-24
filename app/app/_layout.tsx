import { useEffect, useState } from "react";
import { Slot, router, usePathname, useRootNavigationState } from "expo-router";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { checkAuth, getToken, getSetupStatus } from "../services/api";

const PUBLIC_PATHS = ["/login", "/onboarding", "/invite"];

export default function RootLayout() {
  const [checking, setChecking] = useState(true);
  const pathname = usePathname();
  const navState = useRootNavigationState();

  useEffect(() => {
    // Wait until navigation is ready before redirecting
    if (!navState?.key) return;

    if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
      setChecking(false);
      return;
    }

    const verify = async () => {
      try {
        const setup = await getSetupStatus();
        if (setup.needsSetup) {
          router.replace("/onboarding");
          setChecking(false);
          return;
        }
      } catch {}

      const token = getToken();
      if (!token) {
        router.replace("/login");
        setChecking(false);
        return;
      }

      const ok = await checkAuth();
      if (!ok) {
        router.replace("/login");
      }
      setChecking(false);
    };
    verify();
  }, [pathname, navState?.key]);

  if (checking && !PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
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
