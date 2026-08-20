# Architecture

FastUI is a **three-layer pipeline**:

```
Figma Design File
      │
      ▼  (fastui specs automate)
┌─────────────────────────────────────────────────────────────────┐
│  TRANSLATOR  src/translators/figma/                             │
│                                                                 │
│  figma-to-spec.mjs   ← public entry point                      │
│  ├── client.mjs        fetch Figma REST API                     │
│  ├── tree.mjs          walk document → annotate nodes           │
│  ├── spec-writer.mjs   serialize annotated node → YAML spec     │
│  ├── naming.mjs        node-name ↔ identifier helpers           │
│  ├── layout.mjs        Figma layout props → CSS/styles          │
│  ├── color.mjs         Figma paint → CSS color string           │
│  ├── effects.mjs       Figma effects → CSS filter/shadow        │
│  ├── route.mjs         Figma interactions → navigation actions  │
│  ├── assets.mjs        download/cache Figma image fills         │
│  └── shared-components.mjs  collect MAIN COMPONENT definitions  │
└────────────────────────┬────────────────────────────────────────┘
                         │  writes .yml files
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  SPEC FILES  src/blueprints/  (or lib/blueprints/)              │
│                                                                 │
│  One .yml file per Figma node. Human-readable, hand-editable.   │
│  Validated by fastui.schema.json.                               │
└────────────────────────┬────────────────────────────────────────┘
                         │  (fastui specs build)
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  GENERATOR  src/generators/                                     │
│                                                                 │
│  spec-to-code.mjs    ← public entry point                       │
│  ├── specs/reader.mjs     read + resolve base inheritance       │
│  ├── spec-normalizer.mjs  normalize extend/frame shapes         │
│  ├── modifier.mjs         typed accessors over modifier fields  │
│  ├── component.mjs        dispatch to template generator        │
│  ├── condition.mjs        dispatch condition generator          │
│  ├── loop.mjs             dispatch loop generator               │
│  ├── project-structure.mjs  derive file paths + service stubs   │
│  ├── routing.mjs           write AppRoute / app_route.dart      │
│  ├── behavior.mjs          map spec actions → code              │
│  └── templates/                                                 │
│      ├── reactjs/          React JSX + hooks                    │
│      │   └── generator.mjs                                      │
│      └── flutter/          Dart StatelessWidget/StatefulWidget  │
│          └── generator.mjs                                      │
└────────────────────────┬────────────────────────────────────────┘
                         │  writes .jsx / .dart files
                         ▼
       Generated source  (src/modules/ or lib/modules/)
```

---

## Data flow: spec → generated file

```
specPath (.yml)
    │
    ▼  specs/reader.mjs → specToJSON()
Resolved document (JS object)
    │  base: path?  ── resolves & deep-merges the referenced spec
    │
    ▼  spec-normalizer.mjs → normalizeSpecDocument()
Normalized document
    │  extend  → always string[]
    │  frame   → always {base, id, current, next}
    │  removes compose / ref / wrapper
    │
    ▼  spec-normalizer.mjs → prepareBehavior()
Behaviour-augmented document
    │  implicit state keys added for every state.set target
    │  condition default: false
    │  loop default data: []
    │
    ▼  component.mjs / condition.mjs / loop.mjs
    │    → templates/reactjs/generator.mjs  OR
    │    → templates/flutter/generator.mjs
    │
    ▼  writes generated output file
    │
    ▼  project-structure.mjs → ensureServiceFile()
       writes/updates services stub (user-owned)
```

---

## Key modules

### `src/specs/reader.mjs`

| Export | Purpose |
|---|---|
| `readSpecs(root)` | Globs all `.yml`/`.yaml` under root, returns path array |
| `specToJSON(path)` | Loads YAML, resolves `base: ./path.yml` inheritance recursively, deep-merges modifier overrides, rebases all composition paths to the final file's directory |

**Inheritance chain:**  
If `component.base` is a `.yml` path, `reader.mjs` loads that file first, then deep-merges the local `modifier` on top. Circular chains throw. `modifier.extend`, `modifier.left`, `modifier.right`, and `modifier.feed` paths are rebased relative to the consuming spec so callers never need to know where the parent came from.

---

### `src/generators/spec-normalizer.mjs`

Normalizes any spec document into the single shape the generators expect.

| Export | Purpose |
|---|---|
| `normalizeSpecDocument(doc)` | Returns `{kind, data}` for the current `component`, `condition`, or `loop` roots |
| `normalizeComposition(data)` | Normalizes `extend` → `string[]` and `frame` → `{base,id,current,next}` |
| `prepareBehavior(kind, data)` | Adds implicit state keys for `state.set` targets; adds `condition:false` and `data:[]` defaults |

---

### `src/generators/modifier.mjs`

Typed read-only accessors over a spec document's `modifier` field. Generators use these instead of direct property access so the spec shape has one definition.

| Accessor | Returns |
|---|---|
| `getChildren(data)` | `{type: 'raw'|'state'|'input'|'component', value}` |
| `getStyles(data)` | CSS object or logic reference string |
| `getProps(data)` | props object (without `children`) |
| `getStates(data)` | states map |
| `getEffects(data)` | effects map |
| `getFrame(data)` | `{base, id, current, next}` |
| `getExtendList(data)` | `string[]` — ordered extend paths |
| `getLeft(data)` | condition left path |
| `getRight(data)` | condition right path |
| `getFeed(data)` | loop feed path |

---

### `src/generators/project-structure.mjs`

Derives all output file paths from a spec path.

| Export | Purpose |
|---|---|
| `specStructure(specPath, template)` | Returns `{projectSourceRoot, moduleName, componentName, servicePath, storePath, storeModelsPath}` |
| `identifier(value)` | Sanitizes a string to a valid JS/Dart identifier |
| `pascalIdentifier(value)` | PascalCase identifier from a hyphenated/underscored string |
| `ensureServiceFile({…})` | Creates the service stub file; appends missing function skeletons without touching existing implementations |
| `relativeImport(from, to)` | Relative import path string between two absolute file paths |

**Path derivation rules:**

```
specPath:  /project/src/blueprints/modules/home/ihome_Home.yml
                                   ┌ moduleSegments = ['home']
                                   │ componentName  = 'Home'
service:   /project/src/services/home/ihome_Home.mjs
store:     /project/src/stores/home/stores.generated.mjs
models:    /project/src/stores/home/models.generated.mjs
output:    /project/src/modules/home/ihome_Home.jsx
```

---

### `src/generators/spec-to-code.mjs`

| Export | Purpose |
|---|---|
| `generateSpecFile({specPath, projectPath})` | Generates one spec → one output file |
| `generateCodeFromSpecs({root, projectPath})` | Globs all specs, generates all, writes stores, syncs Figma assets, updates manifest |

The manifest `.fastui/generated-manifest.json` tracks every generated file path. On the next build, files in the manifest that no longer correspond to a spec are deleted automatically (stale cleanup).

---

### `src/tooling/`

| File | Purpose |
|---|---|
| `config.mjs` | Reads `fastui.config.json` + env vars; exposes `getTemplateSelected()`, `getBlueprintRoot()` |
| `env.mjs` | Loads `.env` file into `process.env` |
| `project.mjs` | `initializeProject()` — scaffolds a React or Flutter project from scratch |
| `scaffold.mjs` | Creates blueprint folder, schema link, watch file, start script |

---

## State management

FastUI generates public component stores grouped into one generated file per module.

### React (`src/stores/<module>/stores.generated.mjs`)

```js
profileNameStore.get(instanceId)
profileNameStore.subscribe(instanceId, listener)
profileNameStore.setName(instanceId, value)
profileNameStore.setField(instanceId, key, value)
profileNameStore.update(instanceId, reducer)
```

The stores use RxJS internally. Generated components subscribe through selector-based `useSyncExternalStore` hooks, so unrelated state-field changes do not rerender them. IDs derive deterministically from the spec path and composition location; equal explicit IDs intentionally share state.

### Flutter (`lib/stores/<module>/providers.generated.dart`)

```dart
NotifierProvider.autoDispose.family<Notifier, State, FastUIProviderInstance<State>>
```

Each generated component instance watches an immutable Riverpod state model. Generated notifiers expose typed setters plus `setField`, and service contexts mutate that same provider. Stable instance IDs isolate siblings while allowing explicit sharing.
