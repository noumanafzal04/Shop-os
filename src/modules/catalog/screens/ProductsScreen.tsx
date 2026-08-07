import React, { useState } from "react";
import {
  Alert,
  FlatList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Plus, Search, Package, Scissors, Boxes } from "lucide-react-native";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { ScreenHeader } from "../../../common/ui/ScreenHeader";
import { AppTextInput } from "../../../common/ui/AppTextInput";
import { Card } from "../../../common/ui/Card";
import { IconChip } from "../../../common/ui/IconChip";
import { Badge } from "../../../common/ui/Badge";
import { Skeleton } from "../../../common/ui/Skeleton";
import { colors, spacing, typography } from "../../../theme";
import { useDebouncedValue } from "../../../common/hooks/useDebouncedValue";
import { useProductMutations, useProducts } from "../hooks/useCatalog";
import type { Product } from "../types";
import type { ShopStackParamList } from "../../../navigation/types";

const money = (n: string | number) => `Rs ${Number(n).toLocaleString()}`;

export function ProductsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<ShopStackParamList>>();
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search, 350);
  const products = useProducts({ search: debounced });
  const { remove } = useProductMutations();
  const rows = products.data?.data ?? [];

  const confirmDelete = (p: Product) =>
    Alert.alert("Delete item", `Delete "${p.name}"? Sales history is kept.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => remove.mutate(p.id) },
    ]);

  const renderItem = ({ item }: { item: Product }) => {
    const isService = item.type === "service";
    const lowStock =
      item.type === "product" && item.low_stock_threshold !== null &&
      item.stock_quantity <= item.low_stock_threshold;

    return (
      <Card
        style={styles.card}
        onLongPress={() => confirmDelete(item)}
        onPress={() => item.type === "product" &&
          navigation.navigate("AdjustStock", { productId: item.id, productName: item.name, stock: item.stock_quantity })}
      >
        <IconChip
          icon={isService ? Scissors : Package}
          size={48}
          tint={isService ? colors.info : colors.brand[500]}
          bg={isService ? colors.infoBg : colors.brand[50]}
        />
        <View style={styles.info}>
          <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
          <View style={styles.metaRow}>
            {item.category?.name && <Text style={styles.meta}>{item.category.name}</Text>}
            {item.sku && <Text style={styles.meta}>· {item.sku}</Text>}
            {item.variants.length > 0 && <Text style={styles.meta}>· {item.variants.length} options</Text>}
          </View>
          <View style={styles.badges}>
            <Badge label={item.type} tone={isService ? "info" : "brand"} />
            {item.type === "product" && (
              lowStock
                ? <Badge label={`Low · ${item.stock_quantity}`} tone="warning" />
                : <Badge label={`Stock ${item.stock_quantity}`} tone="neutral" />
            )}
          </View>
        </View>
        <Text style={styles.price}>{money(item.price)}</Text>
      </Card>
    );
  };

  return (
    <SafeScreen backgroundColor={colors.bg} edges={["top"]}>
      <ScreenHeader
        title="Products & Services"
        subtitle="Your catalog"
        action={{ icon: Plus, label: "Add", onPress: () => navigation.navigate("ProductForm") }}
      />

      <View style={styles.searchWrap}>
        <AppTextInput icon={Search} placeholder="Search name or SKU…" value={search} onChangeText={setSearch} autoCapitalize="none" />
      </View>

      {products.isLoading ? (
        <View style={styles.list}>
          {[0, 1, 2].map((i) => (
            <Card key={i} style={styles.card}>
              <Skeleton width={48} height={48} borderRadius={12} />
              <View style={{ flex: 1, marginLeft: spacing.md }}>
                <Skeleton width="55%" height={16} />
                <Skeleton width="35%" height={12} style={{ marginTop: 8 }} />
              </View>
            </Card>
          ))}
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.empty}>
              <IconChip icon={Boxes} size={56} tint={colors.gray[400]} bg={colors.gray[100]} />
              <Text style={styles.emptyTitle}>{debounced ? "Nothing matches" : "No items yet"}</Text>
              <Text style={styles.emptyText}>
                {debounced ? "Try a different search." : 'Tap "Add" to create your first product or service.'}
              </Text>
            </View>
          }
        />
      )}
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  searchWrap: { paddingHorizontal: spacing.lg },
  list: { padding: spacing.lg, paddingTop: spacing.sm },
  card: { flexDirection: "row", alignItems: "center", marginBottom: spacing.md },
  info: { flex: 1, marginLeft: spacing.md },
  name: { ...typography.h3, color: colors.gray[900] },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 2 },
  meta: { ...typography.small, color: colors.gray[500] },
  badges: { flexDirection: "row", gap: 6, marginTop: 6 },
  price: { ...typography.label, fontSize: 15, color: colors.brand[600], marginLeft: spacing.sm },
  empty: { alignItems: "center", paddingVertical: spacing.xxl, gap: spacing.xs },
  emptyTitle: { ...typography.h3, color: colors.gray[700], marginTop: spacing.sm },
  emptyText: { ...typography.small, color: colors.gray[500], textAlign: "center", paddingHorizontal: spacing.xl },
});
