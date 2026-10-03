import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Touchable } from "@cartze/core/ui/Touchable";
import { MenuIcon } from "@cartze/core/ui/icons";
import { spacing, typography, useColors, type ThemeColors } from "@cartze/core/theme";
import { useDrawer } from "./DrawerHost";

/**
 * THE TOP OF EVERY TAB SCREEN — hamburger, title, and whatever that screen
 * needs on the right.
 *
 * ── Why the hamburger is on every one of them ────────────────────────
 *
 * A drawer reachable from one screen is a drawer nobody finds. The control has
 * to be in the same corner on every screen a person lands on, or it stops
 * being a place and becomes a thing you have to remember the route to.
 *
 * ── Why this is a component and not four copies of a View ────────────
 *
 * Four screens had four hand-built headers, which is four different top
 * paddings, four chances for one of them to sit 4pt under the status bar (all
 * four did), and four places to add the hamburger to and three to remember it
 * in. The header is one thing now; a screen says its title and hands over any
 * actions.
 */
export function ScreenHeader({
  title,
  subtitle,
  subtitleTone = "quiet",
  actions,
  children,
}: {
  title: string;
  subtitle?: string | null;
  /** `alert` draws it in the error colour — "1 delivery has no rider". */
  subtitleTone?: "quiet" | "alert";
  actions?: React.ReactNode;
  /** A search field, a period bar — anything that belongs under the title. */
  children?: React.ReactNode;
}) {
  const c = useColors();
  const s = styles(c);
  const drawer = useDrawer();

  return (
    <View style={s.head}>
      <View style={s.row}>
        <Touchable
          onPress={drawer.open}
          accessibilityRole="button"
          accessibilityLabel="Open the menu"
          hitSlop={10}
          style={s.hamburger}
        >
          <MenuIcon size={22} color={c.text} />
        </Touchable>

        <View style={s.titleBlock}>
          <Text style={s.title} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={subtitleTone === "alert" ? s.alert : s.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>

        {actions}
      </View>

      {children}
    </View>
  );
}

const styles = (c: ThemeColors) =>
  StyleSheet.create({
    /**
     * `sm + 4` at the top, not `xs`.
     *
     * Every screen used `spacing.xs` — 4 points — so the title sat against the
     * status bar inset with nothing between them. On a phone it reads as a
     * page that has scrolled up slightly rather than a page that starts here.
     */
    head: { paddingHorizontal: spacing.md, paddingTop: spacing.sm + 4, gap: spacing.sm },
    row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    hamburger: {
      width: 40,
      height: 40,
      marginLeft: -8,
      alignItems: "center",
      justifyContent: "center",
    },
    titleBlock: { flex: 1 },
    title: { ...typography.title, color: c.text },
    subtitle: { ...typography.small, color: c.textMuted, marginTop: 1 },
    alert: { ...typography.small, color: c.error, marginTop: 1 },
  });
