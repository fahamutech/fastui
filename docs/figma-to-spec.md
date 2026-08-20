# Figma → Spec Translation

The command `fastui specs automate` fetches a Figma file and translates every frame and component into a YAML spec file. This document describes the complete pipeline, the naming conventions designers must follow, and the mapping from Figma concepts to spec primitives.

---

## Pipeline overview

```
fastui specs automate reactjs --fresh
         │
         ├─ 1. fetchFigmaFile()          client.mjs
         │       Figma REST API → raw JSON document
         │       Cached at .fastui/figma-cache.json unless --fresh
         │
         ├─ 2. translateFigmaToSpecs()   figma-to-spec.mjs
         │       ├─ discover + reconcile resources   resources.mjs
         │       │       images, vectors, used font variants → verified cache + target config
         │       ├─ collectSharedComponents()   shared-components.mjs
         │       │       Build map: componentId → {name, path}
         │       │
         │       ├─ getPagesAndTraverseChildren()  tree.mjs
         │       │       For every top-level FRAME (page):
         │       │         annotate with mainFrame / childFrame / surfacePresentation
         │       │         recurse into children
         │       │       For every shared COMPONENT definition:
         │       │         annotate with mainFrame
         │       │         recurse into children
         │       │
         │       └─ walkFrameChildren()   tree.mjs
         │               For every annotated node:
         │                 determine spec primitive (TEXT/RECTANGLE/VECTOR/FRAME/INSTANCE/…)
         │                 write .yml file via spec-writer.mjs
         │
         └─ 3. ensureAppRouteFileExist()   routing.mjs
                 Write AppRoute.jsx / app_route.dart
```

---

## Naming conventions

### Layer naming rules

Figma layer names control how FastUI classifies and names nodes.

**General format:**  `<descriptive name>_<role>`

| Suffix | Role triggered | Spec primitive |
|---|---|---|
| `_condition` | Conditional toggle | `condition` |
| `_loop` or `_repeat` | Repeating list | `loop` |
| `_button` | Clickable container | `component` (with `cursor: pointer`) |
| `_input` | Text input | `component` (with `control: input`) |
| `_image` | Image fill | `component` (with `base: image`) |
| *(none)* | Container / text / vector | `component` (base inferred from Figma type) |

### Text localization and state

Ordinary Figma `TEXT` layers are emitted as translation bindings in the generated `default` catalog. To make text service-controlled, end the layer name with `_$<stateKey>` while leaving the visible characters as the initial value:

```
Layer: ProfileName_$name
Visible text: Joshua
→ props.children: states.name
→ states.name: Joshua
```

The short form `$name` is also accepted. State keys must be Dart-safe identifiers. The marker is removed from generated filenames and IDs. Loop-element text remains bound to loop data and takes precedence over this marker.

**Examples:**

```
ProductCard_button      → component, cursor: pointer
EmailField_input        → component, control: input
UserAvatar_image        → component, base: image
ItemList_loop           → loop
AuthGate_condition      → condition
```

### Module grouping with `[module/path]`

Page and frame names can carry a `[module/path]` suffix in square brackets.  
This controls which folder the generated spec files are placed in.

```
Home[presentation/pages]     → src/blueprints/modules/presentation/pages/
Settings[features/settings]  → src/blueprints/modules/features/settings/
```

Without the suffix, the translator defaults to `presentation/pages`.

### Shared components

Figma **MAIN COMPONENT** definitions (not instances) are collected into `shared/common/`:

```
src/blueprints/shared/common/iprimary_button.yml
src/blueprints/shared/common/icard_ProductCard.yml
```

Every **INSTANCE** of a MAIN COMPONENT gets a spec whose `base` points to the shared path:

```yaml
component:
  base: ../../shared/common/iprimary_button.yml
  modifier:
    styles: { … }   # instance-specific overrides
```

---

## Node type mapping

| Figma type | Figma name suffix | Generated spec |
|---|---|---|
| `TEXT` | ordinary | `component: { base: text }` with a translation binding |
| `TEXT` | `_$<stateKey>` | `component: { base: text }` bound to component-local state |
| `RECTANGLE` | `_input` | `component: { base: container, props: { control: input } }` |
| `RECTANGLE` | `_image` | `component: { base: image }` |
| `RECTANGLE` | (other) | `component: { base: container }` with background image fill |
| `VECTOR` | (any) | `component: { base: image }` rendered as SVG |
| `FRAME` / `COMPONENT` | `_loop` / `_repeat` | `loop` |
| `FRAME` / `COMPONENT` | `_condition` | `condition` |
| `FRAME` / `COMPONENT` | `_button` | `component: { base: container }` with `cursor: pointer` |
| `FRAME` / `COMPONENT` | (other) | `component: { base: container }` with children in `extend` |
| `INSTANCE` | (any) | `component: { base: <shared-component-path> }` |

---

## Layout translation

### `mainFrame` (frame nodes)

Each `FRAME`, `COMPONENT`, or `INSTANCE` node gets a `mainFrame` annotation describing its own internal layout — the axis, alignment, and padding of its children.

| Figma property | Spec output |
|---|---|
| `layoutMode: VERTICAL` | `frame.base: column.start` |
| `layoutMode: HORIZONTAL` | `frame.base: row.start` |
| `primaryAxisAlignItems` | `frame.current.justifyContent` |
| `counterAxisAlignItems` | `frame.current.alignItems` |
| `paddingLeft/Right/Top/Bottom` | `frame.current.padding*` |
| `itemSpacing` | `frame.current.spaceValue` → converted to `gap` |
| `clipsContent: true` | `frame.current.overflow: hidden` |
| `layoutSizingHorizontal: FILL` | `frame.current.flex: 1` (on parent's horizontal axis) |
| `layoutSizingVertical: FILL` | `frame.current.flex: 1` (on parent's vertical axis) |

**Page-level frames** always use `.stack` base (`column.start.stack` or `row.start.stack`) and get explicit `width: 100vw` and `height: 100vh`.

### `childFrame` (leaf nodes)

Leaf nodes (TEXT, RECTANGLE, VECTOR) get a `childFrame` annotation that describes how the sibling axis wraps them in the parent's layout.

| Figma property | Spec output |
|---|---|
| `layoutWrap: WRAP` | `flexWrap: wrap` |
| `layoutSizingHorizontal/Vertical: FILL` | `flex: 1` in parent's main axis |

### Size calculation

| Figma sizing | Generated CSS |
|---|---|
| `FIXED` | explicit `width`/`height` in px |
| `HUG` | no explicit size (container hugs content) |
| `FILL` (on parent's axis) | `flex: 1` |
| `FILL` (cross-axis, vertical parent) | `width: 100%` |
| `FILL` (cross-axis, horizontal parent) | `height: 100%` |

---

## Surface classification

Top-level Figma FRAMEs are classified as navigation surfaces based on Figma's prototype overlay settings.

| Figma overlay setting | `surface.mode` |
|---|---|
| Not an overlay (regular page) | `page` |
| Overlay, any position | `overlay` |

`overlayPositionType` maps to placement:

| Figma value | Placement |
|---|---|
| `CENTER` | `center` |
| `TOP_LEFT` | `topStart` |
| `TOP_CENTER` | `topCenter` |
| `TOP_RIGHT` | `topEnd` |
| `BOTTOM_LEFT` | `bottomStart` |
| `BOTTOM_CENTER` | `bottomCenter` |
| `BOTTOM_RIGHT` | `bottomEnd` |
| `MANUAL` | `stretch` |

---

## Interactions → actions

Figma prototype interactions on nodes are translated to `props.onClick` actions.

| Figma interaction | Generated action |
|---|---|
| Navigate to frame (PUSH) | `{ action: navigation.open, name: '<route>', type: push }` |
| Navigate to frame (OVERLAY) | `{ action: navigation.open, name: '<route>', type: overlay }` |
| Close overlay | `{ action: navigation.close }` |
| Go back | `{ action: navigation.back }` |

The route `name` is derived from the **target frame's layer name** (stripped of the module suffix).

---

## File generation

### Generated file paths

```
Figma page:         "Home[presentation/pages]"
↓
Spec file:          src/blueprints/modules/presentation/pages/iHome.yml
  children:         src/blueprints/modules/presentation/pages/i1_23_Header.yml
                    src/blueprints/modules/presentation/pages/i1_24_Body.yml

Shared component:   "PrimaryButton" (MAIN COMPONENT)
↓
Spec file:          src/blueprints/shared/common/iprimary_button.yml
```

### Spec file naming

All generated spec filenames follow: `i<figma_id>_<SanitizedName>.yml`

- `i` prefix: marks it as a generated spec (not hand-authored)
- `<figma_id>`: Figma node ID with `:` replaced by `_`
- `<SanitizedName>`: first letter uppercase, rest lowercase, all non-alphanumeric → `_`

**Example:**

```
Figma node: id="1:23", name="Product Card_button"
→ i1_23_Product_card_button.yml
```

### Asset downloading

Every automation run inventories image fills, vector nodes, and the font variants used by text. Missing or corrupt resources are repaired; `--fresh` revalidates the full inventory. A failed refresh retains the last verified cached file.

Resources and ownership metadata are stored under:

```
.fastui/assets/figma/images/
.fastui/assets/figma/vectors/
.fastui/assets/figma/fonts/
.fastui/assets/figma/manifest.json
.fastui/reports/figma-resources.json
```

Images and vectors are copied to `public/images/figma/` for React or `assets/images/figma/` for Flutter. Downloads are atomic, MIME-checked, SHA-256 tracked, retried for transient Figma/server failures, and limited to four concurrent transfers. Unresolved resources produce warnings and retain deterministic `asset://figma/...` spec references.

### Font sources and target registration

Figma supplies font family/style usage but not font binaries. Declare licensed sources explicitly in `fastui.config.json`:

```json
{
  "resources": {
    "fonts": {
      "Inter": {"source": "google"},
      "Brand Sans": {
        "files": [
          {"path": "design/fonts/BrandSans-Regular.ttf", "weight": 400, "style": "normal"},
          {"url": "https://assets.example.com/BrandSans-Bold.woff2", "weight": 700, "style": "normal", "sha256": "optional"}
        ]
      }
    }
  }
}
```

Google sources use the official Web Fonts API and require `GOOGLE_FONTS_API_KEY`. FastUI resolves only exact used weight/style variants, unless a configured file declares a `weightRange`. Missing variants keep the original `fontFamily` in generated code so platform fallback still works.

Flutter fonts are copied to `assets/fonts/figma/` and merged under `flutter.fonts` in `pubspec.yaml`; normal variants omit `style`, while italics use `style: italic`. User-authored families and variants are preserved. React fonts are copied to `public/fonts/figma/`, emitted as `fastui-fonts.generated.css`, and loaded by one marked `index.html` link. Projects without a usable HTML integration point receive one generated CSS import in their detected entry module.

---

## Source files

| File | Responsibility |
|---|---|
| `src/translators/figma-to-spec.mjs` | Public entry: orchestrates client + tree + route writer |
| `src/translators/figma/client.mjs` | Figma REST API fetch with caching |
| `src/translators/figma/tree.mjs` | Document walker, node annotator |
| `src/translators/figma/spec-writer.mjs` | YAML serializer for each node type |
| `src/translators/figma/naming.mjs` | `generatedNodeName`, `getBaseType`, `stripModuleSuffix`, `moduleFromName` |
| `src/translators/figma/layout.mjs` | Layout property → CSS style helpers |
| `src/translators/figma/color.mjs` | Figma paint fills → CSS color string |
| `src/translators/figma/effects.mjs` | Drop shadow, blur → CSS filter/boxShadow |
| `src/translators/figma/route.mjs` | Prototype interactions → navigation actions |
| `src/translators/figma/shared-components.mjs` | MAIN COMPONENT catalog and path resolution |
| `src/translators/figma/resources.mjs` | Resource discovery, verified reconciliation, manifests, fonts, and target configuration |
| `src/translators/figma/assets.mjs` | Deterministic cached asset path resolution while specs are written |
| `src/shared/routing.mjs` | Surface name → route type classification |
