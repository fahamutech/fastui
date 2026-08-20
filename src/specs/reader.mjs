/**
 * Reads FastUI YAML spec files off disk: listing spec files under a
 * blueprint root (readSpecs) and resolving a single spec's `base` field
 * (specToJSON).
 *
 * When `base` is a spec-file path (e.g. `base: ./text.yml`) the document is
 * React and Flutter recursively deep-merge inheritance before code generation
 * and rebase inherited composition paths to the derived spec.
 *
 * This is unrelated to `modifier.extend`, which composes ordered child specs
 * top-down within a single component's render tree.
 */
import {glob} from "glob";
import * as yaml from "js-yaml"
import {readFile} from 'node:fs/promises'
import {dirname, isAbsolute, relative, resolve as pathResolve, sep as pathSep} from 'node:path'

const specificationKeys = ['component', 'condition', 'loop'];

export async function readSpecs(unParsedRootFolder) {
    const cwd = process.cwd();
    const rootFolder = pathResolve(unParsedRootFolder??'').replace(cwd, '.');
    if (/\.ya?ml$/i.test(`${rootFolder}`)) {
        const rootParts = `${rootFolder}`.split(pathSep);
        const rootFileName = rootParts.pop();
        const pattern =
            `${rootParts.join('/')}/**/${rootFileName.replace(/\.ya?ml$/i, '')}.{yml,yaml}`;
        return await glob(pattern, {
            ignore: ['**/node_modules/**']
        });
    }
    const root = rootFolder === pathSep
        ? `./`
        : rootFolder?.endsWith(pathSep)
            ? rootFolder
            : `${rootFolder ?? '.'}/`;
    const pattern = `${root.split(pathSep).join('/')}**/*.{yml,yaml}`;
    return await glob(pattern, {
        ignore: ['**/node_modules/**']
    });
}

function isSpecFileReference(value) {
    return typeof value === 'string' && /\.ya?ml$/i.test(value);
}

/**
 * Returns a relative path from `fromDir` to `toPath`, always starting with `./`.
 */
function rebasePath(fromDir, toPath) {
    let rel = relative(fromDir, toPath).split(pathSep).join('/');
    if (!rel.startsWith('.')) rel = `./${rel}`;
    return rel;
}

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(base, override) {
    if (!isPlainObject(base) || !isPlainObject(override)) return structuredClone(override);
    const result = structuredClone(base);
    for (const [key, value] of Object.entries(override)) {
        result[key] = isPlainObject(value) && isPlainObject(result[key])
            ? deepMerge(result[key], value)
            : structuredClone(value);
    }
    return result;
}

function rebaseModifierPaths(primitive, sourceDir, targetDir) {
    const result = structuredClone(primitive);
    const modifier = result?.modifier;
    if (!modifier || sourceDir === targetDir) return result;
    const rebaseValue = value => {
        if (Array.isArray(value)) return value.map(rebaseValue);
        if (!isSpecFileReference(value)) return value;
        return rebasePath(targetDir, pathResolve(sourceDir, value));
    };
    for (const key of ['extend', 'feed', 'left', 'right']) {
        if (modifier[key] !== undefined) modifier[key] = rebaseValue(modifier[key]);
    }
    return result;
}

async function resolveInheritedSpecDocument(specPath, targetDir, stack = [], platform = 'FastUI') {
    const absolutePath = pathResolve(specPath);
    if (stack.includes(absolutePath)) {
        throw new Error(`Circular ${platform} spec inheritance: ${[...stack, absolutePath].join(' -> ')}`);
    }
    const sourceDir = dirname(absolutePath);
    const document = yaml.load(await readFile(absolutePath, {encoding: 'utf-8'}), {}) ?? {};
    const resolved = structuredClone(document);
    for (const key of specificationKeys) {
        const current = document?.[key];
        if (!current) continue;
        const base = current.base;
        const local = structuredClone(current);
        delete local.base;
        const rebasedLocal = rebaseModifierPaths(local, sourceDir, targetDir);
        if (!isSpecFileReference(base)) {
            resolved[key] = current.base === undefined
                ? rebasedLocal
                : {...rebasedLocal, base: current.base};
            continue;
        }
        const absoluteBase = pathResolve(sourceDir, base);
        const parentDocument = await resolveInheritedSpecDocument(absoluteBase, targetDir, [...stack, absolutePath], platform);
        const parentEntries = specificationKeys.filter(parentKey => parentDocument[parentKey]);
        if (parentEntries.length !== 1) {
            throw new Error(`${platform} spec base ${absoluteBase} must define exactly one component, condition, or loop primitive`);
        }
        const parentKey = parentEntries[0];
        if (parentKey !== key) delete resolved[key];
        resolved[parentKey] = deepMerge(parentDocument[parentKey], rebasedLocal);
    }
    return resolved;
}

export async function specToJSON(specPath) {
    return resolveInheritedSpecDocument(specPath, dirname(pathResolve(specPath)), [], 'React');
}

export async function specToFlutterJSON(specPath) {
    return resolveInheritedSpecDocument(specPath, dirname(pathResolve(specPath)), [], 'Flutter');
}
