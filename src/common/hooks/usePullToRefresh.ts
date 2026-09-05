import React from "react";

/**
 * Pull-to-refresh, showing the spinner only for a pull.
 *
 * Every screen bound `refreshing` to React Query's `isRefetching`, which is
 * true for ANY refetch — a screen coming back into focus, a query whose
 * parameters changed, the home feed re-asking once the phone worked out where
 * it is. The spinner then appears without anyone having pulled, and if the list
 * has been scrolled it appears in the MIDDLE of the content, over a card,
 * looking like something has gone wrong.
 *
 * A pull-to-refresh indicator is feedback for a gesture. If nobody made the
 * gesture there is nothing to give feedback about — the data quietly updating
 * itself is the point of a cache, not an event to announce.
 */
export function usePullToRefresh(refetch: () => Promise<unknown>) {
  const [pulling, setPulling] = React.useState(false);

  const onRefresh = React.useCallback(() => {
    setPulling(true);
    // The gesture ends whether the refetch worked or not. A spinner left
    // turning is the app claiming to still be trying; the failure itself
    // belongs to the screen's error state, not to the gesture.
    //
    // `catch` as well as `finally`, because `finally` RE-THROWS: without it a
    // failed pull is an unhandled promise rejection, which React Native reports
    // as a warning over the app and some configurations treat as fatal.
    refetch()
      .catch(() => {})
      .finally(() => setPulling(false));
  }, [refetch]);

  return { refreshing: pulling, onRefresh };
}
