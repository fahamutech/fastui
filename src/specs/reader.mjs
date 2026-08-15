/**
 * Reads FastUI YAML spec files off disk: listing spec files under a
 * blueprint root (readSpecs) and resolving a single spec's structural
 * inheritance chain into one fully-merged in-memory document (specToJSON)
 * that the generator layer can hand straight to legacy-spec.mjs.
 *
 * Structural inheritance (formerly `modifier.ref`) is now expressed by
 * pointing `base` at another spec file (e.g. `base: ./text.yml`), which is
 * how a Figma INSTANCE reuses its shared/core MAIN COMPONENT spec: the
 * referenced document is resolved first, then the local `modifier` is
 * deep-merged on top as an override. This is unrelated to `modifier.extend`,
 * which composes ordered child specs top-down rather than inheriting shape.
 */
import {glob} from "glob";
import * as yaml from "js-yaml"
import {readFile} from 'node:fs/promises'
import {dirname, isAbsolute, relative, resolve as pathResolve, sep as pathSep} from 'node:path'

const specificationKeys = ['app', 'component', 'components', 'condition', 'loop'];

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

function deepMerge(base, override) {
    if (Array.isArray(override)) return structuredClone(override);
    if (!override || typeof override !== 'object') return override === undefined ? structuredClone(base) : override;
    const output = base && typeof base === 'object' && !Array.isArray(base) ? structuredClone(base) : {};
    for (const [key, value] of Object.entries(override)) {
        output[key] = value && typeof value === 'object' && !Array.isArray(value)
            ? deepMerge(output[key], value)
            : structuredClone(value);
    }
    return output;
}

function rebaseLocalPath(value, sourceSpecPath, destinationSpecPath) {
    if (typeof value !== 'string' || isAbsolute(value) || !/\.ya?ml$/i.test(value)) return value;
    let rebased = relative(dirname(destinationSpecPath), pathResolve(dirname(sourceSpecPath), value)).split(pathSep).join('/');
    if (!rebased.startsWith('.')) rebased = `./${rebased}`;
    return rebased;
}

function rebaseCompositionPaths(data, sourceSpecPath, destinationSpecPath) {
    const output = structuredClone(data);
    for (const key of ['left', 'right', 'feed']) {
        if (output?.modifier?.[key]) {
            output.modifier[key] = rebaseLocalPath(output.modifier[key], sourceSpecPath, destinationSpecPath);
        }
    }
    if (output?.modifier?.extend) {
        output.modifier.extend = Array.isArray(output.modifier.extend)
            ? output.modifier.extend.map(item => rebaseLocalPath(item, sourceSpecPath, destinationSpecPath))
            : rebaseLocalPath(output.modifier.extend, sourceSpecPath, destinationSpecPath);
    }
    return output;
}

function isSpecFileReference(value) {
    return typeof value === 'string' && /\.ya?ml$/i.test(value);
}

async function resolveSpecDocument(specPath, stack = []) {
    const absolutePath = pathResolve(specPath);
    if (stack.includes(absolutePath)) {
        throw new Error(`Circular spec base detected: ${[...stack, absolutePath].join(' -> ')}`);
    }
    const document = yaml.load(await readFile(absolutePath, {encoding: 'utf-8'}), {}) ?? {};
    const resolved = structuredClone(document);
    for (const key of specificationKeys) {
        const current = resolved?.[key];
        const base = current?.base;
        if (!current || !isSpecFileReference(base)) continue;
        const referencePath = pathResolve(dirname(absolutePath), base);
        const referenceDocument = await resolveSpecDocument(referencePath, [...stack, absolutePath]);
        const referenceKey = referenceDocument[key] ? key : specificationKeys.find(candidate => referenceDocument[candidate]);
        if (!referenceKey) throw new Error(`Referenced file ${referencePath} does not contain a FastUI specification.`);
        const referenceData = rebaseCompositionPaths(referenceDocument[referenceKey], referencePath, absolutePath);
        const override = structuredClone(current);
        delete override.base;
        resolved[key] = deepMerge(referenceData, override);
    }
    return resolved;
}

export async function specToJSON(specPath) {
    return resolveSpecDocument(specPath);
}
