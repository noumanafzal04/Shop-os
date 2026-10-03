/**
 * ── `react-native-worklets/plugin` is Reanimated's, and it goes LAST ──
 *
 * Reanimated 4 does not transform anything itself any more; the worklet
 * compiler was split out into `react-native-worklets`, and its Babel plugin
 * is what turns a function marked `"worklet"` into something the UI thread
 * can run. Without it a worklet is an ordinary JS closure, every gesture
 * falls back to the JS thread, and nothing errors — the app simply animates
 * at whatever frame rate the bridge can manage, which is the kind of defect
 * that only shows up on a cheap phone in somebody else's hand.
 *
 * LAST in the list is not a style rule. The plugin rewrites function bodies,
 * so anything that runs after it would be rewriting code it has already
 * finished reasoning about.
 */
module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: ['react-native-worklets/plugin'],
};
