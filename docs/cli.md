# CLI Reference

```
fastui <command> [subcommand] [options]
```

---

## Commands

### `fastui init <reactjs|flutter>`

Initialise a new FastUI project in the current directory. **The framework is required.**

```bash
fastui init reactjs
fastui init flutter
fastui init --template reactjs
```

Running `fastui init` without a framework name prints an error and exits.

**What it does:**

- Creates `fastui.config.json` with `{ template, specVersion: 2 }`.
- Scaffolds `src/blueprints/modules/` (React) or `lib/blueprints/modules/` (Flutter).
- Links `fastui.schema.json` so editors show YAML validation and autocompletion.
- Writes entry files (`App.jsx`, `main.jsx`, `AppRoute.jsx` for React; `main.dart` scaffold for Flutter).
- Writes `src/fastui.css` baseline reset (React only).
- Runs `npm install` (React) or `flutter pub get` (Flutter) if dependencies are missing.

**Framework selection:**

Use the positional argument or the `--template` flag. One of them is mandatory:

```bash
fastui init reactjs              # positional form
fastui init --template flutter   # flag form
```

---

### `fastui specs list [path]`

List all YAML spec files under a path.

```bash
fastui specs list
fastui specs list src/blueprints/modules/home
fastui specs list src/blueprints/modules/home/ihome_Home.yml
```

- Without `[path]`, uses the blueprint root from config (`src/blueprints` or `lib/blueprints`).
- When `[path]` is a `.yml` file, globs for all variants of that spec name.
- Output is an array of matched file paths, one per line.

---

### `fastui specs build [path]`

Generate source code from YAML specs.

```bash
fastui specs build
fastui specs build src/blueprints
fastui specs build src/blueprints/modules/home
```

**What it does (in order):**

1. **Sync Figma assets** — copies `.fastui/assets/figma/` to `public/images/figma/` or `assets/images/figma/`.
2. **Remove duplicate legacy state** — deletes old `src/state/` files if identical to `src/stores/`.
3. **Write Flutter runtime** — generates `lib/fastui_runtime.dart` (Flutter only).
4. **Migrate legacy services** — copies old `blueprints/modules/*/logics/` files to `services/` if not already there.
5. **Generate each spec** — for every `.yml` file found under `[path]`:
   - Reads and resolves the spec.
   - Normalizes to the current composition shape.
   - Writes the output `.jsx` / `.dart` file.
   - Creates/updates the service stub.
6. **Write module stores** — generates `store.mjs`/`store.dart` and `models.generated.*` for every stateful module.
7. **Update manifest** — writes `.fastui/generated-manifest.json` and deletes stale generated files.

---

### `fastui specs automate [template] [--fresh]`

Full Figma → specs → code pipeline.

```bash
fastui specs automate reactjs
fastui specs automate flutter --fresh
```

**Steps:**

1. Ensures blueprint folder exists.
2. Loads `.env` from the project root.
3. Reads `FIGMA_TOKEN` and `FIGMA_FILE` from environment.
4. Fetches the Figma document (cached unless `--fresh`).
5. Translates all frames/components to YAML specs.
6. Writes routing file (`AppRoute.jsx` or `app_route.dart`).

**Required environment variables:**

| Variable | Description |
|---|---|
| `FIGMA_TOKEN` | Figma personal access token. Generate at figma.com → Account → Personal access tokens. |
| `FIGMA_FILE` | Figma file key. Visible in the URL: `figma.com/design/<FILE_KEY>/…` |

`.env` file example:

```env
FIGMA_TOKEN=figd_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
FIGMA_FILE=AbCdEfGhIjKlMnOpQrStUv
```

**`--fresh` flag:**

Without `--fresh`, the translator uses the cached Figma document from `.fastui/figma-cache.json`.  
With `--fresh`, it re-downloads the document and re-downloads all image fills and vector assets.

---

### `fastui watch [template]`

Create or update the file-watcher helper.

```bash
fastui watch
fastui watch flutter
```

Writes a `watch.mjs` (React) or `watch.dart` (Flutter) file that watches the blueprint folder for changes and reruns `specs build` automatically.

---

## Global flags

| Flag | Short | Description |
|---|---|---|
| `--version` | `-v` | Print version string and exit |
| `--help` | `-h` | Show help message and exit |
| `--fresh` | | (automate) Force re-download of Figma document and assets |
| `--template <name>` | | Explicitly select `reactjs` or `flutter` |

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `FIGMA_TOKEN` | — | Figma REST API personal access token |
| `FIGMA_FILE` | — | Figma file key |
| `FASTUI_TEMPLATE` | `reactjs` | Template selection (`reactjs` or `flutter`) |
| `TEMPLATE` | — | Alias for `FASTUI_TEMPLATE` (lower priority) |

---

## Config file — `fastui.config.json`

Written by `fastui init`. Read by every command to determine template.

```json
{
  "template": "reactjs",
  "specVersion": 2
}
```

| Field | Values | Description |
|---|---|---|
| `template` | `reactjs` \| `flutter` | Target platform |
| `specVersion` | `2` | Spec format version (always 2 for new projects) |

---

## Blueprint root

| Template | Blueprint root |
|---|---|
| `reactjs` | `src/blueprints/` |
| `flutter` | `lib/blueprints/` |

All `specs build` and `specs list` commands default to this path when no `[path]` argument is given.

---

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | Error (unknown command, missing env var, spec parse failure, etc.) |
