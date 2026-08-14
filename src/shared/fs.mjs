/**
 * Minimal filesystem helpers shared by the translator, generator, and
 * tooling layers. Kept separate from ./fn.mjs so pure helpers never import
 * node:fs.
 */
import {appendFile, mkdir} from 'node:fs/promises';
import {resolve as pathResolve} from 'node:path';

export function ensurePathExist(unParsedPath) {
    const path = pathResolve(unParsedPath);
    return mkdir(`${path}`
        .replace(/([a-zA-Z\d_-]+(.)mjs$)|([a-zA-Z\d_-]+(.)jsx$)/ig, ''), {recursive: true});
}

export async function ensureFileExist(unParsedPath) {
    return await appendFile(pathResolve(unParsedPath), '');
}
