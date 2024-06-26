import {
    compose,
    ensureFileExist,
    ensurePathExist,
    firstUpperCase,
    ifDoElse,
    itOrEmptyList,
    justList,
    snakeToCamel
} from "../utils/index.mjs";
import {getEffects, getExtend, getFeed, getLeft, getProps, getRight, getStates, getStyles} from "./modifier.mjs";
import {appendFile} from "node:fs/promises";
import {join as pathJoin, resolve as pathResolve, sep as pathSep} from 'node:path';
import {pathToFileURL} from 'node:url';

// const getColumnStartFrame = ({column, withStack, onChild}) => {
//     return `
//         <div style=${column}>
//             ${onChild(withStack)}
//             {view}
//         </div>
//     `;
// }

function defaultOnFrameColumn(styles) {
    return `{${JSON.stringify({
        ...styles,
        ...{display: 'flex', flexDirection: 'column'}
    })}}`;
}

function defaultOnFrameRow(styles) {
    return `{${JSON.stringify({
        ...styles,
        ...{display: 'flex', flexDirection: 'row'}
    })}}`;
}

/**
 *
 * @param frame {string|object}
 * @param onChild {(boolean)=>*}
 * @param onFrameColumn
 * @param onFrameRow
 * @return {string}
 */
export function getFrameStatement(frame, onChild, onFrameColumn = defaultOnFrameColumn, onFrameRow = defaultOnFrameRow) {
    const {base, styles = {}, id=''} = frame ?? {};
    console.log(id, '------');
    const frameBase = base ?? frame;
    const column = onFrameColumn(styles);
    const row = onFrameRow(styles);
    const withStack = `${frameBase}`.trim().toLowerCase().includes('.stack');
    if (`${frameBase}`.trim().toLowerCase().startsWith('column.start')) {
        return `
            <div id={'${id}'} style=${column}>
                ${onChild(withStack)}
                {view}
            </div>
        `
    } else if (`${frameBase}`.trim().toLowerCase().startsWith('column.end')) {
        return `
            <div id={'${id}'} style=${column}>
                {view}
                ${onChild(withStack)}
            </div>
        `;
    } else if (`${frameBase}`.trim().toLowerCase().startsWith('row.start')) {
        return `
            <div id={'${id}'} style=${row}>
                ${onChild(withStack)}
                {view}
            </div>
        `;
    } else if (`${frameBase}`.trim().toLowerCase().startsWith('row.end')) {
        return `
            <div id={'${id}'} style=${row}>
                {view}
                ${onChild(withStack)}
            </div>
        `;
    } else {
        return `
            <div id={'${id}'} style=${column}>
                ${onChild(withStack)}
                {view}
            </div>
        `
    }
}

/**
 *
 * @param frame {string|object}
 * @param onChild {(boolean)=>*}
 * @return {string}
 */
export function getConditionFrameStatement(frame, onChild) {
    const column = `{${JSON.stringify({
        display: 'flex', flexDirection: 'column',
    })}}`;
    const row = `{${JSON.stringify({
        display: 'flex', flexDirection: 'row',
    })}}`;
    return getFrameStatement(frame, onChild, () => column, () => row);
}

/**
 *
 * @param data{*}
 * @return {undefined|string}
 */
export function getExtendBase(data) {
    const extend = getExtend(data);
    if (typeof extend === 'string' && extend.includes('.yml')) {
        return firstUpperCase(snakeToCamel(getFilenameFromBlueprintPath(extend)));
    }
    return undefined;
}

/**
 *
 * @param path{string}
 * @return {string}
 */
export function getFilenameFromBlueprintPath(path) {
    return `${pathResolve(path)}`.split(pathSep).pop().replace('.yml', '');
}

export /**
 * @param unParsedPath{string}
 * @return {string}
 * */
function getSrcPathFromBlueprintPath(unParsedPath) {
    const path = pathResolve(unParsedPath).replace(process.cwd(), '.');
    const pathParts = `${path}`.split(pathSep).filter(x => x !== 'blueprints');
    return `${pathParts.join(pathSep)}`
        .replace(/(.yml)/ig, '.jsx');
}

/**
 *
 * @param data {*}
 * @return {string}
 */
export function getBase(data) {
    const base = data?.base ?? '';
    if (`${base}` === 'image') {
        return 'img';
    } else if (`${base}` === 'text') {
        return 'span';
    } else if (`${base}` === 'input') {
        return 'input';
    } else {
        return 'div';
    }
}

/**
 *
 * @param data{*}
 * @return {string}
 */
export function getPropsStatement(data) {
    const props = getProps(data);
    const getValue = ifDoElse(
        v => `${v}`.trim().toLowerCase().startsWith('states.'),
        v => `${v}`.trim().replace(/^(states.)/ig, ''),
        ifDoElse(
            v => `${v}`.trim().toLowerCase().startsWith('inputs.'),
            v => `${v}`.trim().replace(/^(inputs.)/ig, ''),
            ifDoElse(
                v => `${v}`.trim().toLowerCase().startsWith('logics.'),
                ifDoElse(
                    x => `${x}`.trim().endsWith('()'),
                    x => `${`${x}`.trim().replace(/^(logics.)|\(\)/ig, '')}({component,args:[]})`,
                    x => `(...args)=>${`${x}`.trim().replace(/^(logics.)|\(\)/ig, '')}({component,args})`
                ),
                ifDoElse(
                    t => `${t}`.startsWith("'_'+"),
                    t => `${t}`,
                    t => `${JSON.stringify(t ?? '')}`.trim()
                ),
            )
        )
    );
    return Object
        .keys(props)
        .filter(k => props[k] !== undefined && props[k] !== null)
        .map(k => `${k}={${getValue(props[k])}}`)
        .join('\n\t\t\t')
}

/**
 *
 * @param data {*}
 * @param viewWithoutExtend {string}
 * @return {function(boolean): string|*}
 */
export function prepareGetContentView({data, viewWithoutExtend}) {
    const base = getBase(data);
    const propsString = getPropsStatement(data);
    const extendBase = getExtendBase(data);

    return function (withStack) {
        const contentViewWithExtend = withStack === true
            ? `<${base}  style={style} ${propsString}><${extendBase} loopIndex={loopIndex} loopElement={loopElement}></${extendBase}></${base}>`
            : `<${extendBase} loopIndex={loopIndex} loopElement={loopElement} view={${viewWithoutExtend}}></${extendBase}>`;

        return extendBase ? contentViewWithExtend : viewWithoutExtend;
    };
}

export const getFileName = compose(firstUpperCase, snakeToCamel, getFilenameFromBlueprintPath);

/**
 * @param data{*}
 * @return {string}
 * */
export function getStatesStatement(data) {
    const states = getStates(data);
    const getState = k => `${states[k]}`.trim().toLowerCase().startsWith('inputs.')
        ? `${states[k]}`.trim().replace(/^(inputs.)/ig, '')
        : JSON.stringify(states[k])
    return Object
        .keys(states ?? {})
        .map(k => `const [${k},set${firstUpperCase(k)}] = React.useState(${getState(k)});`)
        .join('\n\t');
}

function sanitizeEffectDependency(watch) {
    const mapWatch = watchItem => {
        if (`${watchItem}`.trim().toLowerCase().startsWith('states.')) {
            return `${watchItem}`.replace(/^(states.)/ig, '');
        }
        if (`${watchItem}`.trim().toLowerCase().startsWith('inputs.')) {
            return `${watchItem}`.replace(/^(inputs.)/ig, '');
        }
        return watchItem === undefined ? undefined : `"${watchItem}"`
    };
    return Array.isArray(watch) ? watch.map(mapWatch).join(',') : mapWatch(watch);
}

/**
 * @param data{*}
 * @return {string}
 * */
export function getEffectsStatement(data) {
    const effects = getEffects(data);
    const getDependencies = k => sanitizeEffectDependency(effects[k]?.watch);
    const getBody = k => `${effects[k]?.body}`.trim().toLowerCase().startsWith('logics.')
        ? `${effects[k]?.body}`.trim().replace(/^(logics.)|\(\)/ig, '')
        : effects[k]?.body ?? '{}';
    return Object
        .keys(effects ?? {})
        .map(k => `/*${k}*/
    React.useEffect(()=>${getBody(k)}({component,args:[]}),
    /* eslint-disable-line react-hooks/exhaustive-deps */[${getDependencies(k) ?? ``}]);`)
        .join('\n\t');
}

/**
 *
 * @param data
 * @return {string}
 */
export function getInputsStatement(data = {}) {
    const filter = x => `${x}`.trim().toLowerCase().startsWith('inputs.');
    const map = x => `${x}`.trim().replace(/^(inputs.)/ig, '');
    const styleInputs = Object.values(getStyles(data)).filter(filter).map(map);
    const propsInputs = Object.values(getProps(data)).filter(filter).map(map);
    const statesInputs = Object.values(getStates(data)).filter(filter).map(map);
    const effects = getEffects(data);
    const effectsInputs = Object.keys(effects).reduce((a, b) => {
        return [
            ...a,
            ...itOrEmptyList(effects[b]?.watch).filter(filter).map(map)
        ]
    }, []);
    let inputs = propsInputs.concat(statesInputs, effectsInputs, styleInputs, ['view', 'loopElement', 'loopIndex']);
    inputs = inputs.filter(x => !`${x}`.trim().startsWith('loopElement.'));
    return Array.from(inputs.reduce((a, b) => a.add(b), new Set())).join(',');
}

/**
 *
 * @param data {*}
 * @return {string}
 */
export function getUseMemoDependencies(data) {
    return [
        ...Object.keys(getStates(data)),
        getInputsStatement(data).split(',')
    ].join(',');
}

function getStateMapForLogicInput(states) {
    return Object.keys(states).reduce((a, b) => {
        return [
            ...a,
            `"${b}":${b}, "set${firstUpperCase(b)}": set${firstUpperCase(b)}`
        ]
    }, []).join(',');
}

function getInputsMapForLogicInput(data) {
    return getInputsStatement(data)
        .split(',')
        .filter(x => x !== '')
        .map(b => `"${b}":${b}`)
        .join(',');
}

/**
 *
 * @param data {*}
 * @return {string}
 */
export function getComponentMemoStatement(data) {
    const useMemoDependencies = getUseMemoDependencies(data);
    const statesMap = getStateMapForLogicInput(getStates(data));
    const inputsMap = getInputsMapForLogicInput(data);
    return `// eslint-disable-next-line no-unused-vars\nconst component = React.useMemo(()=>({states:{${statesMap}},inputs:{${inputsMap}}}),[${useMemoDependencies}]);`;
}

/**
 *
 * @param data {*} map of the specification
 * @param unParsedPath {string} specification path
 * @param projectPath {string} project root path
 * @return {Promise<string>}
 */
export async function getLogicsImportStatement(data = {}, unParsedPath = '', projectPath = '') {
    const cwd = process.cwd();
    const path = pathResolve(unParsedPath).replace(cwd, '.');
    const pathParts = `${path}`.split(pathSep);
    pathParts.pop();
    const pathSteps = pathParts
        .filter(x => x !== 'blueprints' && x !== '.')
        .map(_ => '..');
    const filter = x => `${x}`.trim().toLowerCase().startsWith('logics.');
    const map = x => `${x}`.trim().replace(/^(logics.)|\(\)/ig, '');
    const getStyleInputs = ifDoElse(
        x => `${x}`.trim().toLowerCase().startsWith('logics.'),
        compose(justList, map),
        x => Object.values(x).filter(filter).map(map)
    );
    const styleInputs = getStyleInputs(getStyles(data));
    const propsInputs = Object.values(getProps(data)).filter(filter).map(map);
    const effects = getEffects(data);
    const effectsInputs = Object.keys(effects).reduce((a, b) => {
        return [
            ...a,
            `${effects[b]?.body}`
                .trim()
                .replace(/^(logics.)|\(\)/ig, '')
        ]
    }, []);
    const exports = Array.from([...propsInputs, ...effectsInputs, ...styleInputs].reduce((a, b) => a.add(b), new Set()));

    const logicFileName = getFilenameFromBlueprintPath(path).trim() + '.mjs';
    const logicImportPath = pathJoin(
        pathSteps.join(pathSep), pathParts.join(pathSep), '.', 'logics', logicFileName
    );
    const logicFolderPath = pathJoin(pathParts.join(pathSep), '.', 'logics');
    await ensurePathExist(logicFolderPath);
    await ensureFileExist(pathJoin(logicFolderPath, logicFileName));
    try {
        const importedLogic = await import(pathToFileURL(pathJoin(projectPath, logicFolderPath, logicFileName)));
        for (const e of exports) {
            if (importedLogic[e] === undefined) {
                await appendFile(pathJoin(logicFolderPath, logicFileName), `
/**
* @param data {
* {component: {states: *,inputs: *}, args: Array<*>}
* }
*/
export function ${e}(data) {
    // TODO: Implement the logic
    // throw new Error('Method ${e} not implemented');
}`)
            }
        }
    } catch (e) {
        console.log(e);
    }
    return `import {${exports?.join(',')}} from '${logicImportPath?.split(pathSep)?.join('/')}';`
}

/**
 *
 * @param data {*}
 * @return {string}
 */
export function getComponentsImportStatement(data) {
    const extend = getExtend(data);
    const left = getLeft(data);
    const right = getRight(data);
    const feed = getFeed(data);

    return [extend, left, right, feed].map(x => {
        if (typeof x === 'string' && x.endsWith('.yml')) {
            const component = firstUpperCase(snakeToCamel(getFilenameFromBlueprintPath(x)));
            const importPath = `${x}`.trim().startsWith('.') ? x : `./${x}`;
            return `import {${component}} from '${importPath.replace('.yml', '.jsx')}';`;
        }
        return null;
    }).filter(y => y !== null).join('\n');
}

function getStyleMap(style) {
    const getValue = ifDoElse(
        v => `${v}`.trim().toLowerCase().startsWith('states.'),
        v => `${v}`.trim().replace(/^(states.)/ig, ''),
        ifDoElse(
            v => `${v}`.trim().toLowerCase().startsWith('inputs.'),
            v => `${v}`.trim().replace(/^(inputs.)/ig, ''),
            ifDoElse(
                v => `${v}`.trim().toLowerCase().startsWith('logics.'),
                v => `${`${v}`.trim().replace(/^(logics.)|\(\)/ig, '')}({component,args: []})`,
                v => `${JSON.stringify(v ?? '')}`.trim()
            )
        )
    );
    const styleParts = Object.keys(style).reduce((a, b) => {
        return [
            ...a,
            `"${b}":${getValue(style[b])}`
        ]
    }, []);
    return `{${styleParts.join(',')}}`;
}

export function getStyleStatement(data) {
    // const useMemoDependencies = getUseMemoDependencies(data);

    const style = getStyles(data);
    const stateDep = Object.values(style)
        .filter(x => `${x}`.trim().toLowerCase().startsWith('states.'))
        .map(y => `${y}`.replaceAll('states.', '').trim())
    const inputDep = Object.values(style)
        .filter(x => `${x}`.trim().toLowerCase().startsWith('inputs.'))
        .map(y => `${y}`.replaceAll('inputs.', '').trim())
    const hasLogicDep = Object.values(style)
        .filter(x => `${x}`.trim().toLowerCase().startsWith('logics.'))
        .length > 0;
    const dependencies = Array.from([
        ...stateDep,
        ...inputDep,
        ...[hasLogicDep ? 'component' : undefined]
    ].reduce((a, b) => a.add(b), new Set())).join(',');
    const getStyleStatement = ifDoElse(
        t => `${t}`.trim().toLowerCase().startsWith('logics.'),
        t => `const style = React.useMemo(()=>${`${t}`.replace(/^(logics.)|\(\)/ig, '')}({component,args:[]}),[component]);`,
        t => `const style = React.useMemo(()=>(${getStyleMap(t)}),[${dependencies}]);`
    );
    return getStyleStatement(style);
}