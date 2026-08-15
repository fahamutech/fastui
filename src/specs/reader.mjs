/**
 * Reads FastUI YAML spec files off disk: listing spec files under a
 * blueprint root (readSpecs) and resolving a single spec's `base` field
 * (specToJSON).
 *
 * When `base` is a spec-file path (e.g. `base: ./text.yml`) the document is
 * tagged with `__specBase` (the resolved absolute path of the base spec) and
 * `__specBaseRelative` (the path as written, rebased to the current file's
 * directory). The local `modifier` overrides are preserved as-is. The generator
 * layer detects `__specBase` and emits a thin runtime wrapper that imports the
 * base component and passes the local overrides as `overrideStyles`,
 * `overrideProps`, and `overrideStates` props — the base component merges them
 * internally. No deep-merge happens at read-time; the base component owns its
 * own shape.
 *
 * This is unrelated to `modifier.extend`, which composes ordered child specs
 * top-down within a single component's render tree.
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

async function resolveSpecDocument(specPath) {
    const absolutePath = pathResolve(specPath);
    const document = yaml.load(await readFile(absolutePath, {encoding: 'utf-8'}), {}) ?? {};
    const resolved = structuredClone(document);
    for (const key of specificationKeys) {
        const current = resolved?.[key];
        const base = current?.base;
        if (!current || !isSpecFileReference(base)) continue;
        // Tag the primitive with the absolute base path so the generator can
        // import it, and with a relative path suitable for import statements.
        const absoluteBase = pathResolve(dirname(absolutePath), base);
        resolved[key].__specBase = absoluteBase;
        resolved[key].__specBaseRelative = rebasePath(dirname(absolutePath), absoluteBase);
        // Remove the raw base string so downstream code only sees __specBase.
        delete resolved[key].base;
    }
    return resolved;
}

export async function specToJSON(specPath) {
    return resolveSpecDocument(specPath);
}
