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

// export const justIt = x => x;

export const compose = (...fns) =>
    (...args) =>
        fns.reduceRight((res, fn) => [fn(...res)], args)[0];

// export function composeAsync(...fns) {
//     const _reversed = fns.reverse();
//     return async function a(...args) {
//         let _args = args;
//         for (const fn of _reversed) {
//             _args = [await fn.call(null, ..._args)];
//         }
//         return _args[0];
//     }
// }

// export const copyJson = (x) => JSON.parse(JSON.stringify(x));

// export const propertyOr = (property, orFn) =>
//     data =>
//         typeof data === 'object' && data !== null && data !== undefined && data.hasOwnProperty(property)
//             ? data[property]
//             : orFn(data);
// export const propertyOrNull = property => propertyOr(property, _ => null);

// export const doMap = fn => x => x.map(fn);

const objectConstructor = ({}).constructor;
// export const appendIt = (property, it) => ifDoElse(
//     x => x && x.constructor === objectConstructor,
//     x => Object.assign(x, {[property]: it}),
//     _ => ({[property]: it})
// );

// export const appendItFn = (property, itFn) => ifDoElse(
//     x => x && x.constructor === objectConstructor,
//     x => Object.assign(x, {[property]: itFn(x)}),
//     _ => ({[property]: itFn(_)})
// );

// export const replaceItFn = (property, replacer, itFn) => ifDoElse(
//     x => x && x.constructor === objectConstructor,
//     x => {
//         const o = Object.assign(x, {[replacer]: itFn(x)});
//         delete o[property];
//         return o;
//     },
//     _ => ({[property]: itFn(_)})
// );

// export const removeIt = property => ifDoElse(
//     x => x && x.constructor === objectConstructor,
//     x => {
//         delete x[property];
//         return x;
//     },
//     _ => _
// );

// export const pushItFn = (property, itFn) => ifDoElse(
//     x => x && x.constructor === objectConstructor,
//     x => {
//         Array.isArray(x[property]) ? x[property].push(itFn(x)) : x[property] = [itFn(x)];
//         return x;
//     },
//     _ => ({[property]: [itFn(_)]})
// );

export const ifDoElse = (fn, fn1, fn2) => (arg) =>
    fn(arg) === true
        ? fn1(arg)
        : fn2(arg);

// export const ifDo = (fn, doFn) => arg => fn(arg) === true ? doFn(arg) : justIt(arg);

// export const ifThrow = (fn, tFn) => ifDoElse(fn, x => {
//     throw tFn(x);
// }, x => x);

// export const isFALSE = x => x === false;
// export const justNOT = x => !x;
// export const isTRUE = x => x === true;
export const justObject = ifDoElse(x => x && x.constructor === objectConstructor, x => x, _ => ({}));
// export const justZero = _ => 0;

// export const responseWithError = (response, code = 400) => (error) => {
//     const getMessage = propertyOr('message', (x) => x ? x.toString() : null);
//     console.log(error);
//     response.status(code).json({message: getMessage(error)});
// }

// export const responseWithOkJson = (response, code = 200) => (value) => {
//     response.status(code).json(value);
// }

// export const responseWithUiError = (response, uiFn, code = 400) => error => {
//     console.log(error);
//     response.status(code).send(uiFn(error));
// }

export const itOrEmptyList = list => Array.isArray(list) ? list : [];

// export const doReturnIt = (doFn, itFn) => x => compose(_ => itFn(x), doFn)(x);
// export const debugTrace = x => {
//     console.log(x);
//     return x;
// }
// export const copyJsonMap = compose(x => ({...x}), justObject);
//
// export const justSome = x => _ => x;
// export const equalTo = it => data => data === it;
export const justList = it => Array.isArray(it) ? it : [it];
// export const prepareGetFieldExists = field => x => justObject(x).hasOwnProperty(field);

// export const elementAt = i => arr => itOrEmptyList(arr)[i];

export function justString(x){
    return `${x??Math.random()}`;
}

export function maybeRandomName(x){
    return (x==='' || x===null || x===undefined)?justString():x;
}

export function removeWhiteSpaces(x){
    return x;
    // return `${x??''}`.replace(/\s+/ig, ' ');
}

export function sanitizeFullColon(x){
    return `${x}`
        .replaceAll(/^'|^"|'$|"$/g, '')
        .replaceAll(':', '_');
}