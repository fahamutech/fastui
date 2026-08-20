# Composition Model

FastUI uses a **top-down composition** model. A parent spec controls its children — it lists them in order, controls the layout axis, and owns the wrapper styles applied to each child slot.

---

## Core idea

In a traditional component model, a child "wraps" its parent.  
In FastUI, the **parent composes its children** top-down:

```
parent.yml
  modifier:
    extend:
      - ./header.yml
      - ./body.yml
      - ./footer.yml
    frame:
      base: column.start
```

The parent says: *"render header, then body, then footer, stacked vertically, top-to-bottom"*.  
The children know nothing about this — they are unchanged leaf specs.

---

## `modifier.extend`

The ordered list of child spec paths.

```yaml
# Single child
modifier:
  extend: ./child.yml

# Multiple children — order matters
modifier:
  extend:
    - ./nav.yml
    - ./content.yml
    - ./footer.yml
```

**Rules:**

- Each path must end in `.yml` or `.yaml`.
- Paths are relative to the current spec file.
- The generator renders children **in listed order**, according to `frame.base` direction.
- Reordering the array changes the visual layout — be intentional.
- Children's own `modifier.styles` and `modifier.props` are preserved; the parent does not override them.

---

## `modifier.frame`

The frame contract describes **how a composer lays out its extended children** and what styles its own leaf element carries.

```yaml
frame:
  base: column.start     # string shorthand — layout axis + direction + optional stack
  id: my-frame           # optional — sets id="" on the _base container
  current:               # CSS for THIS spec's own leaf <div> (not a sizing shell)
    backgroundColor: '#ffffff'
    overflow: hidden
  next:                  # CSS applied to EVERY extended child's wrapper div
    flex: 1
```

`frame.base` also accepts an **object form** when you need to style the `_base` outer container directly:

```yaml
frame:
  base:
    type: column.start   # same token values as string form
    styles:              # CSS applied to the _base flex/grid container
      width: 100vw
      height: 100vh
      backgroundColor: '#f0f0f0'
  next:
    flex: 1
```

### When to use which form

| Form | Use when |
|---|---|
| `base: column.start` | Default — no special styling needed on the outer container |
| `base: {type, styles}` | You need to size or decorate the `_base` container itself (e.g. full-page shell, background on the composition wrapper) |

### Generated DOM structure (non-stack)

For `frame.base: column.start` with `extend: [A, B]`:

```html
<!-- _base: the outer flex container — always flex:1 -->
<div id="_base" style="display:flex; flex-direction:column; flex:1">

  <!-- own-view slot: this spec's own leaf element, styled by frame.current -->
  <div id="my-frame" style="display:flex; flex-direction:column; /* frame.current styles */">
    <div style="/* modifier.styles */"></div>   <!-- the actual <div>/<img>/etc -->
  </div>

  <!-- one wrapper per extended child, styled by frame.next -->
  <div id="my-frame_next_0" style="display:flex; flex:1; /* frame.next styles */">
    <A />
  </div>
  <div id="my-frame_next_1" style="display:flex; flex:1; /* frame.next styles */">
    <B />
  </div>

</div>
```

### Generated DOM structure (stack)

For `frame.base: column.start.stack` with `extend: [A, B]`:

```html
<!-- _base: CSS grid — each slot overlaps via grid-area:1/1 -->
<div id="_base" style="display:grid; flex:1">

  <div style="grid-area:1/1">                         <!-- own-view slot (z bottom) -->
    <div id="my-frame" style="display:flex; /* frame.current */">
      <div style="/* modifier.styles */"></div>
    </div>
  </div>

  <div style="grid-area:1/1">                         <!-- extend[0] slot -->
    <div id="my-frame_next_0" style="display:flex; /* frame.next */">
      <A />
    </div>
  </div>

  <div style="grid-area:1/1">                         <!-- extend[1] slot (z top) -->
    <div id="my-frame_next_1" style="display:flex; /* frame.next */">
      <B />
    </div>
  </div>

</div>
```

### `frame.base` tokens

The base token has the format `<axis>.<direction>[.stack]`.

| Token | Axis | Child order | Overlay |
|---|---|---|---|
| `row.start` | Horizontal | Left → Right; own view first | No |
| `row.end` | Horizontal | Left → Right; children first, own view last | No |
| `column.start` | Vertical | Top → Bottom; own view first | No |
| `column.end` | Vertical | Top → Bottom; children first, own view last | No |
| `row.start.stack` | Horizontal | Own view first, children overlaid | Yes (CSS grid) |
| `row.end.stack` | Horizontal | Children overlaid, own view on top | Yes (CSS grid) |
| `column.start.stack` | Vertical | Own view first, children overlaid | Yes (CSS grid) |
| `column.end.stack` | Vertical | Children overlaid, own view on top | Yes (CSS grid) |

**`.stack` variants** use CSS `display:grid` with every layer at `grid-area:1/1`. Earlier entries in `extend` sit lower in z-order; the own-view slot is always index 0.

### `frame.current`

CSS for **this spec's own leaf element wrapper** — the `<div>` that contains the component's own content (text, image, empty box). This is rendered as one slot inside `_base`, alongside the extended children.

**Use `frame.current` for:** decorative styles on the own-view box — `backgroundColor`, `overflow`, `borderRadius`, `padding`, `border`.

**Do not use `frame.current` for:** outer sizing (`width: 100vw`, `height: 100vh`). Those belong on `modifier.styles`, which style the component's own `<div style={style}>` directly. Setting `width/height` on `frame.current` makes that own-view slot fill space inside the `_base` flex container, which is usually not what you want for a pure composer with no own content.

```yaml
# Correct — decorative only on frame.current
frame:
  base: column.start.stack
  current:
    backgroundColor: '#f5f5f5'
    overflow: hidden
    borderRadius: 16px

# Correct — page sizing belongs on modifier.styles, not frame.current
modifier:
  styles:
    width: 100vw
    height: 100vh
```

### `frame.next`

CSS applied to the **wrapper `<div>` generated around every extended child** (`_next_0`, `_next_1`, …). Already includes `display:flex` from the generator.

Use `frame.next` for uniform slot sizing or spacing across all children:

```yaml
next:
  flex: 1          # every child slot grows equally
  width: 100%      # every child slot fills the cross axis
```

---

## Visual examples

### Column layout (vertical stack)

```yaml
# page.yml
component:
  base: container
  modifier:
    extend:
      - ./toolbar.yml
      - ./main_content.yml
      - ./bottom_bar.yml
    frame:
      base:
        type: column.start
        styles:          # applied to the _base outer container
          width: 100vw
          height: 100vh
      id: page-frame
      next:
        width: 100%      # every child slot fills the horizontal axis
```

**Generated DOM:**

```html
<!-- _base: sized by frame.base.styles — the true outer shell -->
<div id="page-frame_base" style="display:flex; flex-direction:column; flex:1; width:100vw; height:100vh;">

  <!-- own-view slot — frame.current is empty, renders as a thin pass-through -->
  <div id="page-frame" style="display:flex; flex-direction:column;">
    <div style="/* modifier.styles — nothing here */"></div>
  </div>

  <div id="page-frame_next_0" style="display:flex; width:100%"><Toolbar /></div>
  <div id="page-frame_next_1" style="display:flex; width:100%"><MainContent /></div>
  <div id="page-frame_next_2" style="display:flex; width:100%"><BottomBar /></div>

</div>
```

> **Tip:** Use `frame.base: {type, styles}` when the composition shell itself needs sizing (e.g. full-page). Use `modifier.styles` only when the composer's own leaf element (its own rendered content alongside the children) needs styling.

**Visual output:**

```
┌─────────────────────────┐
│  toolbar                │  ← toolbar.yml (_next_0)
├─────────────────────────┤
│  main content           │  ← main_content.yml (_next_1)
│                         │
├─────────────────────────┤
│  bottom bar             │  ← bottom_bar.yml (_next_2)
└─────────────────────────┘
```

---

### Row layout (horizontal)

```yaml
# sidebar_layout.yml
component:
  base: container
  modifier:
    extend:
      - ./sidebar.yml
      - ./detail_panel.yml
    frame:
      base: row.start
      id: layout-frame
      next:
        height: 100%    # every child slot fills the vertical axis
```

**Generated DOM:**

```html
<div id="layout-frame_base" style="display:flex; flex-direction:row; flex:1">
  <div id="layout-frame" style="display:flex; flex-direction:row;">
    <div style="/* modifier.styles */"></div>
  </div>
  <div id="layout-frame_next_0" style="display:flex; height:100%"><Sidebar /></div>
  <div id="layout-frame_next_1" style="display:flex; height:100%"><DetailPanel /></div>
</div>
```

**Visual output:**

```
┌──────────┬────────────────────────┐
│ sidebar  │  detail panel          │
│          │                        │
└──────────┴────────────────────────┘
```

---

### Stack / overlay

Use `.stack` when children need to overlap (background image under content, floating button, modal backdrop).

```yaml
# hero_card.yml
component:
  base: container
  modifier:
    styles:
      width: 100%
      height: 280px
      borderRadius: 12px
      overflow: hidden
    extend:
      - ./background_image.yml
      - ./content_overlay.yml
    frame:
      base: column.start.stack
      id: card-frame
      next:
        width: 100%
        height: 100%
```

**Generated DOM:**

```html
<!-- CSS grid: all children share the same grid cell → they overlap -->
<div id="card-frame_base" style="display:grid; flex:1">

  <div style="grid-area:1/1">                    <!-- own-view (z=0, bottom) -->
    <div id="card-frame" style="display:flex;">
      <div style="width:100%; height:280px; borderRadius:12px; overflow:hidden;"></div>
    </div>
  </div>

  <div style="grid-area:1/1">                    <!-- extend[0] (z=1) -->
    <div id="card-frame_next_0" style="display:flex; width:100%; height:100%">
      <BackgroundImage />
    </div>
  </div>

  <div style="grid-area:1/1">                    <!-- extend[1] (z=2, top) -->
    <div id="card-frame_next_1" style="display:flex; width:100%; height:100%">
      <ContentOverlay />
    </div>
  </div>

</div>
```

**Visual output:**

```
┌─────────────────────────────┐
│ [background image fills]    │  ← background_image.yml (z=1)
│  ╔═══════════════════════╗  │
│  ║  Title                ║  │  ← content_overlay.yml (z=2, on top)
│  ║  Subtitle             ║  │
│  ╚═══════════════════════╝  │
└─────────────────────────────┘
```

---

## Component reuse (`base: ./path.yml`)

Component reuse is different from composition. When `base` points to a spec file, both Flutter and React recursively resolve and deep-merge the specification during generation.

```yaml
# src/blueprints/modules/auth/login_button.yml
component:
  base: ../../shared/common/primary_button.yml   # ← reuses the base component
  modifier:
    styles:
      backgroundColor: '#e53935'   # overrides the base button's background
    props:
      id: login-button
      onClick:
        action: navigation.open
        name: dashboard
        type: push
    states:
      label: Sign in            # seeds the base component's initial label state
```

**Generated React component:**

```jsx
export const LoginButton = React.memo(function LoginButton({instanceId, initialState = {}, initialProps = {}}) {
  // Complete generated component: inherited fields are already merged.
  return <div id="login-button" style={{backgroundColor: '#e53935'}} {...initialProps} />;
});
```

Both targets emit a complete `LoginButton`. Object fields merge with local values winning, arrays replace inherited arrays, inherited child paths are rebased to the derived spec, and inheritance cycles report every participating path.

---

## Instance → shared component pattern

This is the primary use of component reuse in Figma-generated specs.

A Figma **INSTANCE** reuses a **MAIN COMPONENT** design. The translator maps this to:

```yaml
# modules/home/ibutton_instance.yml  (INSTANCE)
component:
  base: ../../shared/common/iprimary_button.yml   # ← MAIN COMPONENT path
  modifier:
    styles:
      backgroundColor: '#0066ff'   # instance-specific override
    props:
      id: hero-cta
```

```yaml
# shared/common/iprimary_button.yml  (MAIN COMPONENT)
component:
  base: container
  modifier:
    styles:
      height: 48px
      borderRadius: 24px
      cursor: pointer
    extend:
      - ./iprimary_button_label.yml
    frame:
      base: row.start
```

At generation time: `ibutton_instance.jsx` is a wrapper that renders `IprimaryButton` and passes `backgroundColor: '#0066ff'` and `id: hero-cta` as overrides. The base component `iprimary_button.jsx` merges those overrides internally.

---

## Multi-child extend: ordering semantics

Given `frame.base: column.start` and `extend: [A, B, C]`:

```
Generated render order:  A (top) → B (middle) → C (bottom)
```

Given `frame.base: column.end` and `extend: [A, B, C]`:

```
Generated render order:  C (top) → B (middle) → A (bottom)
```

For `.stack` variants, children are rendered in DOM order (earlier = lower z-index):

```
frame.base: column.start.stack
extend: [background, content, floating_button]

z-order:   background (back) < content < floating_button (front)
```

---

## Generated React output

For a composer with `extend: [header.yml, body.yml]`, `frame.base: column.start`, `frame.next: { width:'100%' }`, and `modifier.styles: { height:'100vh' }`:

```jsx
function Page({ loopElement, loopIndex }) {
  const style = useMemo(() => ({ height: '100vh', boxSizing: 'border-box', minWidth: 0 }), []);

  // composeFrame() output — _base is the outer flex container
  return (
    <div id="page-frame_base" style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>

      {/* own-view slot — styled by frame.current (empty here) */}
      <div id="page-frame" style={{ display: 'flex', flexDirection: 'column', boxSizing: 'border-box', minWidth: 0 }}>
        <div style={style} />        {/* modifier.styles on the leaf <div> */}
      </div>

      {/* one _next_N wrapper per extended child — styled by frame.next */}
      <div id="page-frame_next_0" style={{ display: 'flex', width: '100%' }}>
        <Header loopElement={loopElement} loopIndex={loopIndex} />
      </div>
      <div id="page-frame_next_1" style={{ display: 'flex', width: '100%' }}>
        <Body loopElement={loopElement} loopIndex={loopIndex} />
      </div>

    </div>
  );
}
```

## Generated Flutter output

```dart
class Page extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        // own-view slot
        Container(height: double.infinity),
        // _next_N wrappers
        SizedBox(width: double.infinity, child: const Header()),
        SizedBox(width: double.infinity, child: const Body()),
      ],
    );
  }
}
```

---

## Dark / light theme toggle

FastUI apps can support a user-controlled dark/light theme toggle with the preference stored in `localStorage` (React) or `SharedPreferences` (Flutter). The toggle lives outside the spec system — it is wired into the app shell.

### React

**1. Persist and restore the preference in `App.jsx`:**

```jsx
import React from 'react';

const THEME_KEY = 'fastui_theme';

function getInitialTheme() {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export default function App() {
    const [theme, setTheme] = React.useState(getInitialTheme);

    React.useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem(THEME_KEY, theme);
    }, [theme]);

    const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark');

    return (
        <ThemeContext.Provider value={{theme, toggleTheme}}>
            <AppRoute />
        </ThemeContext.Provider>
    );
}

export const ThemeContext = React.createContext({theme: 'light', toggleTheme: () => {}});
```

**2. Add CSS variables in `src/fastui.css`:**

```css
:root[data-theme='light'] {
    --color-bg: #ffffff;
    --color-surface: #f5f5f5;
    --color-text: #111111;
    --color-primary: #1976d2;
}

:root[data-theme='dark'] {
    --color-bg: #121212;
    --color-surface: #1e1e1e;
    --color-text: #eeeeee;
    --color-primary: #90caf9;
}
```

**3. Use CSS variables in spec styles:**

```yaml
modifier:
  styles:
    backgroundColor: 'var(--color-bg)'
    color: 'var(--color-text)'
```

**4. Add a toggle button component:**

```yaml
# src/blueprints/shared/common/theme_toggle.yml
component:
  base: container
  modifier:
    props:
      onClick:
        action: state.set
        target: theme
        value: event.value
    children: states.label
    states:
      label: '🌙'
```

Or wire the `ThemeContext.toggleTheme` directly from a service:

```js
// src/services/theme_toggle.mjs
export function handleClick({component, args}) {
    const ctx = args[0]?.themeContext;
    ctx?.toggleTheme?.();
}
```

---

### Flutter

**1. Wrap `MaterialApp` with a `ValueNotifier` for the theme mode:**

```dart
// lib/main.dart
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _themeKey = 'fastui_theme';

Future<ThemeMode> loadThemeMode() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_themeKey) == 'dark' ? ThemeMode.dark : ThemeMode.light;
}

Future<void> saveThemeMode(ThemeMode mode) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_themeKey, mode == ThemeMode.dark ? 'dark' : 'light');
}

final themeNotifier = ValueNotifier<ThemeMode>(ThemeMode.light);

void main() async {
    WidgetsFlutterBinding.ensureInitialized();
    themeNotifier.value = await loadThemeMode();
    runApp(const FastUIApp());
}

class FastUIApp extends StatelessWidget {
    const FastUIApp({super.key});

    @override
    Widget build(BuildContext context) {
        return ValueListenableBuilder<ThemeMode>(
            valueListenable: themeNotifier,
            builder: (context, mode, _) => MaterialApp(
                themeMode: mode,
                theme: ThemeData.light(useMaterial3: true),
                darkTheme: ThemeData.dark(useMaterial3: true),
                home: const AppRoute(),
            ),
        );
    }
}
```

**2. Toggle the theme from any widget:**

```dart
void toggleTheme() {
    final next = themeNotifier.value == ThemeMode.dark ? ThemeMode.light : ThemeMode.dark;
    themeNotifier.value = next;
    saveThemeMode(next);
}
```

**3. Add `shared_preferences` to `pubspec.yaml`:**

```yaml
dependencies:
  flutter:
    sdk: flutter
  shared_preferences: ^2.3.0
```
