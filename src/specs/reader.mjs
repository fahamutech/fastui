/**
 * Reads FastUI YAML spec files off disk: listing spec files under a
 * blueprint root (readSpecs) and resolving a single spec's `ref:` chain
 * into one fully-merged in-memory document (specToJSON) that the generator
 * layer can hand straight to legacy-spec.mjs.
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
    for (const key of ['extend', 'compose', 'left', 'right', 'feed']) {
        if (output?.modifier?.[key]) {
            output.modifier[key] = rebaseLocalPath(output.modifier[key], sourceSpecPath, destinationSpecPath);
        }
    }
    return output;
}

async function resolveSpecDocument(specPath, stack = []) {
    const absolutePath = pathResolve(specPath);
    if (stack.includes(absolutePath)) {
        throw new Error(`Circular spec ref detected: ${[...stack, absolutePath].join(' -> ')}`);
    }
    const document = yaml.load(await readFile(absolutePath, {encoding: 'utf-8'}), {}) ?? {};
    const resolved = structuredClone(document);
    for (const key of specificationKeys) {
        const current = resolved?.[key];
        const ref = current?.modifier?.ref ?? current?.ref;
        if (!current || !ref) continue;
        const referencePath = pathResolve(dirname(absolutePath), ref);
        const referenceDocument = await resolveSpecDocument(referencePath, [...stack, absolutePath]);
        const referenceKey = referenceDocument[key] ? key : specificationKeys.find(candidate => referenceDocument[candidate]);
        if (!referenceKey) throw new Error(`Referenced file ${referencePath} does not contain a FastUI specification.`);
        const referenceData = rebaseCompositionPaths(referenceDocument[referenceKey], referencePath, absolutePath);
        const override = structuredClone(current);
        delete override.ref;
        if (override.modifier) delete override.modifier.ref;
        resolved[key] = deepMerge(referenceData, override);
    }
    return resolved;
}

export async function specToJSON(specPath) {
    return resolveSpecDocument(specPath);
}
