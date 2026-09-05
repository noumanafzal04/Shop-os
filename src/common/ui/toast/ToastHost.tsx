import React from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AlertTriangle, CheckCircle2, Info, XCircle, type LucideIcon } from "lucide-react-native";
import { useTheme } from "../../../theme";
import type { ThemeColors } from "../../../theme";
import { useToastStore, type Toast, type ToastKind } from "./toastStore";

/**
 * Where toasts appear, and what they look like.
 *
 * TOP, not bottom. The bottom of every shopping screen already belongs to
 * something: the tab bar, the cart bar, the Place Order button. A toast down
 * there either covers the control the person is reaching for or is covered by
 * it, and "Added to cart" landing on top of the cart button is the exact moment
 * it must not.
 */

const ICONS: Record<ToastKind, LucideIcon> = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

/** Ground, hairline and icon per kind — flat, the way the rest of the app is. */
function paletteFor(kind: ToastKind, c: ThemeColors) {
  switch (kind) {
    case "success":
      return { bg: c.successBg, edge: c.success, icon: c.success };
    case "error":
      return { bg: c.errorBg, edge: c.error, icon: c.error };
    case "warning":
      return { bg: c.warningBg, edge: c.warning, icon: c.warning };
    default:
      return { bg: c.infoBg, edge: c.info, icon: c.info };
  }
}

function ToastCard({ toast }: { toast: Toast }) {
  const { colors: c, radius, spacing, typography, shadow } = useTheme();
  const dismiss = useToastStore((s) => s.dismiss);

  const anim = React.useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => {
        if (alive) setReduceMotion(on);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Enter, wait, leave — one timeline, so the exit cannot start while the
  // entrance is still running and leave the card stuck at half opacity.
  React.useEffect(() => {
    const ms = reduceMotion ? 0 : 220;

    const sequence = Animated.sequence([
      Animated.timing(anim, {
        toValue: 1,
        duration: ms,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.delay(toast.duration),
      Animated.timing(anim, {
        toValue: 0,
        duration: ms,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);

    sequence.start(({ finished }) => {
      // Only the timer may retire a toast. A tap that already removed it
      // unmounts this component and calls back with finished: false — dismissing
      // again would drop whichever toast has since taken this slot.
      if (finished) dismiss(toast.id);
    });

    return () => sequence.stop();
  }, [anim, dismiss, reduceMotion, toast.duration, toast.id]);

  // Announced to a screen reader, because a message that only exists for three
  // seconds is a message a blind user never receives.
  React.useEffect(() => {
    AccessibilityInfo.announceForAccessibility(
      toast.detail ? `${toast.message}. ${toast.detail}` : toast.message,
    );
  }, [toast.message, toast.detail]);

  const { bg, edge, icon } = paletteFor(toast.kind, c);
  const Icon = ICONS[toast.kind];

  return (
    <Animated.View
      style={{
        opacity: anim,
        transform: [
          { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-14, 0] }) },
        ],
      }}
    >
      <Pressable
        onPress={() => dismiss(toast.id)}
        accessibilityRole="alert"
        accessibilityLabel={toast.message}
        style={[
          styles.card,
          shadow.lg,
          {
            backgroundColor: bg,
            borderColor: edge,
            borderRadius: radius.md,
            padding: spacing.md,
            gap: spacing.sm,
          },
        ]}
      >
        <Icon size={20} color={icon} strokeWidth={2.2} />
        <View style={styles.copy}>
          <Text
            numberOfLines={2}
            style={[typography.label, { color: c.text }]}
          >
            {toast.message}
          </Text>
          {toast.detail ? (
            <Text
              numberOfLines={3}
              style={[typography.small, styles.detail, { color: c.textSecondary }]}
            >
              {toast.detail}
            </Text>
          ) : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}

/**
 * Mounted once, at the app root, ABOVE the navigator — a toast raised while a
 * modal is open has to sit over the modal, and a host inside the navigator is
 * inside whatever the navigator is currently showing.
 */
export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const insets = useSafeAreaInsets();
  const { spacing } = useTheme();

  if (toasts.length === 0) return null;

  return (
    <View
      // The toasts catch touches; the gap around them must not, or the whole
      // top of the screen stops responding for as long as one is visible.
      pointerEvents="box-none"
      style={[
        styles.host,
        { top: insets.top + spacing.sm, paddingHorizontal: spacing.md, gap: spacing.sm },
      ]}
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  host: { position: "absolute", left: 0, right: 0, zIndex: 9999 },
  card: { flexDirection: "row", alignItems: "flex-start", borderWidth: 1 },
  copy: { flex: 1 },
  detail: { marginTop: 2 },
});
