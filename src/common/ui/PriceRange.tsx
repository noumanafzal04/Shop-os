import React, { useEffect, useRef, useState } from "react";
import { PanResponder, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { radius, spacing, type ThemeColors, typography, useColors } from "../../theme";
import { money } from "../format";

/**
 * A two-ended price filter.
 *
 * ── Why it is built here and not installed ────────────────────────────
 *
 * Every range-slider package for React Native brings either Reanimated or
 * Gesture Handler, and this app has neither. Adding one of them for a single
 * control means a native rebuild, a second animation system beside the one the
 * sheets already use, and a permanent upgrade obligation — for a track, two
 * circles, and a subtraction.
 *
 * ── Why the bounds come from the server ──────────────────────────────
 *
 * `min`/`max` are the real cheapest and dearest thing in the current result,
 * from `/marketplace/facets`. A slider hardcoded 0–10,000 spends most of its
 * width on prices that do not exist, and in a Pakistani grocery aisle that is
 * nearly all of it: the whole list sits in the first eighth of the track and
 * cannot be separated.
 */

interface Props {
  /** The cheapest thing in the current result. */
  min: number;
  /** The dearest. */
  max: number;
  /** Current selection; `null` on an end means "no bound". */
  value: [number | null, number | null];
  /** Fired on release only — a request per touch event would be one per pixel. */
  onCommit: (low: number | null, high: number | null) => void;
}

const THUMB = 24;

/**
 * A step somebody would actually choose, at whatever scale the aisle is.
 *
 * A fixed step is wrong at both ends: Rs 1 over a Rs 90,000 range needs ninety
 * thousand drags to cross, and Rs 100 over a Rs 250 range gives three
 * positions.
 */
function niceStep(span: number): number {
  if (span <= 0) return 1;
  const rough = span / 100;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const scaled = rough / magnitude;
  const nice = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return Math.max(1, nice * magnitude);
}

export function PriceRange({ min, max, value, onCommit }: Props) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);

  const step = niceStep(max - min);
  const lo = value[0] ?? min;
  const hi = value[1] ?? max;

  const [width, setWidth] = useState(0);
  // What the thumbs are showing RIGHT NOW. Separate from `value` because the
  // parent is only told on release, and the labels have to move with the
  // finger in between.
  const [draft, setDraft] = useState<[number, number]>([lo, hi]);
  const dragging = useRef(false);

  // Follow the parent when it changes underneath us — Reset, or a new set of
  // bounds after another filter narrowed the aisle. Never mid-drag: that would
  // yank the thumb out from under the thumb.
  useEffect(() => {
    if (!dragging.current) setDraft([lo, hi]);
  }, [lo, hi]);

  const span = max - min;
  const usable = Math.max(1, width - THUMB);
  const xOf = (v: number) => ((clamp(v, min, max) - min) / (span || 1)) * usable;

  /**
   * Everything a gesture needs, re-stamped on every render.
   *
   * The two PanResponders are built ONCE — `useRef` sees to that, and it has
   * to, because rebuilding one mid-gesture drops the touch. So they cannot
   * close over `width`, which is 0 on the render that creates them and only
   * real after `onLayout`. Reading through a ref is what keeps a control built
   * on the first frame working with the second frame's measurements.
   */
  const geom = useRef({ min, max, step, usable, onCommit });
  geom.current = { min, max, step, usable, onCommit };

  const draftRef = useRef<[number, number]>([lo, hi]);
  draftRef.current = draft;

  /** One thumb's gesture. `end` says which side of the pair it may not cross. */
  const responderFor = (end: 0 | 1) => {
    const startX = { current: 0 };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // The sheet above claims downward drags on its header; this claims its
      // own touch outright so a sideways drag on a thumb is never stolen.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        const g = geom.current;
        dragging.current = true;
        startX.current =
          ((clamp(draftRef.current[end], g.min, g.max) - g.min) / (g.max - g.min || 1)) * g.usable;
      },
      onPanResponderMove: (_e, gesture) => {
        const g = geom.current;
        const x = clamp(startX.current + gesture.dx, 0, g.usable);
        const raw = g.min + (x / g.usable) * (g.max - g.min || 1);
        const next = clamp(Math.round(raw / g.step) * g.step, g.min, g.max);
        setDraft((d) => {
          // The ends may meet but never swap: a high below its own low is a
          // filter that can only ever return nothing.
          const pair: [number, number] =
            end === 0 ? [Math.min(next, d[1]), d[1]] : [d[0], Math.max(next, d[0])];
          draftRef.current = pair;
          return pair;
        });
      },
      onPanResponderRelease: () => {
        const g = geom.current;
        dragging.current = false;
        const [a, b] = draftRef.current;
        // An end resting on its bound is NOT a filter. Sending it anyway turns
        // "any price" into "between the cheapest and dearest thing currently
        // shown", which quietly pins the result to whatever it already was.
        g.onCommit(a <= g.min ? null : a, b >= g.max ? null : b);
      },
      onPanResponderTerminate: () => {
        dragging.current = false;
      },
    });
  };

  const low = useRef(responderFor(0)).current;
  const high = useRef(responderFor(1)).current;

  // Nothing to choose between. Drawn rather than hidden, because a filter that
  // disappears reads as a filter that failed to load.
  if (!(max > min)) {
    return (
      <View>
        <Text style={styles.flat}>
          {max > 0 ? `Everything here is ${money(max)}` : "No prices to filter yet"}
        </Text>
      </View>
    );
  }

  const left = xOf(draft[0]);
  const right = xOf(draft[1]);

  return (
    <View>
      <View style={styles.readout}>
        <Text style={styles.bound}>{money(draft[0])}</Text>
        <Text style={styles.dash}>–</Text>
        <Text style={styles.bound}>
          {money(draft[1])}
          {draft[1] >= max ? "+" : ""}
        </Text>
      </View>

      <View style={styles.trackRow} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
        <View style={styles.track} />
        <View style={[styles.fill, { left: left + THUMB / 2, width: Math.max(0, right - left) }]} />
        <View {...low.panHandlers} style={[styles.thumb, { left }]} hitSlop={12} />
        <View {...high.panHandlers} style={[styles.thumb, { left: right }]} hitSlop={12} />
      </View>

      <View style={styles.scale}>
        <Text style={styles.scaleTxt}>{money(min)}</Text>
        <Text style={styles.scaleTxt}>{money(max)}</Text>
      </View>
    </View>
  );
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    readout: { flexDirection: "row", alignItems: "baseline", gap: 6, marginBottom: spacing.sm },
    bound: { ...typography.label, color: c.text, fontSize: 15 },
    dash: { ...typography.small, color: c.textMuted },

    trackRow: { height: THUMB + 8, justifyContent: "center" },
    track: {
      height: 4,
      borderRadius: radius.full,
      backgroundColor: c.surfaceAlt,
      borderWidth: 1,
      borderColor: c.border,
      marginHorizontal: THUMB / 2,
    },
    fill: { position: "absolute", height: 4, borderRadius: radius.full, backgroundColor: c.primary },
    thumb: {
      position: "absolute",
      width: THUMB,
      height: THUMB,
      borderRadius: radius.full,
      backgroundColor: c.surface,
      borderWidth: 3,
      borderColor: c.primary,
    },

    scale: { flexDirection: "row", justifyContent: "space-between", marginTop: 2 },
    scaleTxt: { ...typography.tiny, color: c.textMuted },
    flat: { ...typography.small, color: c.textSecondary },
  });
