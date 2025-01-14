import {appendFile, mkdir} from 'node:fs/promises'
import {resolve as pathResolve} from "node:path";

export function snakeToCamel(str) {
    return `${str}`
        .replace(/_([a-z])/ig, (_, letter) => letter.toUpperCase());
}

/**
 *
 * @param str{string}
 * @return {string}
 */
export function firstUpperCase(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 *
 * @param str{string}
 * @return {string}
 */
export function firstUpperCaseRestSmall(str) {
    if (!str) {
        return undefined;
    }
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

export function ensurePathExist(unParsedPath) {
    const path = pathResolve(unParsedPath);
    return mkdir(`${path}`
        .replace(/([a-zA-Z\d_-]+(.)mjs$)|([a-zA-Z\d_-]+(.)jsx$)/ig, ''), {recursive: true});
}

export async function ensureFileExist(unParsedPath) {
    return await appendFile(pathResolve(unParsedPath), '');
}

export const compose = (...fns) =>
    (...args) =>
        fns.reduceRight((res, fn) => [fn(...res)], args)[0];

const objectConstructor = ({}).constructor;

export const ifDoElse = (fn, fn1, fn2) => (arg) =>
    fn(arg) === true
        ? fn1(arg)
        : fn2(arg);

export const justObject = ifDoElse(x => x && x.constructor === objectConstructor, x => x, _ => ({}));

export const itOrEmptyList = list => Array.isArray(list) ? list : [];

export const justList = it => Array.isArray(it) ? it : [it];

export function justString(x) {
    return `${x ?? Math.random()}`;
}

export function maybeRandomName(x) {
    return (x === '' || x === null || x === undefined) ? justString() : x;
}

export function removeWhiteSpaces(x) {
    return x;
    // return `${x??''}`.replace(/\s+/ig, ' ');
}

export function sanitizeFullColon(x) {
    return `${x}`
        .replaceAll(/^'|^"|'$|"$/g, '')
        .replaceAll(':', '_');
}