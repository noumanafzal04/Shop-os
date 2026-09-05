import React, { useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { Eye, EyeOff, type LucideIcon } from "lucide-react-native";
import { radius, spacing, type ThemeColors, typography, useColors } from "../../theme";

interface Props extends TextInputProps {
  label?: string;
  error?: string | null;
  icon?: LucideIcon;
}

/**
 * Rounded, icon-capable input with a clear focus ring and inline password
 * reveal. Consistent across every form in the app.
 */
export function AppTextInput({ label, error, icon: Icon, secureTextEntry, style, ...rest }: Props) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(!!secureTextEntry);

  return (
    <View style={styles.wrap}>
      {!!label && <Text style={styles.label}>{label}</Text>}
      <View
        style={[
          styles.field,
          focused && styles.focused,
          !!error && styles.errored,
        ]}
      >
        {Icon && <Icon size={18} color={focused ? c.brand[500] : c.gray[400]} strokeWidth={2} />}
        <TextInput
          placeholderTextColor={c.gray[400]}
          secureTextEntry={hidden}
          style={[styles.input, style]}
          onFocus={(e) => { setFocused(true); rest.onFocus?.(e); }}
          onBlur={(e) => { setFocused(false); rest.onBlur?.(e); }}
          {...rest}
        />
        {secureTextEntry && (
          <Pressable onPress={() => setHidden((h) => !h)} hitSlop={8}>
            {hidden ? <EyeOff size={18} color={c.gray[400]} /> : <Eye size={18} color={c.gray[500]} />}
          </Pressable>
        )}
      </View>
      {!!error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
  wrap: { marginBottom: spacing.md },
  label: { ...typography.label, color: c.gray[700], marginBottom: 6 },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 50,
    borderWidth: 1.5,
    borderColor: c.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    backgroundColor: c.surface,
  },
  focused: { borderColor: c.brand[500], backgroundColor: c.surface },
  errored: { borderColor: c.error },
  input: { flex: 1, fontSize: 15, color: c.gray[900], paddingVertical: 12 },
  errorText: { ...typography.small, color: c.error, marginTop: 4 },
});
