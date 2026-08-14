import {compose, firstUpperCase, snakeToCamel} from '../shared/fn.mjs';
import {resolve as pathResolve, sep as pathSep} from 'node:path';

/**
 * Framework-neutral naming helpers shared by both the React and Flutter
 * generators (e.g. class/function naming from a blueprint path).
 *
 * @param path{string}
 * @return {string}
 */
export function getFilenameFromBlueprintPath(path) {
    return `${pathResolve(path)}`.split(pathSep).pop().replace('.yml', '');
}

export const getFileName = compose(firstUpperCase, snakeToCamel, getFilenameFromBlueprintPath);
