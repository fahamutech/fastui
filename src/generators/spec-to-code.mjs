import {composeComponent} from './component.mjs';
import {composeCondition} from './condition.mjs';
import {composeLoop} from './loop.mjs';
import {readSpecs, specToFlutterJSON, specToJSON} from '../specs/reader.mjs';
import {normalizeSpecDocument, prepareBehavior} from './spec-normalizer.mjs';
import {copyFile, mkdir, readFile, readdir, rm, stat, writeFile} from 'node:fs/promises';
import {dirname, join, resolve, sep} from 'node:path';
import {getBlueprintRoot, getTemplateSelected} from '../tooling/config.mjs';
import {getStates, parseLogicReference} from './modifier.mjs';
import {identifier, pascalIdentifier, relativeImport, specStructure} from './project-structure.mjs';
import {flutterRuntimeSource} from './templates/flutter/generator.mjs';
import {reactRuntimeSource} from './templates/reactjs/runtime.mjs';

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
    for (const resourceType of ['images', 'vectors']) {
        const folder = join(source, resourceType);
        let files = [];
        try { files = await readdir(folder, {withFileTypes: true}); } catch (_) {}
        for (const file of files) {
            if (file.isFile()) await copyFile(join(folder, file.name), join(target, file.name));
        }
    }
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
        if (value?.translation && typeof value.translation === 'object') {
            const {key, fallback} = value.translation;
            if (key && fallback !== undefined) entries.set(key, fallback);
            return;
        }
        const logic = parseLogicReference(value);
        if (logic?.isCall && logic.name === 't') {
            const [key, fallback] = parseTranslationArgs(logic.argsSource);
            if (key && fallback !== undefined) entries.set(key, fallback);
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
    return `import {createFastUITranslationStore, useFastUITranslationValue} from '../fastui_runtime.mjs';

const generatedTranslations = ${translations};

export const fastUITranslationStore = createFastUITranslationStore(
  generatedTranslations.default ?? {},
);

export function useFastUITranslation(key, args = {}) {
  return useFastUITranslationValue(fastUITranslationStore, key, args);
}
`;
}

function flutterGeneratedTranslationsSource(entries) {
    const mapEntries = Object.entries(entries)
        .map(([key, value]) =>
            `  ${JSON.stringify(key)}: ${JSON.stringify(value)},`.replaceAll('$','\\$'))
        .join('\n');
    return `const Map<String, String> fastUITranslationsDefault = <String, String>{
${mapEntries}
};
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
        const generatedStoreModel = target.startsWith(`${allowedStoreRoot}${sep}`) && /(?:(?:models|providers|stores)\.generated\.(?:dart|mjs)|store\.mjs)$/i.test(target);
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
    if (Array.isArray(value)) return 'List<dynamic>?';
    if (value && typeof value === 'object') return 'Map<String, dynamic>?';
    if (typeof value === 'boolean') return 'bool?';
    if (typeof value === 'number') return Number.isInteger(value) ? 'int?' : 'double?';
    if (typeof value === 'string' && !/^(?:inputs|states)\./i.test(value)) return 'String?';
    return 'dynamic';
}

function dartValue(value) {
    if (value === undefined || value === null) return 'null';
    if (typeof value === 'string') return JSON.stringify(value).replaceAll('$', '\\$');
    if (typeof value === 'number' || typeof value === 'boolean') return `${value}`;
    if (Array.isArray(value)) return `<dynamic>[${value.map(dartValue).join(', ')}]`;
    if (typeof value === 'object') {
        return `<String, dynamic>{${Object.entries(value).map(([key, entry]) => `${dartValue(key)}: ${dartValue(entry)}`).join(', ')}}`;
    }
    return 'null';
}

function reactModelsSource(group) {
    return `${group.map(item => {
        const name = `${item.componentName}StateModel`;
        const fields = Object.entries(item.states).map(([key, value]) => ` * @property {${jsDocType(value)}} ${identifier(key)}`).join('\n');
        return `/**\n * @readonly\n * @typedef {Object} ${name}\n${fields}\n */`;
    }).join('\n\n')}\n`;
}

function reactStateValue(value) {
    if (typeof value === 'string' && /^inputs\./i.test(value.trim())) {
        return value.trim().replace(/^inputs\./i, 'inputs.');
    }
    return JSON.stringify(value);
}

function reactStoreExportName(componentName) {
    const camel = `${componentName[0] ?? ''}`.toLowerCase() + componentName.slice(1);
    return `${identifier(camel)}Store`;
}

function reactStoreSource(group, storePath) {
    const runtimeImport = relativeImport(storePath, resolve(group[0].projectSourceRoot, 'fastui_runtime.mjs'));
    const stores = group.map(item => {
        const storeName = reactStoreExportName(item.componentName);
        const initial = Object.entries(item.states)
            .map(([key, value]) => `    ${JSON.stringify(key)}: ${reactStateValue(value)},`)
            .join('\n');
        const setters = Object.keys(item.states)
            .map(key => {
                const field = identifier(key);
                return `    set${field[0].toUpperCase()}${field.slice(1)}: (state, value) => ({...state, ${JSON.stringify(key)}: value}),`;
            })
            .join('\n');
        return `export const ${storeName} = createFastUIComponentStore({
  componentId: ${JSON.stringify(item.specId)},
  fields: ${JSON.stringify(Object.keys(item.states))},
  createInitialState: (inputs = {}) => Object.freeze({
${initial}
  }),
  setters: {
${setters}
  },
});`;
    }).join('\n\n');
    return `import {createFastUIComponentStore} from '${runtimeImport}';\n\n${stores}\n`;
}

function flutterModelsSource(group) {
    return `const Object _fastUIUnset = Object();\n\n${group.map(item => {
        const name = `FastUI${item.componentName}StateModel`;
        const fields = Object.entries(item.states);
        const constructor = fields.map(([key]) => `required this.${identifier(key)}`).join(', ');
        const declarations = fields.map(([key, value]) => `  final ${dartType(value)} ${identifier(key)};`).join('\n');
        const copyParams = fields.map(([key]) => `Object? ${identifier(key)} = _fastUIUnset`).join(', ');
        const copies = fields.map(([key, value]) => {
            const field = identifier(key);
            return `      ${field}: identical(${field}, _fastUIUnset) ? this.${field} : ${field} as ${dartType(value)},`;
        }).join('\n');
        return `class ${name} {\n  const ${name}({${constructor}});\n${declarations}\n\n  ${name} copyWith({${copyParams}}) => ${name}(\n${copies}\n  );\n}`;
    }).join('\n\n')}\n`;
}

function flutterStoreSource(group, storePath) {
    const runtimeImport = relativeImport(storePath, resolve(group[0].projectSourceRoot, 'fastui_runtime.dart'));
    const modelsImport = relativeImport(storePath, group[0].storeModelsPath);
    const providers = group.map(item => {
        const model = `FastUI${item.componentName}StateModel`;
        const notifier = `FastUI${item.componentName}Notifier`;
        const camelName = `${item.componentName[0]}`.toLowerCase() + item.componentName.slice(1);
        const provider = `${identifier(camelName)}Provider`;
        const initialState = `fastUI${item.componentName}InitialState`;
        const stateDefaults = `fastUI${item.componentName}StateDefaults`;
        const defaultEntries = Object.entries(item.states)
            .map(([key, value]) => `  ${JSON.stringify(key)}: ${dartValue(value)},`)
            .join('\n');
        const initialFields = Object.entries(item.states).map(([key, value]) => {
            const field = identifier(key);
            const type = dartType(value);
            const override = `overrides[${JSON.stringify(key)}]`;
            const fallback = `${stateDefaults}[${JSON.stringify(key)}]`;
            return `    ${field}: overrides.containsKey(${JSON.stringify(key)}) ? ${type === 'dynamic' ? override : `${override} as ${type}`} : ${type === 'dynamic' ? fallback : `${fallback} as ${type}`},`;
        }).join('\n');
        const setters = Object.entries(item.states).map(([key, value]) => {
            const field = identifier(key);
            return `  void set${field[0].toUpperCase()}${field.slice(1)}(${dartType(value)} value) => state = state.copyWith(${field}: value);`;
        }).join('\n');
        const cases = Object.entries(item.states).map(([key, value]) => {
            const field = identifier(key);
            return `      case ${JSON.stringify(key)}:\n        set${field[0].toUpperCase()}${field.slice(1)}(value as ${dartType(value)});\n        return;`;
        }).join('\n');
        return `const Map<String, dynamic> ${stateDefaults} = <String, dynamic>{
${defaultEntries}
};

${model} ${initialState}([Map<String, dynamic> overrides = const <String, dynamic>{}]) => ${model}(
${initialFields}
);

class ${notifier} extends AutoDisposeFamilyNotifier<${model}, FastUIProviderInstance<${model}>> {
  Future<void>? _initialization;

  @override
  ${model} build(FastUIProviderInstance<${model}> argument) => ${initialState}(argument.initialOverrides);

  Future<void> initialize(FutureOr<void> Function() callback) =>
      _initialization ??= Future<void>.sync(callback);

${setters}

  void setField(String key, dynamic value) {
    switch (key) {
${cases}
      default:
        throw ArgumentError.value(key, 'key', 'Unknown FastUI state field');
    }
  }
}

final ${provider} = NotifierProvider.autoDispose.family<${notifier}, ${model}, FastUIProviderInstance<${model}>>(${notifier}.new);`;
    }).join('\n\n');
    return `import 'dart:async';\nimport 'package:flutter_riverpod/flutter_riverpod.dart';\nimport '${runtimeImport}';\nimport '${modelsImport}';\n\n${providers}\n`;
}

async function writeModuleStores(results, template) {
    const stateful = results.filter(result => result.generated && (
        Object.keys(result.states ?? {}).length > 0
        || (template === 'reactjs' && Object.keys(result.effects ?? {}).length > 0)
    ));
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
        if (template === 'flutter') {
            await writeFile(storePath, flutterStoreSource(group, storePath));
        } else {
            await writeFile(storePath, reactStoreSource(group, storePath));
        }
        await writeFile(modelsPath, template === 'flutter' ? flutterModelsSource(group) : reactModelsSource(group));
    }
    return [...groups.entries()].flatMap(([modelsPath, group]) => [modelsPath, group[0].storePath]);
}

async function prepareSpecFile({specPath, projectPath = process.cwd()}) {
    const document = getTemplateSelected() === 'flutter'
        ? await specToFlutterJSON(specPath)
        : await specToJSON(specPath);
    const normalized = normalizeSpecDocument(document);
    if (!normalized.data || normalized.kind === 'unknown') {
        return {specPath, projectPath, kind: normalized.kind, generated: false, translations: {}};
    }
    const data = prepareBehavior(normalized.kind, normalized.data);
    return {
        specPath,
        projectPath,
        kind: normalized.kind,
        generated: true,
        data,
        states: getStates(data),
        effects: data?.modifier?.effects ?? {},
        translations: collectTranslationEntries(data),
    };
}

async function renderPreparedSpec(prepared) {
    if (!prepared.generated) return prepared;
    const paths = {path: prepared.specPath, projectPath: prepared.projectPath};
    if (prepared.kind === 'condition') await composeCondition({data: prepared.data, ...paths});
    else if (prepared.kind === 'loop') await composeLoop({data: prepared.data, ...paths});
    else await composeComponent({data: prepared.data, ...paths});
    return prepared;
}

export async function generateSpecFile(options) {
    const rendered = await renderPreparedSpec(await prepareSpecFile(options));
    const {data: _data, projectPath: _projectPath, ...result} = rendered;
    return result;
}

export async function generateCodeFromSpecs({root, projectPath = process.cwd()} = {}) {
    await syncTranslatedAssets(projectPath);
    const template = getTemplateSelected();
    const specRoot = root ?? resolve(projectPath, getBlueprintRoot(template));
    if (template === 'flutter') {
        await writeFile(resolve(projectPath, 'lib', 'fastui_runtime.dart'), flutterRuntimeSource());
    } else {
        await writeFile(resolve(projectPath, 'src', 'fastui_runtime.mjs'), reactRuntimeSource());
    }
    const prepared = [];
    for (const specPath of await readSpecs(specRoot)) {
        prepared.push(await prepareSpecFile({specPath, projectPath}));
    }
    const translations = Object.assign({}, ...prepared.map(result => result.translations ?? {}));
    const translationFile = await writeGeneratedTranslations(projectPath, template, translations);
    const storeFiles = await writeModuleStores(prepared, template);
    const results = [];
    for (const item of prepared) {
        const rendered = await renderPreparedSpec(item);
        const {data: _data, projectPath: _projectPath, ...result} = rendered;
        results.push(result);
    }
    const runtimeFile = resolve(projectPath, template === 'flutter' ? 'lib/fastui_runtime.dart' : 'src/fastui_runtime.mjs');
    await updateGeneratedManifest({projectPath, specRoot, results, template, additionalFiles: [...storeFiles, translationFile, runtimeFile]});
    return results;
}
