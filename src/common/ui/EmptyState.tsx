import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { AppButton } from "./AppButton";
import type { Icon } from "./icons";
import { spacing, type ThemeColors, typography, useColors } from "../../theme";

/**
 * WHAT A SCREEN LOOKS LIKE WITH NOTHING ON IT.
 *
 * ── The state written thirteen times, and eleven of them wrong ───────
 *
 * "agr kisi screen py koi data ni — empty state with icon? and verticle
 * centr aligned?" Measured rather than agreed to: of thirteen empty states in
 * this app, four had an icon and ONE was vertically centred. The rest were a
 * line or two of grey text sitting under the header, at the top of an
 * otherwise blank screen — which does not read as "there is nothing here", it
 * reads as content that failed to load and stopped halfway.
 *
 * That difference matters most on the screens where empty is NORMAL. A new
 * customer has no orders, no addresses, no favourites and no reviews; the
 * first four screens they open are all empty, and all four were telling them
 * something had gone wrong.
 *
 * ── Why centring needs the caller's help ─────────────────────────────
 *
 * Inside a `FlatList`, `ListEmptyComponent` is laid out in the content
 * container — and a content container is only as tall as its content, so
 * `flex: 1` centres inside nothing at all. The list has to say
 * `contentContainerStyle={{ flexGrow: 1 }}` for there to be a screen to
 * centre in. That is one line per list and it is the whole reason the
 * centring kept being left out: it does not work where it is written.
 *
 * ── And the icon is not decoration ───────────────────────────────────
 *
 * It is the fastest way to say WHICH nothing this is. A bag, a heart, a bell
 * and a receipt tell four identical grey paragraphs apart before any of them
 * is read.
 */

interface Props {
  icon: Icon;
  /** Four words, not a sentence. */
  title: string;
  /** What to do about it — never a restatement of the title. */
  message?: string;
  /** The way out. An empty screen with no exit is a dead end. */
  action?: { label: string; onPress: () => void };
  /**
   * `warm` for a state that is somebody's own doing (nothing saved yet) and
   * `muted` for one that is nobody's (no results for that word). The default
   * is the first, because most empty screens are new accounts.
   */
  tone?: "warm" | "muted";
}

export function EmptyState({ icon: Glyph, title, message, action, tone = "warm" }: Props) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);

  return (
    <View style={styles.wrap}>
      <View style={[styles.plate, tone === "muted" && styles.plateMuted]}>
        <Glyph size={30} color={tone === "muted" ? c.textMuted : c.primary} />
      </View>

      <Text style={styles.title}>{title}</Text>
      {!!message && <Text style={styles.message}>{message}</Text>}

      {action != null && (
        <AppButton title={action.label} onPress={action.onPress} style={styles.action} />
      )}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    wrap: {
      // `flexGrow`, not `flex`. Inside a list's content container `flex: 1`
      // resolves against a parent that has no height of its own; growing
      // takes whatever the list gives, which — with `flexGrow: 1` on the
      // content container — is the screen.
      flexGrow: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.xxl,
      gap: 6,
    },
    plate: {
      width: 84,
      height: 84,
      // 42, not `radius.full`: a very large radius renders as a square on
      // small views under the new architecture.
      borderRadius: 42,
      backgroundColor: c.primarySoft,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: spacing.sm,
    },
    plateMuted: { backgroundColor: c.surfaceAlt },
    title: { ...typography.h3, color: c.text, textAlign: "center" },
    message: {
      ...typography.small,
      color: c.textSecondary,
      textAlign: "center",
      // 22 on 13pt: two centred lines need more air than a paragraph does, or
      // they read as one wrapped line.
      lineHeight: 20,
    },
    action: { marginTop: spacing.md, alignSelf: "stretch" },
  });
