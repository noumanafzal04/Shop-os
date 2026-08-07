import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { KeyboardScreen } from "../../../common/ui/KeyboardScreen";
import { AppTextInput } from "../../../common/ui/AppTextInput";
import { AppButton } from "../../../common/ui/AppButton";
import { Skeleton } from "../../../common/ui/Skeleton";
import { ApiError } from "../../../common/types/api";
import { colors, radius, spacing, typography } from "../../../theme";
import { useBusinessTypes, useCities, useCompleteSetup } from "../hooks/useShop";
import { useAuthStore } from "../../../stores/authStore";

/**
 * Onboarding — business TYPE first (drives defaults/features), then
 * category + city. Blocks the app until complete
 * (the "user skips setup" edge case).
 */
export function ShopSetupScreen() {
  const user = useAuthStore((s) => s.user);
  const cities = useCities();
  const businessTypes = useBusinessTypes();
  const setup = useCompleteSetup();

  const [businessType, setBusinessType] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [cityId, setCityId] = useState<string | null>(null);
  const [address, setAddress] = useState("");

  const selectedType = businessTypes.data?.find((t) => t.code === businessType);

  const errorMessage =
    setup.error instanceof ApiError
      ? setup.error.firstFieldError() ?? setup.error.message
      : null;

  const submit = () => {
    if (!businessType || !category || !cityId) return;
    setup.mutate({
      business_type: businessType,
      business_category: category,
      city_id: cityId,
      address: address.trim() || undefined,
    });
  };

  return (
    <SafeScreen>
      <KeyboardScreen contentStyle={styles.content}>
        <Text style={styles.title}>Set up your shop</Text>
        <Text style={styles.subtitle}>
          {user?.tenant?.business_name} — two quick details and you're in.
        </Text>

        {errorMessage && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        )}

        <Text style={styles.sectionLabel}>Business type *</Text>
        {businessTypes.isLoading ? (
          <View style={styles.chips}>
            <Skeleton width={110} height={36} borderRadius={radius.full} />
            <Skeleton width={90} height={36} borderRadius={radius.full} />
            <Skeleton width={120} height={36} borderRadius={radius.full} />
          </View>
        ) : (
          <View style={styles.chips}>
            {(businessTypes.data ?? [])
              .filter((t) => t.available)
              .map((t) => (
                <Pressable
                  key={t.code}
                  onPress={() => {
                    setBusinessType(t.code);
                    setCategory(null); // examples change with the type
                  }}
                  style={[styles.chip, businessType === t.code && styles.chipActive]}
                >
                  <Text
                    style={[styles.chipText, businessType === t.code && styles.chipTextActive]}
                  >
                    {t.label}
                  </Text>
                </Pressable>
              ))}
          </View>
        )}

        {selectedType && (
          <>
            <Text style={styles.sectionLabel}>Business category *</Text>
            <View style={styles.chips}>
              {selectedType.examples.map((c) => (
                <Pressable
                  key={c}
                  onPress={() => setCategory(c.toLowerCase())}
                  style={[styles.chip, category === c.toLowerCase() && styles.chipActive]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      category === c.toLowerCase() && styles.chipTextActive,
                    ]}
                  >
                    {c}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        )}

        <Text style={styles.sectionLabel}>City *</Text>
        {cities.isLoading ? (
          <View style={styles.chips}>
            <Skeleton width={90} height={36} borderRadius={radius.full} />
            <Skeleton width={70} height={36} borderRadius={radius.full} />
            <Skeleton width={100} height={36} borderRadius={radius.full} />
          </View>
        ) : (
          <View style={styles.chips}>
            {(cities.data ?? []).map((c) => (
              <Pressable
                key={c.id}
                onPress={() => setCityId(c.id)}
                style={[styles.chip, cityId === c.id && styles.chipActive]}
              >
                <Text style={[styles.chipText, cityId === c.id && styles.chipTextActive]}>
                  {c.name}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        <AppTextInput
          label="Address (optional)"
          placeholder="Shop street address"
          value={address}
          onChangeText={setAddress}
        />

        <AppButton
          title="Finish setup"
          onPress={submit}
          loading={setup.isPending}
          disabled={!businessType || !category || !cityId}
          style={{ marginTop: spacing.sm }}
        />
      </KeyboardScreen>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg },
  title: { ...typography.title, color: colors.gray[900], marginTop: spacing.md },
  subtitle: {
    ...typography.subtitle,
    color: colors.gray[500],
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
  sectionLabel: {
    ...typography.label,
    color: colors.gray[700],
    marginBottom: spacing.sm,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.gray[300],
    backgroundColor: colors.white,
  },
  chipActive: {
    backgroundColor: colors.brand[500],
    borderColor: colors.brand[500],
  },
  chipText: { color: colors.gray[700], fontSize: 13, textTransform: "capitalize" },
  chipTextActive: { color: colors.white },
  errorBox: {
    backgroundColor: "#fef3f2",
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  errorText: { color: colors.error, fontSize: 13 },
});
