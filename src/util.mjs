import {mkdir} from 'node:fs/promises'

export function snakeToCamel(str) {
    const a = `${str}`
        .replace(/_([a-z])/ig, (_, letter) => letter.toUpperCase());
    return a.charAt(0).toUpperCase() + a.slice(1);
}

export function ensurePathExist(path) {
    return mkdir(`${path}`.replace(/[a-zA-Z_]+(.)mjs$/ig, ''), {recursive: true});
}