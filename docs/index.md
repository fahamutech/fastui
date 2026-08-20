# FastUI

**FastUI** is a code-generation CLI that converts YAML spec files into production-ready React or Flutter components. It also drives a Figma-to-spec translator, so designs sketched in Figma can be transformed into typed, runnable source code with a single command.

---

## Contents

| Document | What it covers |
|---|---|
| [Architecture](architecture.md) | Full system diagram and data-flow |
| [Spec Reference](spec-reference.md) | Every primitive, field, type and option |
| [Composition Model](composition.md) | `modifier.extend`, `modifier.frame`, top-down layout |
| [Figma → Spec](figma-to-spec.md) | Translator pipeline and Figma naming conventions |
| [Generators](generators.md) | React/Flutter output, services, stores |
| [CLI Reference](cli.md) | Commands, flags, env vars |

---

## Quick Start

### 1. Install

```bash
npm install -g fastui-tools
```

### 2. Initialise a project

```bash
# React (Vite)
fastui init reactjs

# Flutter
fastui init flutter
```

`init` writes `fastui.config.json`, scaffolds `src/blueprints/` (React) or `lib/blueprints/` (Flutter), creates the target font integration, and drops boilerplate entry files.

### 3. Write a spec

`src/blueprints/modules/home/ihome_Home.yml`

```yaml
component:
  base: container
  modifier:
    styles:
      width: 100%
      height: 100vh
      backgroundColor: '#ffffff'
      display: flex
      flexDirection: column
    extend:
      - ./iheader_Header.yml
      - ./ibody_Body.yml
    frame:
      base: column.start
      current:
        width: 100%
        height: 100vh
```

### 4. Generate code

```bash
fastui specs build src/blueprints
```

Output: `src/modules/home/ihome_Home.jsx`

### 5. Automate from Figma

```bash
# .env
FIGMA_TOKEN=<your personal access token>
FIGMA_FILE=<file key from the Figma URL>
```

```bash
fastui specs automate reactjs --fresh
```

This fetches your Figma file, translates every frame/component to YAML specs, writes the routing file, and then generates source code.

---

## Project file structure

After `fastui init reactjs`:

```
my-app/
├── fastui.config.json          ← template, specVersion, and font sources
├── src/
│   ├── blueprints/             ← YAML spec files (source of truth)
│   │   └── modules/
│   │       └── home/
│   │           └── ihome_Home.yml
│   ├── modules/                ← generated components (do not hand-edit)
│   │   └── home/
│   │       └── ihome_Home.jsx
│   ├── services/               ← user-owned logic stubs
│   │   └── home/
│   │       └── ihome_Home.mjs
│   ├── stores/                 ← generated component stores (per module)
│   │   └── home/
│   │       ├── stores.generated.mjs
│   │       └── models.generated.mjs
│   ├── AppRoute.jsx
│   ├── App.jsx
│   └── main.jsx
└── public/
    ├── images/figma/           ← downloaded Figma image/vector assets
    └── fonts/figma/            ← resolved fonts + generated CSS
```

After `fastui init flutter`:

```
my-app/
├── fastui.config.json
├── lib/
│   ├── blueprints/modules/     ← YAML spec files
│   ├── modules/                ← generated Dart widgets
│   ├── services/               ← user-owned logic stubs
│   ├── stores/                 ← generated state stores
│   └── fastui_runtime.dart     ← navigation + surface runtime
└── assets/
    ├── images/figma/           ← downloaded Figma image/vector assets
    └── fonts/figma/            ← fonts registered in pubspec.yaml
```

---

## Core concepts

### Primitives

Every spec file declares **exactly one root key** selecting its primitive:

| Key | What it renders |
|---|---|
| `component` | A UI node — container, text, or image |
| `condition` | A two-branch toggle driven by `states.condition` |
| `loop` | A repeating list driven by `states.data` |
| `surface` | Navigation surface metadata (page/overlay/sheet/dialog) |

### Base types

The `base` field on `component` selects the renderer:

| Value | Description |
|---|---|
| `container` | Generic box. Default for frames, groups, buttons. |
| `text` | Text node. Requires `props.children`. |
| `image` | Image node. Requires `props.src`. |
| `./path/to/spec.yml` | Inherits another spec's shape and overrides it. |

### Top-down composition

A composer sets `modifier.extend` to an ordered list of child spec paths.  
`modifier.frame.base` controls the layout axis and direction.  
The generator renders the parent's own content alongside each extended child, in listed order.

See [Composition Model](composition.md) for the full reference.
