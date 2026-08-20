# Generators

FastUI generators read normalized spec documents and emit platform source code. Two targets are supported: **ReactJS** and **Flutter**.

---

## Dispatch chain

```
generateSpecFile(specPath)
    │
    ├─ specToJSON()           resolve base inheritance, get flat document
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

### Component

The same `ihero_card.yml` above generates:

```dart
import 'package:flutter/material.dart';
import '../stores/home/store.dart';
import './icard_image.dart';
import './icard_content.dart';

class HeroCard extends StatefulWidget {
  final Map<String, dynamic> inputs;
  const HeroCard({Key? key, this.inputs = const {}}) : super(key: key);

  @override
  State<HeroCard> createState() => _HeroCardState();
}

class _HeroCardState extends State<HeroCard> {
  Map<String, dynamic> states = {'isHovered': false};

  void setStateValue(Map<String, dynamic> patch) {
    // Flutter components watch generated Riverpod providers. Services and
    // actions update the corresponding generated notifier.
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => Navigator.pushNamed(context, '/detail'),
      child: Container(
        width: double.infinity,
        height: 280,
        decoration: BoxDecoration(
          color: const Color(0xFFFFFFFF),
          borderRadius: BorderRadius.circular(12),
        ),
        clipBehavior: Clip.hardEdge,
        child: Column(
          children: [
            SizedBox(
              width: double.infinity,
              child: CardImage(inputs: widget.inputs, states: states, setState: setStateValue),
            ),
            SizedBox(
              width: double.infinity,
              child: CardContent(inputs: widget.inputs, states: states, setState: setStateValue),
            ),
          ],
        ),
      ),
    );
  }
}
```

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

/** @param {{component: {states: object, inputs: object}, args: unknown[]}} data */
export function computeCardStyle(data) {
  // TODO: Implement the service.
}

/** @param {{component: {states: object, inputs: object}, args: unknown[]}} data */
export function fetchCardData(data) {
  // TODO: Implement the service.
}
```

### Flutter service stub

```dart
// lib/services/home/i_hero_card.dart

/// Receives the component state, inputs, and invocation arguments.
dynamic computeCardStyle(Map<String, dynamic> data) {
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
      argument.initialState;
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
