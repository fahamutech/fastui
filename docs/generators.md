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

### Component

```yaml
# ihero_card.yml
component:
  base: container
  modifier:
    styles:
      width: 100%
      height: 280px
      backgroundColor: '#ffffff'
      borderRadius: 12px
      overflow: hidden
      cursor: pointer
    props:
      id: hero-card
      onClick:
        action: navigation.open
        name: detail
        type: push
    states:
      isHovered: false
    extend:
      - ./icard_image.yml
      - ./icard_content.yml
    frame:
      base: column.start
      current:
        width: 100%
        height: 280px
      next:
        width: 100%
```

**Generated output:**

```jsx
import { useCallback } from 'react';
import { useModuleState } from '../../stores/home/store.mjs';
import { navigate } from '../../AppRoute.jsx';
import { CardImage } from './icard_image.jsx';
import { CardContent } from './icard_content.jsx';

export function HeroCard({ states: parentStates, setState: setParentState, inputs }) {
  const [states, setState] = useModuleState('HeroCard', { isHovered: false });

  const handleClick = useCallback(() => {
    navigate({ name: 'detail', type: 'push' });
  }, []);

  return (
    <div
      id="hero-card"
      onClick={handleClick}
      style={{
        width: '100%',
        height: 280,
        backgroundColor: '#ffffff',
        borderRadius: 12,
        overflow: 'hidden',
        cursor: 'pointer',
      }}
    >
      <div style={{ width: '100%' }}>
        <CardImage states={states} setState={setState} inputs={inputs} />
      </div>
      <div style={{ width: '100%' }}>
        <CardContent states={states} setState={setState} inputs={inputs} />
      </div>
    </div>
  );
}
```

### Condition

```yaml
# iauth_gate.yml
condition:
  modifier:
    states:
      condition: false
    left: ./iloggedin.yml
    right: ./iloggedout.yml
    styles:
      width: 100%
      flex: 1
```

**Generated output:**

```jsx
export function AuthGate({ states: parentStates, setState: setParentState, inputs }) {
  const [states, setState] = useModuleState('AuthGate', { condition: false });

  return (
    <div style={{ width: '100%', flex: 1 }}>
      {states.condition
        ? <LoggedIn states={states} setState={setState} inputs={inputs} />
        : <LoggedOut states={states} setState={setState} inputs={inputs} />}
    </div>
  );
}
```

### Loop

```yaml
# iproduct_list.yml
loop:
  modifier:
    states:
      data: []
    feed: ./iproduct_item.yml
    props:
      id: product-list
      scroll: vertical
    styles:
      width: 100%
      flex: 1
```

**Generated output:**

```jsx
export function ProductList({ states: parentStates, setState: setParentState, inputs }) {
  const [states, setState] = useModuleState('ProductList', { data: [] });

  return (
    <div
      id="product-list"
      style={{ width: '100%', flex: 1, overflowY: 'auto' }}
    >
      {states.data.map((loopElement, loopIndex) => (
        <ProductItem
          key={loopElement._key ?? loopIndex}
          inputs={{ loopElement, loopIndex, ...inputs }}
          states={states}
          setState={setState}
        />
      ))}
    </div>
  );
}
```

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
    setState(() { states = {...states, ...patch}; });
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

The generator imports and calls the function, passing:

```js
{ component: { states, inputs }, args: [] }
```

---

## State stores

### When a store is generated

A store is generated for every **module** that contains at least one stateful spec (any spec with a non-empty `modifier.states`).

### React store

**`src/stores/<module>/store.mjs`** — auto-generated once, never overwritten:

```js
import { createObservableStore } from '../../stores/observable_store.mjs';
import { useObservable } from '../../stores/use_observable.mjs';

export const moduleStore = createObservableStore();

export function useModuleState(componentName, initialState) {
  // Returns [state, setState] scoped to this component instance.
  // Each mounted instance gets its own slot — siblings never share state.
}
```

**`src/stores/<module>/models.generated.mjs`** — regenerated on every build:

```js
/**
 * @typedef {Object} HeroCardStateModel
 * @property {boolean} isHovered
 */
```

### Flutter store

**`lib/stores/<module>/store.dart`** — auto-generated once, never overwritten:

```dart
class FastUIModuleStore extends ChangeNotifier {
  final Map<Type, Map<String, Object>> _values = {};

  Map<String, T> values<T extends Object>() => …;
  void set<T extends Object>(String instanceId, T value) { … notifyListeners(); }
  void remove<T extends Object>(String instanceId) { … }
}

final moduleStore = FastUIModuleStore();
```

**`lib/stores/<module>/models.generated.dart`** — regenerated on every build:

```dart
class FastUIHeroCardStateModel {
  const FastUIHeroCardStateModel({required this.isHovered});
  final bool isHovered;
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
