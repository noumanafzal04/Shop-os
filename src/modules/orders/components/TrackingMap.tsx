import React from "react";
import { StyleSheet, View } from "react-native";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import { HomeIcon, MotorcycleIcon } from "../../../common/ui/icons";
import { radius, type ThemeColors, useColors } from "../../../theme";
import { isPin, type Pin, trackingRegion } from "../trackingMap";

/**
 * THE RIDER ON A MAP, INSIDE THE APP — and your door at the other end.
 *
 * Drawn only while the server reports a live pin (it sends none when the
 * rider's phone has gone quiet: a stale pin is a rider parked where they left
 * ten minutes ago). The order is asked again every 10 s while it is out for
 * delivery (`useMyOrder`), so the bike moves with each answer and the map
 * re-frames both pins. Not interactive beyond pan/zoom; "See on map" beside it
 * still hands the pin to the phone's own maps app for directions.
 */
export function TrackingMap({ rider, home }: { rider: Pin | null; home: Pin | null }) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const map = React.useRef<MapView>(null);
  const region = trackingRegion(rider, home);

  // Re-frame on every new fix — the rider moved, keep both in view.
  const key = `${rider?.lat},${rider?.lng},${home?.lat},${home?.lng}`;
  React.useEffect(() => {
    if (region) map.current?.animateToRegion(region, 600);
    // `key` carries the pins; `region` is derived from them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!region || !isPin(rider)) return null;

  return (
    <View style={styles.wrap}>
      <MapView
        ref={map}
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        initialRegion={region}
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}
        accessibilityLabel="Map of your rider and your address"
      >
        {isPin(home) && (
          <Polyline
            coordinates={[
              { latitude: rider.lat, longitude: rider.lng },
              { latitude: home.lat, longitude: home.lng },
            ]}
            strokeColor={c.primary}
            strokeWidth={3}
            lineDashPattern={[8, 6]}
          />
        )}
        {isPin(home) && (
          <Marker
            coordinate={{ latitude: home.lat, longitude: home.lng }}
            anchor={{ x: 0.5, y: 0.5 }}
            title="Your address"
          >
            <View style={[styles.pin, styles.homePin]}>
              <HomeIcon size={16} color={c.onPrimary} bold />
            </View>
          </Marker>
        )}
        <Marker
          coordinate={{ latitude: rider.lat, longitude: rider.lng }}
          anchor={{ x: 0.5, y: 0.5 }}
          title="Your rider"
        >
          <View style={[styles.pin, styles.riderPin]}>
            <MotorcycleIcon size={17} color={c.primary} bold />
          </View>
        </Marker>
      </MapView>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    wrap: { height: 200, borderRadius: radius.md, overflow: "hidden", borderWidth: 1, borderColor: c.border },
    map: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
    pin: {
      width: 34,
      height: 34,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 2,
    },
    homePin: { backgroundColor: c.primary, borderColor: c.surface },
    riderPin: { backgroundColor: c.surface, borderColor: c.primary },
  });
