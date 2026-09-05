import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { spacing, type ThemeColors, useColors } from "../../theme";

/**
 * Global connectivity banner — mounts once at the app root and shows
 * whenever the device loses internet.
 */
export function OfflineBanner() {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setOffline(!(state.isConnected && state.isInternetReachable !== false));
    });
    return unsubscribe;
  }, []);

  if (!offline) return null;

  return (
    <View style={styles.banner}>
      <Text style={styles.text}>No internet connection</Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
  banner: {
    backgroundColor: c.error,
    paddingVertical: spacing.xs,
    alignItems: "center",
  },
  text: { color: c.white, fontSize: 12, fontWeight: "600" },
});
