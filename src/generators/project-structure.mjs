import {mkdir, readFile, stat, writeFile} from 'node:fs/promises';
import {dirname, relative, resolve, sep} from 'node:path';

const cleanStem = value => `${value ?? ''}`
    .replace(/\.ya?ml$/i, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();

export const identifier = value => `${value ?? ''}`
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/^[^a-zA-Z_]/, '_$&');

export const pascalIdentifier = value => `${value ?? ''}`
    .replace(/\.ya?ml$/i, '')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map(part => `${part[0]}`.toUpperCase() + part.slice(1))
    .join('');

export function specStructure(specPath, template) {
    const absolute = resolve(specPath);
    const parts = absolute.split(sep);
    const blueprintIndex = parts.lastIndexOf('blueprints');
    const moduleIndex = parts.indexOf('modules', blueprintIndex + 1);
    const projectSourceRoot = blueprintIndex >= 0 ? parts.slice(0, blueprintIndex).join(sep) || sep : dirname(absolute);
    const relativeParts = moduleIndex >= 0 ? parts.slice(moduleIndex + 1) : [parts.at(-1)];
    const sourceFile = relativeParts.at(-1);
    const moduleSegments = relativeParts.slice(0, -1);
    const moduleName = moduleSegments[0] || 'shared';
    const extension = template === 'flutter' ? '.dart' : '.mjs';
    const sourceStem = template === 'flutter' ? cleanStem(sourceFile) : `${sourceFile}`.replace(/\.ya?ml$/i, '');
    const serviceRelative = [...moduleSegments, `${sourceStem}${extension}`];
    return {
        projectSourceRoot,
        moduleName,
        moduleSegments,
        specId: [...moduleSegments, sourceStem].join('/'),
        componentName: pascalIdentifier([...moduleSegments.slice(1), sourceFile].join('_')),
        servicePath: resolve(projectSourceRoot, 'services', ...serviceRelative),
        storePath: resolve(projectSourceRoot, 'stores', moduleName, template === 'flutter' ? 'providers.generated.dart' : 'stores.generated.mjs'),
        storeModelsPath: resolve(projectSourceRoot, 'stores', moduleName, template === 'flutter' ? 'models.generated.dart' : 'models.generated.mjs'),
    };
}

export function relativeImport(fromFile, targetFile) {
    let value = relative(dirname(resolve(fromFile)), resolve(targetFile)).split(sep).join('/');
    if (!value.startsWith('.')) value = `./${value}`;
    return value;
}

async function exists(path) {
    try {
        await stat(path);
        return true;
    } catch (_) {
        return false;
    }
}

function translationRootFromServicePath(servicePath) {
    const marker = `${sep}services${sep}`;
    const [root] = resolve(servicePath).split(marker);
    return root || dirname(dirname(servicePath));
}

function reactTranslationImportPath(servicePath) {
    return relativeImport(servicePath, resolve(translationRootFromServicePath(servicePath), 'translations', 'generated.mjs'));
}

function flutterRuntimeImportPath(servicePath) {
    return relativeImport(servicePath, resolve(translationRootFromServicePath(servicePath), 'fastui_runtime.dart'));
}

function reactTranslationStub() {
    return `/** Resolves a translation key from the generated FastUI language store.
 * @param {import('../fastui_runtime.mjs').FastUIComponentContext} context */
export function t(context) {
  const key = context?.args?.[0] ?? '';
  return fastUITranslationStore.translate(key);
}`;
}

function flutterTranslationStub() {
    return `/// Resolves a translation key via the Riverpod FastUI translation store.
dynamic t(FastUIComponentContext<dynamic, dynamic> context) {
  final args = context.args;
  final normalized = args.length == 1 && args.first is List ? List<dynamic>.from(args.first as List) : args;
  final key = normalized.isNotEmpty ? normalized.first as String? ?? '' : '';
  return context.ref.read(fastUITranslationProvider).translate(key);
}`;
}

function ensureImport(source, statement) {
    return source.includes(statement) ? source : `${statement}\n${source}`;
}

function dartServiceValue(value) {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'string') return JSON.stringify(value).replaceAll('$', '\\$');
    if (typeof value === 'number' || typeof value === 'boolean') return `${value}`;
    if (Array.isArray(value)) return `<dynamic>[${value.map(dartServiceValue).join(', ')}]`;
    return `<String, dynamic>{${Object.entries(value).map(([key, entry]) => `${dartServiceValue(key)}: ${dartServiceValue(entry)}`).join(', ')}}`;
}

function generatedSetterName(key) {
    const field = `${key}`.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^[^a-zA-Z_]/, '_$&');
    return `set${field[0]?.toUpperCase() ?? ''}${field.slice(1)}`;
}

function normalizeReactServiceValue(value) {
    return typeof value === 'string'
        ? value.replace(/^asset:\/\/figma\//, '/images/figma/')
        : Array.isArray(value)
            ? value.map(normalizeReactServiceValue)
            : value && typeof value === 'object'
                ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, normalizeReactServiceValue(entry)]))
                : value;
}

function reactServiceValue(value) {
    return JSON.stringify(normalizeReactServiceValue(value), null, 2).replaceAll('\n', '\n  ');
}

/**
 * Services are user-owned. Existing files and functions are never rewritten,
 * Existing bodies are never rewritten; only missing imports and hooks are appended.
 */
export async function ensureServiceFile({servicePath, functions, template, flutterContext, flutterReturns = {}, initialStateByFunction = {}}) {
    await mkdir(dirname(servicePath), {recursive: true});
    if (!(await exists(servicePath))) {
        await writeFile(servicePath, '');
    }
    let source = await readFile(servicePath, 'utf8');
    const additions = [];
    for (const functionName of functions) {
        const pattern = template === 'flutter'
            ? new RegExp(`\\b${functionName}\\s*\\(`)
            : new RegExp(`\\b(?:function|const|let|var)\\s+${functionName}\\b|\\b${functionName}\\s*=`);
        if (functionName === 't') {
            if (template === 'flutter') {
                source = ensureImport(source, `import '${flutterRuntimeImportPath(servicePath)}';`);
            } else {
                source = ensureImport(source, `import {fastUITranslationStore} from '${reactTranslationImportPath(servicePath)}';`);
            }
        }
        if (pattern.test(source)) continue;
        if (functionName === 't') {
            additions.push(template === 'flutter' ? flutterTranslationStub() : reactTranslationStub());
        } else {
            const flutterReturn = flutterReturns[functionName] ?? 'FutureOr<void>';
            if (template === 'flutter' && flutterReturn === 'FutureOr<void>') {
                source = ensureImport(source, "import 'dart:async';");
            }
            if (template === 'flutter' && flutterContext) {
                source = ensureImport(source, `import '${relativeImport(servicePath, flutterContext.runtimePath)}';`);
                source = ensureImport(source, `import '${relativeImport(servicePath, flutterContext.modelsPath)}';`);
                source = ensureImport(source, `import '${relativeImport(servicePath, flutterContext.providersPath)}';`);
            }
            const initialState = initialStateByFunction[functionName];
            const reactSeed = initialState
                ? Object.entries(initialState).map(([key, value]) => `  context.store.${generatedSetterName(key)}(context.instanceId, ${reactServiceValue(value)});`).join('\n')
                : '';
            const flutterSeed = initialState
                ? Object.entries(initialState).map(([key, value]) => `  context.notifier.${generatedSetterName(key)}(${dartServiceValue(value)});`).join('\n')
                : '';
            additions.push(template === 'flutter'
                ? `/// Receives the Riverpod-backed component state, inputs, and invocation arguments.\n${flutterReturn} ${functionName}(${flutterContext ? `FastUIComponentContext<${flutterContext.model}, ${flutterContext.notifier}>` : 'dynamic'} context) {\n  ${flutterSeed ? `// Replace this design-time seed with service data when implementing this hook.\n${flutterSeed}` : (flutterReturn.startsWith('Map<') ? 'return const <String, dynamic>{};' : '// TODO: Implement the service.')}\n}`
                : `/** @param {import('${relativeImport(servicePath, resolve(translationRootFromServicePath(servicePath), 'fastui_runtime.mjs'))}').FastUIComponentContext} context */\nexport function ${functionName}(context) {\n${reactSeed ? `  // Replace this design-time seed with service data when implementing this hook.\n${reactSeed}` : '  // TODO: Implement the service.'}\n}`);
        }
    }
    if (additions.length) {
        source = `${source.trimEnd()}${source.trim() ? '\n\n' : ''}${additions.join('\n\n')}\n`;
    }
    await writeFile(servicePath, source);
    return servicePath;
}
