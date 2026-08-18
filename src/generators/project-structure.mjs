import {copyFile, mkdir, readFile, stat, writeFile} from 'node:fs/promises';
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
        componentName: pascalIdentifier([...moduleSegments.slice(1), sourceFile].join('_')),
        servicePath: resolve(projectSourceRoot, 'services', ...serviceRelative),
        legacyServicePath: resolve(dirname(absolute), 'logics', `${sourceStem}${extension}`),
        storePath: resolve(projectSourceRoot, 'stores', moduleName, template === 'flutter' ? 'store.dart' : 'store.mjs'),
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

function flutterTranslationImportPath(servicePath) {
    return relativeImport(servicePath, resolve(translationRootFromServicePath(servicePath), 'translations', 'generated.dart'));
}

function reactTranslationStub() {
    return `/** Resolves a translation key from the generated FastUI language store.
 * @param {{args: string[]}} data */
export function t(data) {
  const key = data?.args?.[0] ?? '';
  const fallback = typeof data?.args?.[1] === 'string' ? data.args[1] : undefined;
  return fastUITranslations.t(key, fallback);
}`;
}

function flutterTranslationStub() {
    return `/// Resolves a translation key via the generated FastUITranslations store.
dynamic t(Map<String, dynamic> data) {
  installFastUITranslations();
  final rawArgs = data['args'];
  final args = rawArgs is List<dynamic> ? rawArgs : const <dynamic>[];
  final normalized = args.length == 1 && args.first is List ? List<dynamic>.from(args.first as List) : args;
  final key = normalized.isNotEmpty ? normalized.first as String? ?? '' : '';
  final fallback = normalized.length > 1 ? normalized[1] as String? : null;
  return FastUITranslations.instance.t(key, fallback: fallback);
}`;
}

function replaceGeneratedTranslationStub(source, template) {
    const legacyReact = /\/\*\* Resolves a translation key from the global FastUI language store\.[\s\S]*?export function t\(data\) \{[\s\S]*?\n\}/;
    const nextReact = /\/\*\* Resolves a translation key from the generated FastUI language store\.[\s\S]*?export function t\(data\) \{[\s\S]*?\n\}/;
    const legacyFlutter = /\/\/\/ Resolves a translation key via the global FastUITranslations store\.[\s\S]*?dynamic t\(Map<String, dynamic> data\) \{[\s\S]*?\n\}/;
    const nextFlutter = /\/\/\/ Resolves a translation key via the generated FastUITranslations store\.[\s\S]*?dynamic t\(Map<String, dynamic> data\) \{[\s\S]*?\n\}/;
    if (template === 'flutter') {
        return source.replace(legacyFlutter, flutterTranslationStub()).replace(nextFlutter, flutterTranslationStub());
    }
    return source.replace(legacyReact, reactTranslationStub()).replace(nextReact, reactTranslationStub());
}

function ensureImport(source, statement) {
    return source.includes(statement) ? source : `${statement}\n${source}`;
}

/**
 * Services are user-owned. Existing files and functions are never rewritten,
 * except the generated translation helper `t`, whose known autogenerated
 * bodies are upgraded in-place when FastUI's translation runtime evolves.
 */
export async function ensureServiceFile({servicePath, legacyPath, functions, template}) {
    await mkdir(dirname(servicePath), {recursive: true});
    if (!(await exists(servicePath))) {
        if (legacyPath && await exists(legacyPath)) await copyFile(legacyPath, servicePath);
        else await writeFile(servicePath, '');
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
                source = ensureImport(source, `import '${flutterTranslationImportPath(servicePath)}';`);
            } else {
                source = ensureImport(source, `import {fastUITranslations} from '${reactTranslationImportPath(servicePath)}';`);
            }
            const upgraded = replaceGeneratedTranslationStub(source, template);
            if (upgraded !== source) {
                source = upgraded;
                continue;
            }
        }
        if (pattern.test(source)) continue;
        if (functionName === 't') {
            additions.push(template === 'flutter' ? flutterTranslationStub() : reactTranslationStub());
        } else {
            additions.push(template === 'flutter'
                ? `/// Receives the component state, inputs, and invocation arguments.\ndynamic ${functionName}(Map<String, dynamic> data) {\n  // TODO: Implement the service.\n}`
                : `/** @param {{component: {states: object, inputs: object}, args: unknown[]}} data */\nexport function ${functionName}(data) {\n  // TODO: Implement the service.\n}`);
        }
    }
    if (additions.length) {
        source = `${source.trimEnd()}${source.trim() ? '\n\n' : ''}${additions.join('\n\n')}\n`;
    }
    await writeFile(servicePath, source);
    return servicePath;
}
