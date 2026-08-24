/**
 * Project scaffolding side effects that aren't spec translation or code
 * generation: creating the blueprint folder, the file-watcher script, the
 * IDE-facing JSON schema, and the `npm start` wiring for a React project.
 */
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile, writeFile} from 'node:fs/promises';
import os from 'os';
import {ensureFileExist, ensurePathExist} from '../shared/fs.mjs';

// fastui.schema.json ships alongside package.json at the package root; read
// it from there instead of keeping a second, driftable copy inline.
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Copies the packaged FastUI JSON schema into the target project so editors
 * can offer autocomplete/validation for blueprint YAML files.
 */
export async function ensureSchemaFileExist() {
    const filePath = resolve(join('fastui.schema.json'));
    await ensureFileExist(filePath);
    const schema = await readFile(resolve(packageRoot, 'fastui.schema.json'), 'utf8');
    await writeFile(filePath, schema);
}

export async function ensureWatchFileExist(blueprintRoot = join('src', 'blueprints')) {
    const filePath = resolve(join('watch.mjs'));
    await ensureFileExist(filePath);
    await writeFile(filePath, `import {watch} from 'node:fs'
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const blueprintRoot = ${JSON.stringify(blueprintRoot.split('\\').join('/'))};

const debounceMs = 500;
let timeout;
let buildRunning = false;
let buildQueued = false;

function buildBlueprints() {
    if (buildRunning) {
        buildQueued = true;
        return;
    }

    buildRunning = true;
    const child = spawn('fastui', ['specs', 'build', \`./\${blueprintRoot}\`], {
        cwd: __dirname,
        stdio: 'inherit'
    });
    child.on('error', error => console.error('[fastui] Specs build failed to start:', error.message));
    child.on('close', () => {
        buildRunning = false;
        if (buildQueued) {
            buildQueued = false;
            buildBlueprints();
        }
    });
}

function scheduleBuild() {
    clearTimeout(timeout);
    timeout = setTimeout(buildBlueprints, debounceMs);
}

watch(join(__dirname, ...blueprintRoot.split('/')), {recursive: true}, (event, filename) => {
    const name = \`\${filename ?? ''}\`;
    if (!/\\.ya?ml$/i.test(name) || name.endsWith('~')) {
        return;
    }
    scheduleBuild();
});
`);
}

export async function ensureFlutterWatchFileExist(blueprintRoot = join('lib', 'blueprints')) {
    const filePath = resolve(join('watch.dart'));
    await ensureFileExist(filePath);
    await writeFile(filePath, `import 'dart:async';
import 'dart:io';

void main() async {
  final blueprintRoot = '${blueprintRoot.split('\\').join('/')}';
  final dir = Directory(blueprintRoot);
  print('[fastui] Watching \$blueprintRoot for changes...');
  Timer? debounce;
  final watcher = dir.watch(recursive: true);
  await for (final event in watcher) {
    if (!event.path.endsWith('.yml') || event.path.endsWith('~')) continue;
    debounce?.cancel();
    debounce = Timer(const Duration(milliseconds: 300), () async {
      print('[fastui] Detected change: \${event.path}');
      final result = await Process.run(
        'fastui',
        ['specs', 'build', event.path],
        runInShell: true,
      );
      if (result.stdout.toString().isNotEmpty) print(result.stdout);
      if (result.stderr.toString().isNotEmpty) stderr.write(result.stderr);
      final flutterPid = int.tryParse(Platform.environment['FASTUI_FLUTTER_PID'] ?? '');
      if (result.exitCode == 0 && flutterPid != null) {
        final sent = Process.killPid(flutterPid, ProcessSignal.sigusr1);
        print(sent
            ? '[fastui] Hot reload requested.'
            : '[fastui] Unable to request hot reload; restart fastui_dev.sh.');
      }
    });
  }
}
`);
}

export async function ensureFlutterStartScript(blueprintRoot = join('lib', 'blueprints')) {
    const filePath = resolve(join('fastui_dev.sh'));
    await ensureFileExist(filePath);
    await writeFile(filePath, `#!/usr/bin/env bash
# FastUI dev script — starts the Flutter app and the blueprint watcher in parallel.
# Usage: bash fastui_dev.sh [flutter run args...]
set -e

echo "[fastui] Building specs..."
fastui specs build ./${blueprintRoot.split('\\').join('/')}

echo "[fastui] Starting watcher..."
mkdir -p .fastui
WATCHER_PID_FILE=".fastui/watch.pid"
if [ -f "$WATCHER_PID_FILE" ]; then
  PREVIOUS_WATCHER_PID="$(cat "$WATCHER_PID_FILE")"
  if [ -n "$PREVIOUS_WATCHER_PID" ] && kill -0 "$PREVIOUS_WATCHER_PID" 2>/dev/null; then
    echo "[fastui] Stopping previous watcher ($PREVIOUS_WATCHER_PID)..."
    kill "$PREVIOUS_WATCHER_PID" 2>/dev/null || true
  fi
fi

cleanup() {
  if [ -n "$WATCHER_PID" ]; then
    kill "$WATCHER_PID" 2>/dev/null || true
    wait "$WATCHER_PID" 2>/dev/null || true
  fi
  if [ -f "$WATCHER_PID_FILE" ] && [ "$(cat "$WATCHER_PID_FILE")" = "$WATCHER_PID" ]; then
    rm -f "$WATCHER_PID_FILE"
  fi
  if [ -n "$FLUTTER_PID" ]; then
    kill "$FLUTTER_PID" 2>/dev/null || true
    wait "$FLUTTER_PID" 2>/dev/null || true
  fi
  WATCHER_PID=""
  FLUTTER_PID=""
}
trap cleanup EXIT
trap 'cleanup; exit 130' INT TERM

echo "[fastui] Starting Flutter local dev server..."
flutter run -d web-server --web-hostname localhost "$@" &
FLUTTER_PID=$!
export FASTUI_FLUTTER_PID="$FLUTTER_PID"

dart watch.dart &
WATCHER_PID=$!
echo "$WATCHER_PID" > "$WATCHER_PID_FILE"

wait "$FLUTTER_PID"
`);
    try {
        const {chmod} = await import('node:fs/promises');
        await chmod(filePath, 0o755);
    } catch { /* non-fatal — user can chmod manually */ }
}

export async function ensureBlueprintFolderExist(blueprintRoot = join('src', 'blueprints')) {
    const filePath = resolve(blueprintRoot);
    await ensurePathExist(filePath);
}

export async function ensureStartScript(template = 'reactjs', blueprintRoot = join('src', 'blueprints')) {
    if (template !== 'reactjs') return;
    const isWin = os.platform() === 'win32';
    const joiner = isWin ? '|' : '&';
    const filePath = resolve(join('package.json'));
    await ensureFileExist(filePath);
    const file = await readFile(filePath, {encoding: 'utf-8'});
    const fileMap = JSON.parse(`${file}`.trim().startsWith('{') ? file : '"{}"');
    const {scripts = {}} = fileMap;
    const {start, dev = 'vite'} = scripts;
    const current = start || dev;
    const startParts = `${current}`.split(joiner).map(value => value.trim());
    const lastScript = startParts.find(value => !value.includes('watch.mjs') && !value.includes('fastui specs build')) || dev;
    await writeFile(filePath, JSON.stringify({
        ...fileMap,
        scripts: {
            ...scripts,
            start: `node ./watch.mjs ${joiner} fastui specs build ./${blueprintRoot.split('\\').join('/')} ${joiner} ${lastScript}`
        }
    }, null, 2));
}
