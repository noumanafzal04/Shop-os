import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { BottomSheet } from "@cartze/core/ui/BottomSheet";
import { AppButton } from "@cartze/core/ui/AppButton";
import { Touchable } from "@cartze/core/ui/Touchable";
import { toast } from "@cartze/core/ui/toast";
import { FileTextIcon, MonitorIcon, UploadIcon, type Icon } from "@cartze/core/ui/icons";
import { spacing, typography, useColors, type ThemeColors } from "@cartze/core/theme";
import { shareSlip } from "../transports";
import {
  canPrint,
  forgetPrinter,
  pairedPrinters,
  printerError,
  printOnBluetooth,
  printOnSystem,
  rememberedPrinter,
  type Printer,
} from "../printers";

/**
 * PRINT OR SEND ONE SLIP — the sheet behind "Kitchen slip" and "Bill".
 *
 * The printer that printed last time is the big button, so the second slip
 * of the day is one tap. Below it: every paired Bluetooth printer, a Wi-Fi
 * printer or PDF through Android's own dialog, and Share for WhatsApp.
 */
export function PrintSheet({
  visible,
  onClose,
  slip,
  title,
  what,
}: {
  visible: boolean;
  onClose: () => void;
  /** The fixed-width text from `renderSlip`. */
  slip: string;
  /** The print job / share title — the order number. */
  title: string;
  /** "Kitchen slip" or "Bill", for the toasts. */
  what: string;
}) {
  const c = useColors();
  const s = styles(c);
  const [last, setLast] = useState<Printer | null>(null);
  const [paired, setPaired] = useState<Printer[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const printing = canPrint();

  const load = useCallback(async () => {
    setProblem(null);
    if (!printing) return;
    setLast(await rememberedPrinter());
    try {
      setPaired(await pairedPrinters());
    } catch (e) {
      setPaired([]);
      setProblem(printerError(e));
    }
  }, [printing]);

  useEffect(() => {
    if (visible) void load();
  }, [visible, load]);

  const run = async (key: string, job: () => Promise<void>, done: string) => {
    setWorking(key);
    setProblem(null);
    try {
      await job();
      toast.success(done);
      onClose();
    } catch (e) {
      setProblem(printerError(e));
    } finally {
      setWorking(null);
    }
  };

  const onBluetooth = (p: Printer) => run(p.address, () => printOnBluetooth(p, slip), `${what} printed on ${p.name}`);

  const others = (paired ?? []).filter((p) => p.address !== last?.address);

  return (
    <BottomSheet visible={visible} onClose={onClose} title={`Print or send · ${what}`}>
      <View style={s.body}>
        {printing && last ? (
          <View style={s.lastBlock}>
            <AppButton
              title={`Print on ${last.name}`}
              size="lg"
              loading={working === last.address}
              disabled={working !== null}
              onPress={() => onBluetooth(last)}
            />
            <Text
              style={s.forget}
              onPress={async () => {
                await forgetPrinter();
                setLast(null);
              }}
            >
              Use a different printer
            </Text>
          </View>
        ) : null}

        {printing ? (
          <>
            <Text style={s.heading}>Bluetooth printers paired with this phone</Text>
            {paired === null ? (
              <ActivityIndicator color={c.primaryPressed} style={s.loading} />
            ) : others.length === 0 && !last ? (
              <Text style={s.note}>
                None yet. Pair your printer in the phone's Bluetooth settings first (its code is often 0000 or 1234), then
                open this again.
              </Text>
            ) : (
              others.map((p) => (
                <Row
                  key={p.address}
                  icon={FileTextIcon}
                  label={p.name}
                  hint={p.looksLikePrinter ? "Printer" : p.address}
                  busy={working === p.address}
                  disabled={working !== null}
                  onPress={() => onBluetooth(p)}
                  s={s}
                  c={c}
                />
              ))
            )}

            <Row
              icon={MonitorIcon}
              label="Wi-Fi printer or PDF"
              hint="Android's print screen"
              busy={working === "system"}
              disabled={working !== null}
              onPress={() => run("system", () => printOnSystem(slip, title), `${what} sent to the printer`)}
              s={s}
              c={c}
            />
          </>
        ) : null}

        <Row
          icon={UploadIcon}
          label="Share"
          hint="WhatsApp, messages, a printer app"
          busy={false}
          disabled={working !== null}
          onPress={async () => {
            if (await shareSlip(slip, title)) {
              toast.success(`${what} sent`);
              onClose();
            }
          }}
          s={s}
          c={c}
        />

        {problem ? <Text style={s.problem}>{problem}</Text> : null}
      </View>
    </BottomSheet>
  );
}

function Row({
  icon: Glyph,
  label,
  hint,
  busy,
  disabled,
  onPress,
  s,
  c,
}: {
  icon: Icon;
  label: string;
  hint: string;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
  s: ReturnType<typeof styles>;
  c: ThemeColors;
}) {
  return (
    <Touchable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} style={s.row}>
      <View style={s.glyph}>
        <Glyph size={20} color={c.primaryPressed} />
      </View>
      <View style={s.rowText}>
        <Text style={s.rowLabel} numberOfLines={1}>
          {label}
        </Text>
        <Text style={s.rowHint} numberOfLines={1}>
          {hint}
        </Text>
      </View>
      {busy ? <ActivityIndicator color={c.primaryPressed} /> : null}
    </Touchable>
  );
}

const styles = (c: ThemeColors) =>
  StyleSheet.create({
    body: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.xs },
    lastBlock: { gap: spacing.sm, marginBottom: spacing.sm },
    forget: { ...typography.label, color: c.primaryPressed, textAlign: "center", paddingVertical: spacing.xs },
    heading: { ...typography.label, fontSize: 13, color: c.textSecondary, marginTop: spacing.xs },
    note: { ...typography.small, color: c.textSecondary, paddingVertical: spacing.sm },
    loading: { paddingVertical: spacing.md },
    row: { flexDirection: "row", alignItems: "center", gap: spacing.ms, paddingVertical: spacing.sm, minHeight: 56 },
    glyph: {
      width: 38,
      height: 38,
      borderRadius: 12,
      backgroundColor: c.primarySoft,
      alignItems: "center",
      justifyContent: "center",
    },
    rowText: { flex: 1 },
    rowLabel: { ...typography.body, fontSize: 16, fontWeight: "600", color: c.text },
    rowHint: { ...typography.small, color: c.textMuted },
    problem: { ...typography.small, color: c.error, marginTop: spacing.sm },
  });
