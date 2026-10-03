/**
 * @format
 */

/**
 * GESTURE HANDLER FIRST, BEFORE ANYTHING ELSE IS IMPORTED.
 *
 * Not a convention — the library installs its own touch pipeline and has to
 * do it before React Native's own is set up. Imported anywhere lower and
 * gestures work in development and then silently stop working in a release
 * build, because the module graph is ordered differently once it is bundled.
 *
 * `GestureHandlerRootView` in `App.tsx` is the other half; one without the
 * other gives a tree where handlers mount and never fire.
 */
import 'react-native-gesture-handler';

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
