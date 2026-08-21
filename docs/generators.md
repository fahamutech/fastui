# Generators

FastUI generators read normalized spec documents and emit platform source code. Two targets are supported: **ReactJS** and **Flutter**.

---

## Dispatch chain

```
generateSpecFile(specPath)
    │
    ├─ specToJSON()           load specs and preserve component-reuse bases
    ├─ normalizeSpecDocument() identify primitive kind
    ├─ prepareBehavior()       add implicit state defaults
    │
    ├─ kind === 'component'  → composeComponent()  → ReactJS / Flutter template
    ├─ kind === 'condition'  → composeCondition()  → ReactJS / Flutter template
    └─ kind === 'loop'       → composeLoop()       → ReactJS / Flutter template
                                                        │
                                                        └─ ensureServiceFile()
                                                             write/update services stub
```

---

## React generator

Output: `.jsx` file at `src/modules/<module>/<spec-name>.jsx`

State defaults are emitted only in `src/stores/<module>/stores.generated.mjs`. Generated JSX selects only the fields it renders:

```jsx
export const ProfileName = React.memo(function ProfileName({instanceId, initialState = {}, initialProps = {}}) {
  const resolvedInstanceId = instanceId ?? 'profile/profile_name';
  const stateSeed = {inputs: {}, initialState};
  const name = useFastUISelector(profileNameStore, resolvedInstanceId, state => state.name, stateSeed);
  return <div {...initialProps}>{name}</div>;
});
```

Every component accepts `instanceId`, `initialState`, and `initialProps`. Extended children and loop items receive deterministic derived IDs. Equal explicit IDs share a store instance; the first mounted seed wins. Stores dispose after the last subscriber unmounts, with a deferred cleanup that is safe under React Strict Mode.

Conditions select `condition`; loops select `data`; controlled inputs select their value and update the same store before invoking `*_change`. Programmatic store changes update the controlled value without invoking change services.

Translation bindings use `useFastUITranslation(key, args)`. Locale and catalog updates rerender translation consumers, with resolution `active → default → exact key`. Pure components have no store, effect, or translation hooks.

---

## Flutter generator

Output: `.dart` file at `lib/modules/<module>/<spec_name>.dart`

Flutter uses immutable generated models, `AutoDisposeFamilyNotifier` implementations, and public Riverpod family providers. A stateful component watches only the fields it consumes:

```dart
final data = ref.watch(
  productListProvider(_providerInstance).select((state) => state.data),
);
final notifier = ref.read(productListProvider(_providerInstance).notifier);
```

There are no generated business-data `setState()` calls, `ChangeNotifier` stores, widget-owned state mirrors, or state publication bridges. Providers own the data. Widgets are `StatelessWidget`, `ConsumerWidget`, or `ConsumerStatefulWidget` according to the exact features they consume.

Static Flutter styles are translated directly to typed widgets and properties. The generator covers typography, dimensions, padding/margin, backgrounds, images and positioning, uniform and per-corner radii, uniform and per-side borders, shadows, opacity, constraints, clipping, object fit, layer blur, and backdrop blur. Images with a radius receive an actual `ClipRRect`; the radius is not merely painted behind the image. Runtime `FastUIStyleHelper.buildBox` is reserved for hand-authored service-computed style maps.

---

## Services

### What is a service?

A **service** is a user-owned file containing business logic functions referenced by spec logic strings (`logics.<functionName>`).

FastUI **creates the file and stubs missing functions** but **never overwrites existing implementations**.

### Location

| Template | Path |
|---|---|
| React | `src/services/<module>/<spec-name>.mjs` |
| Flutter | `lib/services/<module>/<spec_name>.dart` |

### React service stub

```js
// src/services/home/ihero_card.mjs

/** @param {import('../../fastui_runtime.mjs').FastUIComponentContext} context */
export function computeCardStyle(context) {
  // TODO: Implement the service.
}
```

### Flutter service stub

```dart
// lib/services/home/i_hero_card.dart

/// Receives Riverpod state, notifier, inputs, and invocation arguments.
FutureOr<void> loadCard(
  FastUIComponentContext<FastUICardStateModel, FastUICardNotifier> context,
) {
  // TODO: Implement the service.
}
```

### Calling a service from a spec

```yaml
styles: logics.computeCardStyle
```

The generator imports and calls the function with a generated component context:

```js
context.state
context.inputs
context.args
context.setState('field', value)
```

`setState` is a compatibility-neutral context operation, not Flutter's widget `setState`. It dispatches to the generated named setter. New generated initialization stubs make that setter explicit:

```js
context.store.setData(context.instanceId, rows); // React
```

```dart
context.notifier.setData(rows); // Flutter
```

For loops, design-time rows appear only in a newly created `*_init` stub. The generated store default remains empty. Existing service implementations are never rewritten, so replacing the sample with repository/API data permanently removes the design seed from runtime behavior.

---

## State stores

### When a store is generated

A store is generated for every **module** that contains at least one stateful spec (any spec with a non-empty `modifier.states`).

### React store

**`src/stores/<module>/stores.generated.mjs`** — regenerated on every build:

```js
export const heroCardStore = createFastUIComponentStore({
  componentId: 'home/hero_card',
  fields: ['isHovered'],
  createInitialState: () => ({isHovered: false}),
  setters: {setIsHovered: (state, value) => ({...state, isHovered: value})},
});
```

The public API includes `get`, `subscribe`, `update`, `setField`, and one generated method per field. `FastUIComponentContext.setState('isHovered', value)` resolves and calls `setIsHovered`; it does not bypass the model through `setField`.

**`src/stores/<module>/models.generated.mjs`** — regenerated on every build:

```js
/**
 * @readonly
 * @typedef {Object} HeroCardStateModel
 * @property {boolean} isHovered
 */
```

### Flutter providers

**`lib/stores/<module>/providers.generated.dart`** — regenerated on every build:

```dart
class FastUIHeroCardNotifier extends AutoDisposeFamilyNotifier<
    FastUIHeroCardStateModel,
    FastUIProviderInstance<FastUIHeroCardStateModel>> {
  @override
  FastUIHeroCardStateModel build(FastUIProviderInstance<FastUIHeroCardStateModel> argument) =>
      fastUIHeroCardInitialState(argument.initialOverrides);

  void setIsHovered(bool? value) => state = state.copyWith(isHovered: value);

  void setField(String key, dynamic value) { … }
}

final heroCardProvider = NotifierProvider.autoDispose.family<…>(…);
```

**`lib/stores/<module>/models.generated.dart`** — regenerated on every build:

```dart
class FastUIHeroCardStateModel {
  const FastUIHeroCardStateModel({required this.isHovered});
  final bool? isHovered;
}
```

Loop model documentation exposes every discovered row field—including image/vector fields—so a service can see the required data shape before replacing the generated sample.

---

## Routing

### React — `AppRoute.jsx`

```jsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Home } from './modules/presentation/pages/ihome_Home.jsx';
import { Detail } from './modules/presentation/pages/idetail_Detail.jsx';

export function AppRoute() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/detail" element={<Detail />} />
      </Routes>
    </BrowserRouter>
  );
}
```

### Flutter — `app_route.dart`

```dart
import 'package:flutter/material.dart';
import 'modules/presentation/pages/i_home.dart';
import 'modules/presentation/pages/i_detail.dart';

class AppRoute extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      initialRoute: '/',
      routes: {
        '/': (_) => const Home(),
        '/detail': (_) => const Detail(),
      },
    );
  }
}
```

### Flutter runtime — `fastui_runtime.dart`

Generated on every `specs build`. Contains `FastUINavigation` helper:

```dart
class FastUINavigation {
  static void open(BuildContext context, String name, {String type = 'push'}) { … }
  static void back(BuildContext context) { … }
  static void close(BuildContext context) { … }
}
```

---

## Generated manifest

Generated runtime, modules, models, providers/stores, and translation catalogs are disposable and overwritten on every build. There is no legacy compatibility or migration layer. Files under `src/services/**` and `lib/services/**` are user-owned: FastUI creates missing files and appends missing hooks, but never replaces an existing function body. Stale deletion is restricted to paths recorded as generated ownership in the manifest.

`.fastui/generated-manifest.json` tracks every generated file path.

```json
{
  "version": 1,
  "template": "reactjs",
  "files": [
    "/project/src/modules/home/ihero_card.jsx",
    "/project/src/stores/home/models.generated.mjs"
  ]
}
```

On the next build, files in the manifest that no longer correspond to a spec are **deleted automatically** — no stale generated files accumulate.
