import React from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { BottomSheet } from "../../../common/ui/BottomSheet";
import { AppButton } from "../../../common/ui/AppButton";
import { Touchable } from "../../../common/ui/Touchable";
import { toast } from "../../../common/ui/toast";
import { radius, spacing, type ThemeColors, typography, useColors } from "../../../theme";
import { ApiError } from "../../../common/types/api";
import { useReportIssue, type IssueKind } from "../hooks/useOrders";

/**
 * "ORDER MEIN MASLA" — what went wrong, said once, in the app, to somebody
 * who can act. Foodpanda's most-used screen: pick what happened, add a line,
 * and the answer (a refund, a voucher, or a reason) comes back on the order.
 */
export const ISSUE_CHOICES: Array<{ kind: IssueKind; label: string }> = [
  { kind: "missing_item", label: "Something was missing" },
  { kind: "wrong_item", label: "Wrong item" },
  { kind: "late", label: "Arrived very late" },
  { kind: "quality", label: "Food or item quality" },
  { kind: "rider", label: "Problem with the rider" },
  { kind: "payment", label: "Charged wrongly" },
  { kind: "other", label: "Something else" },
];

interface Props {
  visible: boolean;
  onClose: () => void;
  orderId: string;
  orderNumber: string;
}

export function ReportIssueSheet({ visible, onClose, orderId, orderNumber }: Props) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const report = useReportIssue(orderId);
  const [kind, setKind] = React.useState<IssueKind | null>(null);
  const [note, setNote] = React.useState("");

  // "Something else" says nothing on its own — the words are the report.
  const ready = kind !== null && (kind !== "other" || note.trim().length > 0);

  const submit = () => {
    if (!ready) return;
    report.mutate(
      { kind: kind!, note: note.trim() || undefined },
      {
        onSuccess: () => {
          toast.success("Thanks — we will look into it and reply on this order.");
          onClose();
        },
        onError: (e) => toast.error(e instanceof ApiError ? e.message : "That did not go through. Try again."),
      },
    );
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={`Problem with ${orderNumber}?`}
      footer={<AppButton title={report.isPending ? "Sending…" : "Send"} onPress={submit} loading={report.isPending} disabled={!ready} size="lg" />}
    >
      <View style={styles.body}>
        <Text style={styles.lead}>What happened?</Text>
        <View style={styles.choices}>
          {ISSUE_CHOICES.map((choice) => {
            const on = kind === choice.kind;
            return (
              <Touchable
                key={choice.kind}
                style={[styles.choice, on && styles.choiceOn]}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                onPress={() => setKind(choice.kind)}
              >
                <View style={[styles.radio, on && styles.radioOn]}>{on && <View style={styles.dot} />}</View>
                <Text style={[styles.choiceText, on && styles.choiceTextOn]}>{choice.label}</Text>
              </Touchable>
            );
          })}
        </View>
        <TextInput
          style={styles.note}
          value={note}
          onChangeText={setNote}
          placeholder={kind === "missing_item" ? "Which item was missing?" : "Tell us a little more (optional)"}
          placeholderTextColor={c.textMuted}
          multiline
          maxLength={1000}
          accessibilityLabel="What went wrong"
        />
      </View>
    </BottomSheet>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    body: { gap: spacing.md, paddingBottom: spacing.md },
    lead: { ...typography.body, color: c.text, fontWeight: "700" },
    choices: { gap: spacing.sm },
    choice: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    choiceOn: { borderColor: c.primaryPressed, backgroundColor: c.primarySoft },
    choiceText: { ...typography.body, color: c.text },
    choiceTextOn: { color: c.primaryPressed, fontWeight: "700" },
    radio: { width: 20, height: 20, borderRadius: 9, borderWidth: 2, borderColor: c.border, alignItems: "center", justifyContent: "center" },
    radioOn: { borderColor: c.primaryPressed },
    // Always drawn would show a dot on every row; only the chosen row has one.
    dot: { width: 10, height: 10, borderRadius: 4, backgroundColor: c.primaryPressed },
    note: {
      ...typography.body,
      color: c.text,
      minHeight: 84,
      textAlignVertical: "top",
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.border,
      padding: spacing.md,
      backgroundColor: c.surface,
    },
  });
