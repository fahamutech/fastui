import {composeComponent} from './component.mjs';
import {composeCondition} from './condition.mjs';
import {composeLoop} from './loop.mjs';
import {readSpecs, specToJSON} from '../specs/reader.mjs';
import {normalizeSpecDocument, prepareBehavior} from './legacy-spec.mjs';
import {copyFile, cp, mkdir, readFile, readdir, rm, stat, writeFile} from 'node:fs/promises';
import {basename, dirname, resolve, sep} from 'node:path';
import {getBlueprintRoot, getTemplateSelected} from '../tooling/config.mjs';
import {getStates, parseLogicReference} from './modifier.mjs';
import {identifier, pascalIdentifier, relativeImport, specStructure} from './project-structure.mjs';
import {flutterRuntimeSource} from './templates/flutter/generator.mjs';

async function syncTranslatedAssets(projectPath) {
    const source = resolve(projectPath, '.fastui', 'assets', 'figma');
    try {
        await stat(source);
    } catch (_) {
        return;
    }
    const target = getTemplateSelected() === 'flutter'
        ? resolve(projectPath, 'assets', 'images', 'figma')
        : resolve(projectPath, 'public', 'images', 'figma');
    await mkdir(target, {recursive: true});
    await cp(source, target, {recursive: true, force: false, errorOnExist: false});
}

async function writeIfMissing(path, content) {
    try {
        await stat(path);
        return;
    } catch (_) {
    }
    await mkdir(dirname(path), {recursive: true});
    await writeFile(path, content);
}

async function ensureReactSupportFiles(projectPath) {
    await writeIfMissing(resolve(projectPath, 'src', 'stores', 'observable_store.mjs'), `import {BehaviorSubject} from 'rxjs';

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
    await writeIfMissing(resolve(projectPath, 'src', 'stores', 'use_observable.mjs'), `import {useSyncExternalStore} from 'react';

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

function humanizeTranslationKey(key) {
    return `${key ?? ''}`
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, char => char.toUpperCase());
}

function parseTranslationArgs(argsSource = '') {
    const values = [];
    let index = 0;
    while (index < `${argsSource}`.length && values.length < 2) {
        const quote = `${argsSource}`[index];
        if (quote !== "'" && quote !== '"') {
            index += 1;
            continue;
        }
        let current = '';
        index += 1;
        while (index < `${argsSource}`.length) {
            const char = `${argsSource}`[index];
            if (char === '\\') {
                const next = `${argsSource}`[index + 1];
                if (next !== undefined) {
                    current += next === 'n' ? '\n' : next === 't' ? '\t' : next;
                    index += 2;
                    continue;
                }
            }
            if (char === quote) {
                index += 1;
                break;
            }
            current += char;
            index += 1;
        }
        values.push(current);
    }
    return values;
}

function collectTranslationEntries(data) {
    const entries = new Map();
    const visit = value => {
        const logic = parseLogicReference(value);
        if (logic?.isCall && logic.name === 't') {
            const [key, fallback] = parseTranslationArgs(logic.argsSource);
            if (key) entries.set(key, fallback ?? humanizeTranslationKey(key));
            return;
        }
        if (Array.isArray(value)) value.forEach(visit);
        else if (value && typeof value === 'object') Object.values(value).forEach(visit);
    };
    visit(data);
    return Object.fromEntries(entries);
}

function reactGeneratedTranslationsSource(entries) {
    const translations = JSON.stringify({default: entries}, null, 2);
    return `const generatedTranslations = ${translations};

function defaultTranslationText(key) {
  return String(key ?? '').replace(/[_-]+/g, ' ').replace(/\\s+/g, ' ').trim().replace(/\\b\\w/g, char => char.toUpperCase());
}

function createFastUITranslations() {
  return {
    locale: 'default',
    translations: {},
    load(locale, entries) {
      this.translations[locale] = {...(this.translations[locale] ?? {}), ...entries};
      return this;
    },
    setLocale(locale) {
      this.locale = locale;
      return this;
    },
    t(key, fallback) {
      return this.translations[this.locale]?.[key]
        ?? this.translations.en?.[key]
        ?? fallback
        ?? defaultTranslationText(key);
    },
  };
}

export function installFastUITranslations(target = globalThis) {
  const store = target.fastUITranslations ?? createFastUITranslations();
  if (typeof store.load !== 'function') store.load = createFastUITranslations().load;
  if (typeof store.setLocale !== 'function') store.setLocale = createFastUITranslations().setLocale;
  if (typeof store.t !== 'function') store.t = createFastUITranslations().t;
  store.locale = store.locale ?? 'default';
  store.translations = store.translations ?? {};
  store.load('default', generatedTranslations.default ?? {});
  target.fastUITranslations = store;
  return store;
}

export const fastUITranslations = installFastUITranslations();
`;
}

function flutterGeneratedTranslationsSource(entries) {
    const mapEntries = Object.entries(entries)
        .map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)},`)
        .join('\n');
    return `import '../fastui_runtime.dart';

const Map<String, String> fastUITranslationsDefault = <String, String>{
${mapEntries}
};

bool _fastUITranslationsInstalled = false;

void installFastUITranslations() {
  if (_fastUITranslationsInstalled) return;
  FastUITranslations.instance.load('default', fastUITranslationsDefault);
  _fastUITranslationsInstalled = true;
}
`;
}

async function writeGeneratedTranslations(projectPath, template, entries) {
    const target = template === 'flutter'
        ? resolve(projectPath, 'lib', 'translations', 'generated.dart')
        : resolve(projectPath, 'src', 'translations', 'generated.mjs');
    await mkdir(dirname(target), {recursive: true});
    await writeFile(target, template === 'flutter'
        ? flutterGeneratedTranslationsSource(entries)
        : reactGeneratedTranslationsSource(entries));
    return target;
}

function flutterFileName(value) {
    return `${value}`
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[^a-zA-Z0-9.]+/g, '_')
        .toLowerCase();
}

async function collectFiles(root) {
    const files = [];
    let entries = [];
    try { entries = await readdir(root, {withFileTypes: true}); } catch (_) { return files; }
    for (const entry of entries) {
        const path = resolve(root, entry.name);
        if (entry.isDirectory()) files.push(...await collectFiles(path));
        else files.push(path);
    }
    return files;
}

/** Copy legacy user implementations into the visible services tree without deleting or overwriting either copy. */
async function migrateLegacyServices(specRoot, template) {
    const absoluteRoot = resolve(specRoot);
    const parts = absoluteRoot.split(sep);
    const blueprintIndex = parts.lastIndexOf('blueprints');
    if (blueprintIndex < 0) return [];
    const sourceRoot = parts.slice(0, blueprintIndex).join(sep) || sep;
    const moduleRoot = resolve(sourceRoot, 'blueprints', 'modules');
    const migrated = [];
    for (const source of await collectFiles(moduleRoot)) {
        const sourceParts = source.split(sep);
        const moduleIndex = sourceParts.indexOf('modules', blueprintIndex + 1);
        const logicIndex = sourceParts.lastIndexOf('logics');
        if (moduleIndex < 0 || logicIndex <= moduleIndex) continue;
        const expectedExtension = template === 'flutter' ? '.dart' : '.mjs';
        if (!source.endsWith(expectedExtension)) continue;
        const targetName = template === 'flutter' ? flutterFileName(basename(source)) : basename(source);
        const target = resolve(sourceRoot, 'services', ...sourceParts.slice(moduleIndex + 1, logicIndex), targetName);
        try {
            await stat(target);
        } catch (_) {
            await mkdir(dirname(target), {recursive: true});
            await copyFile(source, target);
            migrated.push(target);
        }
    }
    return migrated;
}

async function removeDuplicateLegacyState(projectPath, template) {
    const pairs = template === 'flutter'
        ? [['lib/state/observable_store.dart', 'lib/stores/observable_store.dart']]
        : [
            ['src/state/observable_store.mjs', 'src/stores/observable_store.mjs'],
            ['src/state/use_observable.mjs', 'src/stores/use_observable.mjs'],
        ];
    const normalize = value => `${value}`.replace(/\s+/g, '');
    for (const [legacyRelative, currentRelative] of pairs) {
        const legacy = resolve(projectPath, legacyRelative);
        const current = resolve(projectPath, currentRelative);
        try {
            const [legacySource, currentSource] = await Promise.all([
                readFile(legacy, 'utf8'),
                readFile(current, 'utf8'),
            ]);
            if (normalize(legacySource) === normalize(currentSource)) await rm(legacy, {force: true});
        } catch (_) {
        }
    }
    const legacyRoot = resolve(projectPath, template === 'flutter' ? 'lib/state' : 'src/state');
    try {
        if ((await readdir(legacyRoot)).length === 0) await rm(legacyRoot, {recursive: true});
    } catch (_) {
    }
}

function generatedPathForSpec(specPath, template) {
    const parts = resolve(specPath).split(sep).filter(part => part !== 'blueprints');
    if (template !== 'flutter') return parts.join(sep).replace(/\.ya?ml$/i, '.jsx');
    const filename = `${parts.pop()}`.replace(/\.ya?ml$/i, '')
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase();
    return resolve(parts.join(sep), `${filename}.dart`);
}

async function updateGeneratedManifest({projectPath, specRoot, results, template, additionalFiles = []}) {
    let rootStat;
    try { rootStat = await stat(resolve(specRoot)); } catch (_) { return; }
    if (!rootStat.isDirectory()) return;
    const manifestPath = resolve(projectPath, '.fastui', 'generated-manifest.json');
    let previous = {files: []};
    try { previous = JSON.parse(await readFile(manifestPath, 'utf8')); } catch (_) {}
    const files = [
        ...results.filter(result => result.generated).map(result => generatedPathForSpec(result.specPath, template)),
        ...additionalFiles
    ];
    const allowedModuleRoot = resolve(projectPath, template === 'flutter' ? 'lib/modules' : 'src/modules');
    const allowedStoreRoot = resolve(projectPath, template === 'flutter' ? 'lib/stores' : 'src/stores');
    const pathKey = value => {
        const absolute = resolve(value).normalize('NFC');
        return process.platform === 'darwin' || process.platform === 'win32' ? absolute.toLowerCase() : absolute;
    };
    const current = new Set(files.map(pathKey));
    for (const stale of previous.files ?? []) {
        const target = resolve(stale);
        const generatedModule = target === allowedModuleRoot || target.startsWith(`${allowedModuleRoot}${sep}`);
        const generatedStoreModel = target.startsWith(`${allowedStoreRoot}${sep}`) && /models\.generated\.(?:dart|mjs)$/i.test(target);
        if ((generatedModule || generatedStoreModel) && !current.has(pathKey(target))) {
            await rm(target, {force: true});
        }
    }
    await mkdir(resolve(projectPath, '.fastui'), {recursive: true});
    await writeFile(manifestPath, JSON.stringify({version: 1, template, files}, null, 2));
}

function jsDocType(value) {
    if (Array.isArray(value)) return 'unknown[]';
    if (value === null || value === undefined) return 'unknown';
    if (typeof value === 'object') return 'Record<string, unknown>';
    return typeof value;
}

function dartType(value) {
    if (Array.isArray(value)) return 'List<dynamic>';
    if (value && typeof value === 'object') return 'Map<String, dynamic>';
    if (typeof value === 'boolean') return 'bool';
    if (typeof value === 'number') return Number.isInteger(value) ? 'int' : 'double';
    if (typeof value === 'string' && !/^(?:inputs|states)\./i.test(value)) return 'String';
    return 'dynamic';
}

function reactModelsSource(group) {
    return `${group.map(item => {
        const name = `${item.componentName}StateModel`;
        const fields = Object.entries(item.states).map(([key, value]) => ` * @property {${jsDocType(value)}} ${identifier(key)}`).join('\n');
        return `/**\n * @typedef {Object} ${name}\n${fields}\n */`;
    }).join('\n\n')}\n`;
}

function reactStoreSource(storePath, sourceRoot) {
    const observableImport = relativeImport(storePath, resolve(sourceRoot, 'stores', 'observable_store.mjs'));
    const hookImport = relativeImport(storePath, resolve(sourceRoot, 'stores', 'use_observable.mjs'));
    return `import {useCallback, useEffect, useId, useMemo, useRef} from 'react';
import {createObservableStore} from '${observableImport}';
import {useObservable} from '${hookImport}';

export const moduleStore = createObservableStore();

/**
 * Returns observable state isolated to one mounted component instance.
 * @template {Record<string, unknown>} T
 * @param {string} componentName
 * @param {T} initialState
 * @returns {[T, (patch: Partial<T>|((current: T) => Partial<T>)) => void]}
 */
export function useModuleState(componentName, initialState) {
  const reactId = useId();
  const instanceId = useMemo(() => componentName + ':' + reactId, [componentName, reactId]);
  const initialStateRef = useRef(initialState);
  const value = useObservable(moduleStore, state => state[instanceId] ?? initialStateRef.current);
  const setState = useCallback(patch => {
    moduleStore.update(state => {
      const current = state[instanceId] ?? initialStateRef.current;
      const next = typeof patch === 'function' ? patch(current) : patch;
      return {...state, [instanceId]: Object.freeze({...current, ...next})};
    });
  }, [instanceId]);
  useEffect(() => {
    if (moduleStore.value[instanceId] === undefined) {
      moduleStore.set({[instanceId]: Object.freeze({...initialStateRef.current})});
    }
    return () => moduleStore.update(state => {
      const next = {...state};
      delete next[instanceId];
      return next;
    });
  }, [instanceId]);
  return [value, setState];
}
`;
}

function flutterModelsSource(group) {
    return `${group.map(item => {
        const name = `FastUI${item.componentName}StateModel`;
        const fields = Object.entries(item.states);
        const constructor = fields.map(([key]) => `required this.${identifier(key)}`).join(', ');
        const declarations = fields.map(([key, value]) => `  final ${dartType(value)} ${identifier(key)};`).join('\n');
        return `class ${name} {\n  const ${name}({${constructor}});\n${declarations}\n}`;
    }).join('\n\n')}\n`;
}

function flutterStoreSource() {
    return `import 'package:flutter/foundation.dart';

class FastUIModuleStore extends ChangeNotifier {
  final Map<Type, Map<String, Object>> _values = <Type, Map<String, Object>>{};

  Map<String, T> values<T extends Object>() =>
      Map<String, T>.unmodifiable((_values[T] ?? const <String, Object>{}).cast<String, T>());

  void set<T extends Object>(String instanceId, T value) {
    (_values[T] ??= <String, Object>{})[instanceId] = value;
    notifyListeners();
  }

  void remove<T extends Object>(String instanceId) {
    if (_values[T]?.remove(instanceId) != null) notifyListeners();
  }
}

final moduleStore = FastUIModuleStore();
`;
}

async function writeModuleStores(results, template) {
    const stateful = results.filter(result => result.generated && Object.keys(result.states ?? {}).length > 0);
    const groups = new Map();
    for (const result of stateful) {
        const structure = specStructure(result.specPath, template);
        const current = groups.get(structure.storeModelsPath) ?? [];
        current.push({...result, ...structure});
        groups.set(structure.storeModelsPath, current);
    }
    for (const [modelsPath, group] of groups) {
        const {storePath, projectSourceRoot} = group[0];
        await mkdir(dirname(storePath), {recursive: true});
        try {
            await stat(storePath);
        } catch (_) {
            await writeFile(storePath, template === 'flutter'
                ? flutterStoreSource()
                : reactStoreSource(storePath, projectSourceRoot));
        }
        await writeFile(modelsPath, template === 'flutter' ? flutterModelsSource(group) : reactModelsSource(group));
    }
    return [...groups.keys()];
}

export async function generateSpecFile({specPath, projectPath = process.cwd()}) {
    const document = await specToJSON(specPath);
    const normalized = normalizeSpecDocument(document);
    if (!normalized.data || normalized.kind === 'unknown') {
        return {specPath, kind: normalized.kind, generated: false, translations: {}};
    }
    const data = prepareBehavior(normalized.kind, normalized.data);
    const paths = {path: specPath, projectPath};
    if (normalized.kind === 'condition') await composeCondition({data, ...paths});
    else if (normalized.kind === 'loop') await composeLoop({data, ...paths});
    else await composeComponent({data, ...paths});
    return {specPath, kind: normalized.kind, generated: true, states: getStates(data), translations: collectTranslationEntries(data)};
}

export async function generateCodeFromSpecs({root, projectPath = process.cwd()} = {}) {
    await syncTranslatedAssets(projectPath);
    const template = getTemplateSelected();
    const specRoot = root ?? resolve(projectPath, getBlueprintRoot(template));
    await removeDuplicateLegacyState(projectPath, template);
    if (template === 'flutter') {
        await writeFile(resolve(projectPath, 'lib', 'fastui_runtime.dart'), flutterRuntimeSource());
    } else {
        await ensureReactSupportFiles(projectPath);
    }
    await migrateLegacyServices(specRoot, template);
    const results = [];
    for (const specPath of await readSpecs(specRoot)) {
        results.push(await generateSpecFile({specPath, projectPath}));
    }
    const translations = Object.assign({}, ...results.map(result => result.translations ?? {}));
    const translationFile = await writeGeneratedTranslations(projectPath, template, translations);
    const storeFiles = await writeModuleStores(results, template);
    await updateGeneratedManifest({projectPath, specRoot, results, template, additionalFiles: [...storeFiles, translationFile]});
    return results;
}
