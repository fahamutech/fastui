# FastUI Tools

A CLI-driven, spec-first UI code generator. Write YAML blueprints, run one command, and get production-ready **React** or **Flutter** component code — including state, effects, logic wiring, styling, and routing.

---

## Table of Contents

- [Installation](#installation)
- [Setup](#setup)
- [CLI Commands](#cli-commands)
- [Blueprint Spec Format](#blueprint-spec-format)
  - [Root Keys](#root-keys)
  - [Modifier Object](#modifier-object)
  - [Value Prefixes](#value-prefixes)
  - [children](#children)
  - [styles](#styles)
  - [props](#props)
  - [states](#states)
  - [effects](#effects)
  - [frame](#frame)
  - [extend / left / right / feed](#extend--left--right--feed)
- [Component Types](#component-types)
- [Spec Patterns](#spec-patterns)
  - [Stateless Component](#stateless-component)
  - [Stateful Component](#stateful-component)
  - [Event Callbacks](#event-callbacks)
  - [Effects with Watch](#effects-with-watch)
  - [Condition (if/else)](#condition-ifelse)
  - [Loop (list)](#loop-list)
  - [Custom Caller Props](#custom-caller-props)
  - [Design Tokens and i18n](#design-tokens-and-i18n)
- [Logic Functions](#logic-functions)
  - [React Logic File](#react-logic-file)
  - [Flutter Logic File](#flutter-logic-file)
- [Templates](#templates)
- [Navigation](#navigation)
- [Figma Automation](#figma-automation)
- [Project Structure](#project-structure)

---

## Installation

```bash
npm install -g fastui-tools
```

---

## Setup

Run in the root of your project:

```bash
fastui init
```

This creates:
- `src/blueprints/` — where you write your YAML specs
- `watch.mjs` — a file-watcher that auto-rebuilds specs on save
- `fastui.schema.json` — JSON schema for IDE autocomplete on `.yml` files
- `start.mjs` — convenience start script

Configure the template in `.env` at your project root:

```env
# Options: reactjs | flutter | react-native
TEMPLATE=reactjs
```

For Figma automation also add:

```env
FIGMA_TOKEN=your_figma_token
FIGMA_FILE=your_figma_file_key
```

---

## CLI Commands

| Command | Description |
|---|---|
| `fastui init` | Bootstrap the project (creates blueprints folder, schema, watch file) |
| `fastui specs list <path>` | List all `.yml` specs under `<path>` |
| `fastui specs build <path>` | Build source files from all specs under `<path>` |
| `fastui specs automate` | Pull Figma file and generate blueprint stubs for every frame |
| `fastui watch` | Regenerate the `watch.mjs` watcher file |

### Development Workflow

```bash
# Build all specs once
fastui specs build ./src/blueprints

# Or run the watcher (auto-builds on save)
node watch.mjs
```

---

## Blueprint Spec Format

Every spec is a single `.yml` file inside `src/blueprints/`. The filename becomes the generated component name (snake_case → PascalCase).

```
src/blueprints/
  modules/
    login_button.yml     →  LoginButton.jsx / login_button.dart
    user_card.yml        →  UserCard.jsx    / user_card.dart
  pages/
    home_page.yml        →  HomePage.jsx    / home_page.dart
```

### Root Keys

A spec file uses exactly **one** of these root keys to declare the component type, plus optional `condition` and `loop` sections:

| Key | Description |
|---|---|
| `rectangle` | A styled container / box (default) |
| `text` | A text display widget |
| `image` | An image widget |
| `input` | A text input / form field |
| `component` | Generic component (same as `rectangle`, legacy alias) |
| `condition` | An if/else switcher between two child components |
| `loop` | A list/scroll view rendering repeated items |

---

### Modifier Object

Every root key contains a `modifier` object that describes all the component's behaviour:

```yaml
rectangle:
  modifier:
    styles: { ... }
    props: { ... }
    states: { ... }
    effects: { ... }
    frame: column.start
    extend: ./other_comp.yml
    left: ./false_comp.yml
    right: ./true_comp.yml
    feed: ./item_comp.yml
```

---

### Value Prefixes

Values inside `styles`, `props`, `states`, and effect `watch` lists support special prefixes that the generator resolves at code-gen time:

| Prefix | Resolves to | Example |
|---|---|---|
| `states.x` | Local state variable `x` | `states.isLoading` |
| `inputs.x` | Caller prop / widget parameter `x` | `inputs.userId` |
| `logics.fn` | Logic function `fn` as a **callback** (in `props`) | `logics.handleLogin` |
| `logics.fn()` | Logic function `fn` called **immediately at render** (in `props` only) | `logics.getColor()` |
| `theme.x` | Design token `AppTheme.x` | `theme.primaryColor` |
| `i18n.x` | Localisation string `AppStrings.x` | `i18n.loginLabel` |

---

### children

Defined inside `modifier.props.children`. Controls what is rendered inside the component.

```yaml
props:
  children: Hello World       # static string literal
  children: states.title      # bound to local state
  children: inputs.label      # passed in from parent
```

> `theme.` and `i18n.` prefixes are **not** supported in `children`. Use them in `styles` and other `props` keys only.

---

### styles

CSS-like styling. Values can be static or use prefixes.

```yaml
styles:
  height: 54
  backgroundColor: "#1A73E8"
  color: states.textColor        # reactive — changes with state
  fontSize: inputs.size          # caller-provided
  borderRadius: theme.radiusMd   # design token
  color: logics.getTextColor     # computed by logic function
```

`styles` can also be a **single `logics.fn` string** when the whole style object is returned by a function:

```yaml
styles: logics.getCardStyle      # getCardStyle({component,args:[]}) must return a style object
```

For Flutter, `styles` maps to `Container` decoration and `TextStyle` properties. Supported: `height`, `width`, `backgroundColor`, `color`, `fontSize`, `fontWeight`, `fontFamily`, `borderRadius`, `borderColor`, `borderWidth`, `padding`, `paddingTop/Bottom/Left/Right`, `margin`, `marginTop/Bottom/Left/Right`.

---

### props

JSX attributes / Flutter widget parameters. `children` is a reserved prop (see above). All other keys become attributes on the rendered element.

```yaml
props:
  placeholder: inputs.hint       # caller provides hint text
  disabled: states.isLoading     # reactive attribute
  onTap: logics.handleSubmit     # event → logic function (callback)
  onLongPress: logics.showMenu   # GestureDetector in Flutter
  src: inputs.imageUrl           # image source
```

**Event props** (`onTap`, `onDoubleTap`, `onLongPress`, `onPressed`) automatically wrap the Flutter widget in a `GestureDetector`.

In `props`, the `logics.fn` vs `logics.fn()` distinction matters:
- `logics.handleTap` → generates `(...args) => handleTap({component, args})` (a lazy callback)
- `logics.getLabel()` → generates `getLabel({component, args:[]})` (called immediately at render)

---

### states

Declares local reactive state. Values can be static defaults or `inputs.x` to initialise from a caller prop.

```yaml
states:
  count: 0              # number, default 0
  isLoading: false      # boolean
  userName: ""          # string
  profile: null         # null/dynamic
  tab: inputs.initTab   # initialised from a caller prop
```

**Generated (React):**
```js
const [count, setCount] = React.useState(0);
const [isLoading, setIsLoading] = React.useState(false);
```

**Generated (Flutter):**
```dart
num count = 0;
bool isLoading = false;
dynamic userName = "";
```

---

### effects

Side effects that run on mount (and optionally re-run when dependencies change). Each effect has a `body` and an optional `watch` list.

```yaml
effects:
  onMount:
    body: logics.fetchData()       # fires once on mount
    watch: []
  onUserChange:
    body: logics.loadUser          # re-fires when inputs.userId changes
    watch:
      - inputs.userId
  onCountChange:
    body: logics.trackCount        # re-fires when count state changes
    watch:
      - states.count
```

**React** uses `React.useEffect` with the sanitized `watch` array as the dependency list.

**Flutter** fires effects in `initState`. Effects with `inputs.*` watch deps also generate a `didUpdateWidget` override:

```dart
@override
void didUpdateWidget(covariant MyWidget oldWidget) {
  super.didUpdateWidget(oldWidget);
  if (oldWidget.userId != widget.userId) {
    /*onUserChange*/ loadUserProfile(data: _component);
  }
}
```

> **Flutter note:** `states.*` watch entries are not supported in `didUpdateWidget` since Flutter state changes happen inside `setState`. For state-reactive re-runs, trigger the logic call manually inside the logic that updates the state.

---

### frame

Controls layout direction and child slot positioning. The generated component always exposes a `view` prop so a parent can inject additional children.

| Value | Layout |
|---|---|
| `column.start` | Column, component first, `view` after (default) |
| `column.end` | Column, `view` first, component after |
| `row.start` | Row, component first, `view` after |
| `row.end` | Row, `view` first, component after |
| `column.start.stack` | Column, `extend` nested **inside** the base element as a child |
| `row.start.stack` | Row, `extend` nested inside the base element |

String shorthand:
```yaml
frame: column.start
```

Object form with per-frame styles:
```yaml
frame:
  base: row.start
  styles:
    gap: 16
    padding: 12
```

**Non-stack `extend`:** the extended component **wraps** the base, receiving it as `view`.
**Stack `extend`:** the extended component is **nested inside** the base element as a direct child.

---

### extend / left / right / feed

These link a spec to other specs via `.yml` file paths.

| Key | Usage |
|---|---|
| `extend` | Wraps or stacks another component inside this one |
| `left` | The component rendered when `condition === false` |
| `right` | The component rendered when `condition === true` |
| `feed` | The per-item component rendered inside a `loop` |

```yaml
# condition spec — only left/right/extend/frame are allowed in modifier
condition:
  modifier:
    left: ./empty_state.yml    # shown when condition === false
    right: ./user_card.yml     # shown when condition === true
    frame: column.start
```

> **condition** always auto-generates `states: {condition: false}` and an `onStart` effect that calls `logics.onStart` on mount. You cannot define custom states or effects in a condition spec.

```yaml
# loop spec — only feed/extend/props/styles/frame are allowed in modifier
loop:
  modifier:
    feed: ./modules/product_card.yml
    styles:
      padding: 16
    frame: column.start
```

> **loop** always auto-generates `states: {data: []}` and an `onStart` effect that calls `logics.onStart` on mount. You cannot define custom states or effects in a loop spec.

---

## Component Types

### `rectangle` / `component`

Renders as a `<div>` (React) or `Container` (Flutter). The most common type for layout containers, cards, and buttons.

```yaml
rectangle:
  modifier:
    styles:
      height: 48
      backgroundColor: "#1A73E8"
      borderRadius: 8
    props:
      onTap: logics.handlePress
```

### `text`

Renders as a `<div>` with text content (React) or `Text` widget (Flutter).

```yaml
text:
  modifier:
    props:
      children: states.title
    styles:
      fontSize: 18
      fontWeight: bold
      color: theme.textPrimary
```

### `image`

Renders as `<img>` (React) or `Image.network` (Flutter).

```yaml
image:
  modifier:
    props:
      src: inputs.imageUrl
    styles:
      height: 200
      width: 200
```

### `input`

Renders as `<input>` (React) or `TextField` (Flutter).

```yaml
input:
  modifier:
    props:
      placeholder: i18n.emailPlaceholder
      onChange: logics.onEmailChange
    styles:
      height: 48
```

---

## Spec Patterns

### Stateless Component

No states, no effects. Renders from caller props only.

```yaml
text:
  modifier:
    props:
      children: inputs.label
    styles:
      fontSize: 14
      color: theme.textSecondary
```

### Stateful Component

Declares local state. Logic functions can call the generated setters via the `component` object.

```yaml
rectangle:
  modifier:
    states:
      count: 0
    props:
      children: states.count
      onTap: logics.increment
    styles:
      height: 48
      backgroundColor: "#E8F4FD"
```

Logic function:
```js
// React
export function increment({ component }) {
    component.states.setCount(component.states.count + 1);
}
```

### Event Callbacks

Wire any `logics.fn` to any event prop. In React it becomes a JSX callback; in Flutter it wraps in a `GestureDetector`.

```yaml
rectangle:
  modifier:
    props:
      onTap: logics.handleLogin
      onLongPress: logics.showOptions
    styles:
      height: 56
      backgroundColor: theme.primary
```

### Effects with Watch

```yaml
rectangle:
  modifier:
    states:
      profile: null
    effects:
      fetchProfile:
        body: logics.loadProfile
        watch:
          - inputs.userId    # re-runs whenever userId prop changes
    frame: column.start
    extend: ./profile_card.yml
```

### Condition (if/else)

```yaml
condition:
  modifier:
    left: ./empty_view.yml     # rendered when condition === false
    right: ./content_view.yml  # rendered when condition === true
    frame: column.start
```

The generator **always** injects `states: {condition: false}` and an `onStart` effect that calls `logics.onStart` on mount. You only need to implement `onStart` in the auto-created logics file and call `setCondition`:

```js
// src/pages/logics/my_condition.mjs  (React)
export function onStart({ component }) {
    const session = getSession();
    component.states.setCondition(!!session);
}
```

```dart
// src/pages/logics/my_condition.dart  (Flutter)
void onStart({required Map<String, dynamic> data}) {
  final set = data['states']['setCondition'] as Function;
  set(getSession() != null);
}
```

### Loop (list)

```yaml
loop:
  modifier:
    feed: ./modules/item_card.yml
    styles:
      padding: 16
    frame: column.start
```

The generator **always** injects `states: {data: []}` and an `onStart` effect that calls `logics.onStart` on mount. Implement `onStart` to populate the list:

```js
// src/modules/logics/product_list.mjs  (React)
export async function onStart({ component }) {
    const items = await api.getProducts();
    component.states.setData(items);
}
```

```dart
// src/modules/logics/product_list.dart  (Flutter)
void onStart({required Map<String, dynamic> data}) async {
  final items = await fetchProducts();
  (data['states']['setData'] as Function)(items);
}
```

Each rendered item receives `loopElement` (the row data object) and `loopIndex` (the row index). In the item spec, access them with `inputs.loopElement` and `inputs.loopIndex`.

### Custom Caller Props

Any `inputs.x` reference (beyond `view`, `loopElement`, `loopIndex`) is automatically extracted and added as a constructor parameter.

```yaml
rectangle:
  modifier:
    props:
      children: inputs.title
      onTap: logics.handleSelect
    states:
      selected: inputs.isSelected   # initialise from caller
    styles:
      backgroundColor: states.selected
```

**Flutter** generates:
```dart
class MyCard extends StatefulWidget {
  const MyCard({super.key, this.view, this.loopElement, this.loopIndex,
                this.title, this.isSelected});

  final Widget? view;
  final dynamic loopElement;
  final int? loopIndex;
  final dynamic title;
  final dynamic isSelected;
  ...
}
```

### Design Tokens and i18n

Use `theme.x` and `i18n.x` prefixes anywhere a value is accepted.

```yaml
rectangle:
  modifier:
    styles:
      backgroundColor: theme.surfaceColor
      borderRadius: theme.radiusSm
    props:
      placeholder: i18n.searchHint
      children: i18n.welcomeTitle
```

**React** generates `AppTheme.surfaceColor` and `AppStrings.searchHint`.  
**Flutter** generates `AppTheme.surfaceColor` and `AppStrings.searchHint`.

You provide these classes yourself; FastUI just generates the references.

---

## Logic Functions

Every spec that references `logics.fn` gets a corresponding logic file auto-created alongside the source file. The file is only scaffolded — implementation is yours.

### React Logic File

Location: `src/modules/logics/my_component.mjs` (auto-created with stubs on first build)

```js
/**
 * @param data {{ component: { states: *, inputs: * }, args: Array<*> }}
 */
export function fetchData(data) {
    const { component, args } = data;
    // Read state
    const current = component.states.count;
    // Update state (triggers re-render)
    component.states.setCount(current + 1);
    // Read caller prop
    const userId = component.inputs.userId;
    // args = event arguments array (for event-prop callbacks)
}
```

The `component` object shape:
- `component.states.x` — current value of state `x`
- `component.states.setX(value)` — setter for state `x`
- `component.inputs.x` — caller prop `x` (`view`, `loopElement`, `loopIndex`, or any custom input)
- `data.args` — array of event arguments (e.g. click event object)

### Flutter Logic File

Location: `src/modules/logics/my_component.dart` (auto-created with stubs on first build)

```dart
void fetchData({required Map<String, dynamic> data}) {
  final states = data['states'] as Map<String, dynamic>;
  final inputs = data['inputs'] as Map<String, dynamic>;

  // Read state
  final count = states['count'];

  // Update state — triggers setState inside the widget
  (states['setCount'] as Function)(count + 1);

  // Read caller prop
  final userId = inputs['userId'];
}
```

The `data` map shape:
- `data['states']['x']` — current value of state `x`
- `data['states']['setX']` — `Function` setter for state `x`
- `data['inputs']['x']` — caller prop `x`

---

## Templates

Set `TEMPLATE` in `.env`:

| Value | Output |
|---|---|
| `reactjs` | React functional components (`.jsx`) |
| `flutter` | Dart StatefulWidget / StatelessWidget (`.dart`) |
| `react-native` | React Native (planned) |

The generator is template-agnostic at the spec level — the same YAML produces valid code for any target.

---

## Navigation

FastUI scans blueprint filenames for routing conventions:

| Suffix | Role |
|---|---|
| `_page` | Full screen route (e.g. `home_page.yml`) |
| `_dialog` | Modal/overlay (e.g. `confirm_dialog.yml`) |

When using `fastui specs automate` (Figma import), the tool reads Figma frame names with these suffixes and generates an `AppRoute.jsx` and `routing.mjs` that wire all pages and dialogs into the app router automatically.

---

## Figma Automation

FastUI can read a Figma file and scaffold blueprint stubs for every frame:

1. Add your credentials to `.env`:
   ```env
   FIGMA_TOKEN=figd_...
   FIGMA_FILE=abc123XYZ
   ```
2. Name Figma frames following the convention (`home_page`, `product_detail_page`, `confirm_dialog`, etc.)
3. Run:
   ```bash
   fastui specs automate
   ```

This traverses every page and frame in the file, writes stub `.yml` blueprints into `src/blueprints/`, and generates the routing file.

---

## Project Structure

```
your-project/
├── .env                        # TEMPLATE, FIGMA_TOKEN, FIGMA_FILE
├── watch.mjs                   # Auto-build watcher (generated by fastui init)
├── fastui.schema.json          # IDE schema for .yml autocomplete
└── src/
    ├── blueprints/             # Your YAML spec files (source of truth)
    │   ├── pages/
    │   │   └── home_page.yml
    │   └── modules/
    │       ├── login_button.yml
    │       └── user_card.yml
    ├── pages/                  # Generated page components
    │   ├── home_page.jsx       # (React) or home_page.dart (Flutter)
    │   └── logics/
    │       └── home_page.mjs   # Your logic implementation
    └── modules/                # Generated module components
        ├── login_button.jsx
        ├── user_card.jsx
        └── logics/
            ├── login_button.mjs
            └── user_card.mjs
```

### FastUI Source Structure

```
fastui/
├── src/
│   ├── index.mjs               # CLI entry point
│   ├── cli/
│   │   ├── command.mjs         # Command router + spec processor
│   │   ├── merge_condition.mjs # Condition spec normaliser
│   │   └── merge_loop.mjs      # Loop spec normaliser
│   ├── helpers/
│   │   ├── index.mjs           # Functional utilities (compose, ifDoElse, etc.)
│   │   └── config.mjs          # Template selection, env loading
│   └── services/
│       ├── automation/
│       │   └── figma.mjs       # Figma API client + frame traversal
│       ├── generator/
│       │   ├── modifier.mjs    # Spec data accessors (getStyles, getProps, …)
│       │   ├── specs.mjs       # YAML → JSON parser + file discovery
│       │   ├── index.mjs       # Shared code-gen utilities (props, states, effects, logics)
│       │   ├── component.mjs   # React component generator
│       │   ├── condition.mjs   # React condition generator
│       │   ├── loop.mjs        # React loop generator
│       │   ├── helper.mjs      # File system helpers, routing file generation
│       │   └── flutter/
│       │       ├── component.mjs  # Flutter component generator
│       │       ├── condition.mjs  # Flutter condition generator
│       │       ├── loop.mjs       # Flutter loop generator
│       │       └── styles.mjs     # CSS → Flutter style conversion
│       └── templates/
│           ├── base.mjs           # BaseTemplate interface
│           ├── mapping.mjs        # Template → presentation method mapping
│           ├── reactjs/index.mjs  # ReactJS template (useState, useEffect, etc.)
│           ├── flutter/index.mjs  # Flutter template (Dart state, effects, inputs)
│           └── react-native/      # React Native template (planned)
└── fastui.schema.json             # JSON schema for .yml intellisense
```

---

## Quick Examples

### Component with state and effects

**`src/blueprints/modules/login_form.yml`**

```yaml
rectangle:
  modifier:
    states:
      email: ""
      password: ""
      isLoading: false
    props:
      onTap: logics.handleLogin
    effects:
      onMount:
        body: logics.initForm
        watch: []
    styles:
      backgroundColor: theme.surface
      borderRadius: theme.radiusMd
      padding: 24
    frame: column.start
```

Run `fastui specs build ./src/blueprints` and you get:

- `src/modules/login_form.jsx` (React) or `src/modules/login_form.dart` (Flutter) — fully wired component with state, `component` object, `useEffect`/`initState`, and event handler
- `src/modules/logics/login_form.mjs` / `.dart` — scaffolded stubs for `handleLogin` and `initForm`

### Condition (if/else toggle)

**`src/blueprints/pages/auth_gate.yml`**

```yaml
condition:
  modifier:
    left: ./pages/login_page.yml    # not authenticated
    right: ./pages/home_page.yml    # authenticated
    frame: column.start
```

Logics file auto-created at `src/pages/logics/auth_gate.mjs` with `onStart` stub. Implement it:

```js
export function onStart({ component }) {
    component.states.setCondition(isLoggedIn());
}
```

### List with data loading

**`src/blueprints/modules/product_list.yml`**

```yaml
loop:
  modifier:
    feed: ./modules/product_card.yml
    styles:
      padding: 16
    frame: column.start
```

Logics file auto-created at `src/modules/logics/product_list.mjs` with `onStart` stub. Implement it:

```js
export async function onStart({ component }) {
    const products = await fetchProducts();
    component.states.setData(products);
}
```
