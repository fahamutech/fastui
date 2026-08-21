/**
 * Reads FastUI YAML spec files off disk. A spec-file `base` is deliberately
 * preserved: both generators treat it as direct component reuse.
 *
 * This is unrelated to `modifier.extend`, which composes ordered child specs
 * top-down within a single component's render tree.
 */
import {glob} from "glob";
import * as yaml from "js-yaml"
import {readFile} from 'node:fs/promises'
import {resolve as pathResolve, sep as pathSep} from 'node:path'

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

export async function specToJSON(specPath) {
    return yaml.load(await readFile(pathResolve(specPath), {encoding: 'utf-8'}), {}) ?? {};
}

export async function specToFlutterJSON(specPath) {
    // Flutter uses the same direct component-reuse contract as React.
    return yaml.load(await readFile(pathResolve(specPath), {encoding: 'utf-8'}), {}) ?? {};
}
