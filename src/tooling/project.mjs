import {execFile} from 'node:child_process';
import {readFile, stat, writeFile} from 'node:fs/promises';
import {basename, dirname, resolve} from 'node:path';
import {promisify} from 'node:util';
import * as yaml from 'js-yaml';
import {ensureFileExist, ensurePathExist} from '../shared/fs.mjs';
import {getBlueprintRoot, normalizeTemplate} from './config.mjs';
import {
    ensureBlueprintFolderExist,
    ensureFlutterStartScript,
    ensureFlutterWatchFileExist,
    ensureSchemaFileExist,
    ensureStartScript,
    ensureWatchFileExist
} from './scaffold.mjs';
import {flutterRuntimeSource} from '../generators/templates/flutter/generator.mjs';

const execFileAsync = promisify(execFile);

async function exists(path) {
    try {
        await stat(path);
        return true;
    } catch (_) {
        return false;
    }
}

async function writeIfMissing(path, content) {
    if (await exists(path)) return;
    await ensurePathExist(dirname(path));
    await writeFile(path, content);
}

async function writeTemplateConfig(template) {
    await writeFile(resolve('fastui.config.json'), JSON.stringify({template, specVersion: 2}, null, 2));
}

async function ensureReactProject() {
    const packagePath = resolve('package.json');
    await ensureFileExist(packagePath);
    let packageMap = {};
    try {
        packageMap = JSON.parse(await readFile(packagePath, 'utf8'));
    } catch (_) {
        packageMap = {};
    }
    await writeFile(packagePath, JSON.stringify({
        name: packageMap.name || basename(process.cwd()).toLowerCase().replace(/[^a-z0-9-_]/g, '-') || 'fastui-app',
        private: packageMap.private ?? true,
        version: packageMap.version || '0.0.0',
        type: packageMap.type || 'module',
        ...packageMap,
        scripts: {
            dev: packageMap.scripts?.dev || 'vite',
            build: packageMap.scripts?.build || 'vite build',
            ...packageMap.scripts
        },
        dependencies: {
            react: '^18.3.1',
            'react-dom': '^18.3.1',
            rxjs: '^7.8.1',
            ...packageMap.dependencies
        },
        devDependencies: {
            '@vitejs/plugin-react': '^4.3.3',
            vite: '^5.4.10',
            ...packageMap.devDependencies
        }
    }, null, 2));
    await writeIfMissing(resolve('index.html'), '<!doctype html>\n<html><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>\n');
    await writeIfMissing(resolve('src', 'AppRoute.jsx'), "export function AppRoute() {\n  return <></>;\n}\n");
    await writeIfMissing(resolve('src', 'App.jsx'), "import {AppRoute} from './AppRoute.jsx';\n\nexport default function App() {\n  return <AppRoute />;\n}\n");
    await writeIfMissing(resolve('src', 'main.jsx'), "import React from 'react';\nimport ReactDOM from 'react-dom/client';\nimport App from './App.jsx';\n\nReactDOM.createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);\n");
    await writeIfMissing(resolve('src', 'fastui.css'), `*, *::before, *::after { box-sizing: border-box; }
html, body, #root { margin: 0; padding: 0; }
#root { /*display: flex;*/}
`);
    const mainPath = resolve('src', 'main.jsx');
    const mainSource = await readFile(mainPath, 'utf8');
    if (!mainSource.includes("./fastui.css")) {
        await writeFile(mainPath, `import './fastui.css';\n${mainSource}`);
    }
    await writeIfMissing(resolve('vite.config.js'), "import {defineConfig} from 'vite';\nimport react from '@vitejs/plugin-react';\n\nexport default defineConfig({plugins: [react()]});\n");
    await writeIfMissing(resolve('src', 'stores', 'observable_store.mjs'), `import {BehaviorSubject} from 'rxjs';

export function createObservableStore(initialState = {}) {
  const subject = new BehaviorSubject(Object.freeze({...initialState}));
  return {
    state$: subject.asObservable(),
    get value() { return subject.value; },
    set(patch) { subject.next(Object.freeze({...subject.value, ...patch})); },
    update(reducer) { subject.next(Object.freeze(reducer(subject.value))); },
    subscribe(observer) { return subject.subscribe(observer); },
    dispose() { subject.complete(); },
  };
}

export const appState = createObservableStore();
`);
    await writeIfMissing(resolve('src', 'stores', 'use_observable.mjs'), `import {useSyncExternalStore} from 'react';

export function useObservable(store, selector = value => value) {
  return useSyncExternalStore(
    listener => {
      const subscription = store.subscribe(listener);
      return () => subscription.unsubscribe();
    },
    () => selector(store.value),
    () => selector(store.value),
  );
}
`);
}

async function ensureFlutterProject(runCommand = execFileAsync) {
    const pubspecPath = resolve('pubspec.yaml');
    let created = false;
    if (!(await exists(pubspecPath))) {
        const projectName = basename(process.cwd()).toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^[^a-z]/, 'fastui_');
        try {
            await runCommand('flutter', ['create', '--project-name', projectName || 'fastui_app', '.'], {cwd: process.cwd()});
            created = true;
        } catch (error) {
            throw new Error(`Unable to initialize Flutter. Install the Flutter SDK and ensure the flutter command is available. ${error?.message ?? ''}`.trim());
        }
    }
    const pubspec = yaml.load(await readFile(pubspecPath, 'utf8')) ?? {};
    const flutter = pubspec.flutter ?? {};
    const assets = Array.from(new Set([...(flutter.assets ?? []), 'assets/images/figma/']));
    await writeFile(pubspecPath, yaml.dump({
        ...pubspec,
        environment: {sdk: '>=3.0.0 <4.0.0', ...pubspec.environment},
        dependencies: {flutter: {sdk: 'flutter'}, flutter_svg: '^2.3.0', ...pubspec.dependencies},
        flutter: {...flutter, 'uses-material-design': flutter['uses-material-design'] ?? true, assets}
    }, {lineWidth: -1}));
    const analysisPath = resolve('analysis_options.yaml');
    let analysis = {};
    try { analysis = yaml.load(await readFile(analysisPath, 'utf8')) ?? {}; } catch (_) {}
    const excluded = new Set([...(analysis.analyzer?.exclude ?? []), 'lib/blueprints/**/logics/**']);
    await writeFile(analysisPath, yaml.dump({
        ...analysis,
        analyzer: {...analysis.analyzer, exclude: [...excluded]},
        linter: {
            ...analysis.linter,
            rules: {
                ...analysis.linter?.rules,
                // These presentation-only rules do not improve generated Figma layout fidelity.
                avoid_unnecessary_containers: false,
                sized_box_for_whitespace: false,
            }
        }
    }, {lineWidth: -1}));
    await ensurePathExist(resolve('assets', 'images', 'figma'));
    await writeIfMissing(resolve('lib', 'fastui_runtime.dart'), flutterRuntimeSource());
    await writeIfMissing(resolve('lib', 'app_route.dart'), "import 'package:flutter/material.dart';\nimport 'fastui_runtime.dart';\n\nclass FastUIAppRoute extends StatelessWidget {\n  const FastUIAppRoute({super.key});\n\n  @override\n  Widget build(BuildContext context) => MaterialApp(\n    theme: FastUIStyleHelper.lightTheme(),\n    darkTheme: FastUIStyleHelper.darkTheme(),\n    themeMode: ThemeMode.system,\n    home: const Scaffold(body: SizedBox.shrink()),\n  );\n}\n");
    await writeIfMissing(resolve('lib', 'stores', 'observable_store.dart'), `import 'package:flutter/widgets.dart';

class ObservableStore extends ChangeNotifier {
  ObservableStore([Map<String, dynamic>? initialState])
      : _state = Map.unmodifiable(initialState ?? const <String, dynamic>{});

  Map<String, dynamic> _state;
  Map<String, dynamic> get value => _state;
  T? select<T>(String key) => _state[key] as T?;

  void set(Map<String, dynamic> patch) {
    _state = Map.unmodifiable(<String, dynamic>{..._state, ...patch});
    notifyListeners();
  }

  void update(Map<String, dynamic> Function(Map<String, dynamic>) reducer) {
    _state = Map.unmodifiable(reducer(_state));
    notifyListeners();
  }
}

class FastUIStateScope extends InheritedNotifier<ObservableStore> {
  const FastUIStateScope({super.key, required ObservableStore store, required super.child})
      : super(notifier: store);

  static ObservableStore watch(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<FastUIStateScope>()!.notifier!;

  static ObservableStore read(BuildContext context) =>
      context.getInheritedWidgetOfExactType<FastUIStateScope>()!.notifier!;
}
`);
    const observableStorePath = resolve('lib', 'stores', 'observable_store.dart');
    try {
        const observableStore = await readFile(observableStorePath, 'utf8');
        if (observableStore.startsWith("import 'package:flutter/foundation.dart';\nimport 'package:flutter/widgets.dart';")) {
            await writeFile(observableStorePath, observableStore.replace("import 'package:flutter/foundation.dart';\n", ''));
        }
    } catch (_) {}
    const observableMain = "import 'package:flutter/material.dart';\nimport 'app_route.dart';\nimport 'stores/observable_store.dart';\n\nfinal appState = ObservableStore();\n\nvoid main() => runApp(FastUIStateScope(store: appState, child: const FastUIAppRoute()));\n";
    const mainPath = resolve('lib', 'main.dart');
    if (created) {
        await writeFile(mainPath, observableMain);
        await ensurePathExist(resolve('test'));
        await writeFile(resolve('test', 'widget_test.dart'), `import 'package:flutter_test/flutter_test.dart';
import 'package:${pubspec.name}/app_route.dart';

void main() {
  testWidgets('FastUI application starts', (tester) async {
    await tester.pumpWidget(const FastUIAppRoute());
    expect(find.byType(FastUIAppRoute), findsOneWidget);
  });
}
`);
    } else {
        try {
            const main = await readFile(mainPath, 'utf8');
            const isGeneratedBootstrap = main.includes("import 'app_route.dart';")
                && main.includes('runApp(const FastUIAppRoute())');
            const isGeneratedObservableBootstrap = main.includes('final appState = ObservableStore()')
                && main.includes('FastUIStateScope(store: appState');
            if ((isGeneratedBootstrap && !main.includes('FastUIStateScope')) || isGeneratedObservableBootstrap) {
                await writeFile(mainPath, observableMain);
            }
        } catch (_) {
            await writeFile(mainPath, observableMain);
        }
    }
}

export async function initializeProject({template, runCommand} = {}) {
    const requested = `${template ?? ''}`.trim().toLowerCase();
    if (requested && !['reactjs', 'flutter'].includes(requested)) {
        throw new Error(`Unsupported FastUI template "${template}". Use reactjs or flutter.`);
    }
    const selected = normalizeTemplate(template);
    if (selected === 'flutter') {
        await ensureFlutterProject(runCommand);
    } else {
        await ensureReactProject();
    }
    const blueprintRoot = getBlueprintRoot(selected);
    await writeTemplateConfig(selected);
    await ensureBlueprintFolderExist(blueprintRoot);
    await ensureWatchFileExist(blueprintRoot);
    await ensureSchemaFileExist();
    if (selected === 'reactjs') await ensureStartScript(selected, blueprintRoot);
    if (selected === 'flutter') {
        await ensureFlutterWatchFileExist(blueprintRoot);
        await ensureFlutterStartScript(blueprintRoot);
    }
    return {template: selected, blueprintRoot};
}
