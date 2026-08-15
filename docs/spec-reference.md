# Spec Reference

A **spec file** is a YAML document that describes one UI node. Every spec file has exactly one root key selecting its primitive. The full JSON Schema is at `fastui.schema.json`.

---

## Root keys

| Key | Primitive | Required fields |
|---|---|---|
| `component` | Renderable UI node | `base`, `modifier` |
| `app` | Alias of `component` (app shell) | `base`, `modifier` |
| `condition` | Two-branch toggle | `modifier.states.condition` |
| `loop` | Repeating list | `modifier.feed`, `modifier.states.data` |
| `surface` | Navigation surface metadata | `modifier.name`, `modifier.mode` |

---

## `component`

The most common primitive. Renders one UI node.

```yaml
component:
  base: <primitive | ./path/to/spec.yml>   # REQUIRED
  modifier:                                # REQUIRED
    extend: ./child.yml                    # or array
    styles: { … }
    props: { … }
    states: { … }
    effects: { … }
    frame:
      base: column.start
      current: { … }
      next: { … }
    metadata: { … }
```

### `base` — **required**

Selects the renderer primitive **or** wraps an existing spec component.

| Value | Description |
|---|---|
| `container` | Generic box. Use for layout wrappers, groups, buttons. |
| `text` | Text node. `modifier.props.children` is the text content. |
| `image` | Image node. `modifier.props.src` is the URL. `modifier.props.alt` is the label. |
| `./path/to/spec.yml` | **Component reuse** — imports the referenced component and renders it, forwarding local `modifier.styles`, `modifier.props`, and `modifier.states` as override props. The base component owns its own shape; this spec is a thin wrapper. |

> **Component reuse is not inheritance.** No deep-merge happens at build time. The generator emits a wrapper component that imports the base and passes local modifier fields as `overrideStyles`, `overrideProps`, and `overrideStates` named parameters. The base component accepts and merges them at render time.

**Component reuse example** (instance wrapping a shared component):

```yaml
# src/blueprints/modules/auth/login_button.yml
component:
  base: ../../shared/common/primary_button.yml   # imports PrimaryButton
  modifier:
    styles:
      backgroundColor: '#e53935'    # overrides the base button's background
    props:
      id: login-button
      onClick:
        action: navigation.open
        name: dashboard
        type: push
```

**Generated React wrapper:**

```jsx
import {PrimaryButton} from '../../shared/common/primary_button.jsx';

export function LoginButton({loopIndex, loopElement}) {
    return (
        <PrimaryButton
            loopIndex={loopIndex}
            loopElement={loopElement}
            overrideStyles={{"backgroundColor": "#e53935"}}
            overrideProps={{"id": "login-button", "onClick": {...}}}
            overrideStates={{}}
        />
    );
}
```

**Generated Flutter wrapper:**

```dart
import 'package:flutter/material.dart';
import '../../shared/common/primary_button.dart';

class FastUILoginButton extends StatelessWidget {
  const FastUILoginButton({super.key, this.loopIndex, this.loopElement});
  final dynamic loopIndex;
  final dynamic loopElement;

  @override
  Widget build(BuildContext context) {
    return FastUIPrimaryButton(
      loopIndex: loopIndex,
      loopElement: loopElement,
      overrideStyles: {'backgroundColor': '#e53935'},
      overrideProps: {'id': 'login-button'},
      overrideStates: {},
    );
  }
}
```

Every generated **base component** automatically accepts `overrideStyles`, `overrideProps`, and `overrideStates` and merges them with its own defaults at render time.

---

### `modifier.extend`

Ordered list of child spec paths this composer renders as its children.  
Accepts a **single path** or an **array of paths**.

```yaml
# single child
modifier:
  extend: ./footer.yml

# multiple children (rendered in listed order)
modifier:
  extend:
    - ./header.yml
    - ./body.yml
    - ./footer.yml
```

When `extend` is set, `modifier.frame` should also be set to define the layout axis.  
See [Composition Model](composition.md) for the full semantics.

---

### `modifier.styles`

Visual styles for this node's own rendered container/widget.  
Two forms:

```yaml
# CSS object (camelCase property names)
styles:
  width: 100%
  height: 100vh
  backgroundColor: '#ffffff'
  display: flex
  flexDirection: column
  gap: 16px
  borderRadius: 8px
  overflow: hidden

# Logic reference (runtime function)
styles: logics.computeCardStyle
```

All standard CSS properties in camelCase are valid. See the schema's `$defs.css` section for the enumerated list. Common properties:

| Property | Type | Example |
|---|---|---|
| `width` | string / number | `'100%'`, `360` |
| `height` | string / number | `'100vh'`, `48` |
| `backgroundColor` | color string | `'#ff0000'`, `'rgba(0,0,0,0.5)'` |
| `color` | color string | `'#333333'` |
| `display` | string | `'flex'` |
| `flexDirection` | string | `'row'`, `'column'` |
| `flex` | number | `1` |
| `gap` | string / number | `16`, `'8px'` |
| `padding` | string / number | `'8px 16px'` |
| `margin` | string / number | `'0 auto'` |
| `fontSize` | number | `16` |
| `fontWeight` | string / number | `'600'`, `600` |
| `borderRadius` | string / number | `8`, `'50%'` |
| `border` | string | `'1px solid #ccc'` |
| `overflow` | string | `'hidden'`, `'auto'` |
| `objectFit` | string | `'cover'`, `'contain'` |
| `opacity` | number | `0.8` |
| `cursor` | string | `'pointer'` |
| `position` | string | `'absolute'`, `'relative'` |
| `top` / `left` / `right` / `bottom` | string / number | `0`, `'16px'` |
| `zIndex` | number | `10` |

---

### `modifier.props`

Platform-neutral attributes passed to the rendered primitive.

| Prop | Type | Description |
|---|---|---|
| `id` | string | DOM/widget identifier. May reference state: `'states.count'` |
| `children` | string | Text content. May reference state/input/component |
| `onClick` | action | Triggered on tap/click |
| `onChange` | action | Triggered when an input value changes |
| `src` | string | Image source URL. Required for `base: image` |
| `alt` | string | Accessible alt text for images |
| `control` | `'input'` | Renders a native input control inside a container |
| `type` | `'text'` \| `'password'` \| `'email'` \| `'number'` \| `'tel'` \| `'url'` \| `'search'` | Input type |
| `value` | string | Controlled input value — typically `'states.value'` |
| `placeholder` | string | Input placeholder text |

**Dynamic props via references:**

| Reference pattern | Resolves to |
|---|---|
| `states.<name>` | Local reactive state key |
| `inputs.<name>` | Passed-in input (loop element, parent input) |
| `inputs.loopElement.<field>` | A field on the current loop item |
| `inputs.loopElement.<field>??<fallback>` | Field with a fallback literal |
| `components.<name>` | A sub-component reference |

---

### `modifier.states`

Local reactive state. Keys are state names, values are initial values.

```yaml
states:
  isOpen: false
  count: 0
  title: 'Hello'
  items: []
  user:
    name: ''
    email: ''
```

State values are referenced in props or children as `'states.<name>'`.  
State changes happen via `state.set` actions on event props.

---

### `modifier.effects`

Side-effects run on mount or when dependencies change.  
Generated as `useEffect` (React) or `initState` (Flutter).

```yaml
effects:
  loadData:
    trigger: mount
    service: logics.fetchData
```

---

### `modifier.frame`

Layout contract for a composer node. **Should be set whenever `extend` is set.**

```yaml
frame:
  base: column.start     # REQUIRED — layout axis + direction
  id: main-frame         # optional unique identifier
  current:               # CSS for this node's own view
    width: 100%
    height: 100%
    backgroundColor: '#f5f5f5'
  next:                  # CSS applied to every extended child's wrapper
    width: 100%
    marginBottom: 8px
```

**Shorthand** — a plain string sets only `base`:

```yaml
frame: column.start
```

See [Composition Model](composition.md) for the full `frame.base` token table.

---

### `modifier.metadata`

Internal translator metadata. Not emitted to generated code.

```yaml
metadata:
  surface: page          # page | overlay | sheet | dialog
```

---

## `condition`

Renders `modifier.left` when `modifier.states.condition` is truthy, `modifier.right` otherwise.

```yaml
condition:
  modifier:
    states:
      condition: false   # REQUIRED — initial boolean
    left: ./logged_in.yml
    right: ./logged_out.yml
    styles:
      width: 100%
    props:
      id: auth-gate
    frame:
      base: column.start
      current:
        width: 100%
```

### Toggling the condition

Use a `state.set` action anywhere in the tree:

```yaml
props:
  onClick:
    action: state.set
    target: condition
    value: true
```

### Expected output (React)

```jsx
function AuthGate({ states, setState, inputs }) {
  return (
    <div id="auth-gate" style={{ width: '100%' }}>
      {states.condition ? <LoggedIn … /> : <LoggedOut … />}
    </div>
  );
}
```

---

## `loop`

Renders `modifier.feed` once per item in `modifier.states.data`.

```yaml
loop:
  modifier:
    states:
      data: []           # REQUIRED — initial array
    feed: ./list_item.yml  # REQUIRED — item template
    props:
      id: product-list
      scroll: vertical
    styles:
      width: 100%
      flex: 1
    frame:
      base: column.start
      current:
        width: 100%
```

### Loop context in the template

The feed spec (`list_item.yml`) receives:

| Input | Value |
|---|---|
| `inputs.loopElement` | The current item object from `states.data` |
| `inputs.loopIndex` | Zero-based integer index |

```yaml
# list_item.yml
component:
  base: container
  modifier:
    styles:
      padding: 12px
    props:
      id: "inputs.loopElement.id"
    extend:
      - ./iitem_title.yml
      - ./iitem_subtitle.yml
```

```yaml
# iitem_title.yml
component:
  base: text
  modifier:
    props:
      children: "inputs.loopElement.title??'No title'"
```

### `scroll` values

| Value | Description |
|---|---|
| `vertical` | Vertical scroll (default for lists) |
| `horizontal` | Horizontal scroll (carousels) |
| `both` | Scroll in both axes |
| `none` | No scrolling — fixed size |

### Expected output (React)

```jsx
function ProductList({ states, setState, inputs }) {
  return (
    <div id="product-list" style={{ width: '100%', flex: 1, overflowY: 'auto' }}>
      {states.data.map((loopElement, loopIndex) => (
        <ListItem key={loopElement._key ?? loopIndex}
          inputs={{ loopElement, loopIndex }}
          states={states}
          setState={setState}
        />
      ))}
    </div>
  );
}
```

---

## `surface`

Describes a navigation surface. Not rendered directly — consumed by the routing generator.

```yaml
surface:
  modifier:
    name: choices            # REQUIRED — route name for navigation.open
    mode: overlay            # REQUIRED — page | overlay | sheet | dialog
    scroll: none
    safeArea: false
    barrierColor: '#00000066'
    barrierDismissible: true
    width: 100%
    height: 360
    transition: MOVE_IN
    direction: BOTTOM
    durationMs: 300
```

### `mode` values

| Value | Description |
|---|---|
| `page` | Full-screen surface pushed onto the navigation stack |
| `overlay` | Floats above the current surface |
| `sheet` | Bottom/top/side sheet presentation |
| `dialog` | Modal dialog |

### `transition` values

| Value | Description |
|---|---|
| `MOVE_IN` | Slides in from `direction` |
| `PUSH` | Push transition |
| `DISSOLVE` | Fade in/out |
| `SMART_ANIMATE` | Flutter Hero / React shared-element style |

---

## Actions

Actions are assigned to event props (`onClick`, `onChange`, etc.).

### `state.set`

Sets a local state key.

```yaml
onClick:
  action: state.set
  target: isOpen
  value: true

# Toggle pattern using event.value
onChange:
  action: state.set
  target: value
  value: event.value
```

### `navigation.open`

Navigates to a named route. The `name` must match a `surface.modifier.name`.

```yaml
onClick:
  action: navigation.open
  name: dashboard
  type: push       # push | replace | sheet | dialog
```

### `navigation.back`

Goes back to the previous route.

```yaml
onClick:
  action: navigation.back
```

### `navigation.close`

Closes the current overlay/sheet/dialog.

```yaml
onClick:
  action: navigation.close
```

---

## Logic references

Styles, children, and state values can reference a function from the generated service file.

```yaml
styles: logics.computeCardStyle
```

```yaml
props:
  children: logics.formatTitle
```

The generator passes `{ states, inputs, args }` to the function:

```js
// src/services/home/ihome_Home.mjs
export function computeCardStyle(data) {
  const { states } = data.component;
  return {
    backgroundColor: states.isSelected ? '#0066ff' : '#ffffff',
    borderRadius: 8,
  };
}
```
