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
import {
    getEffects,
    getExtend,
    getFeed,
    getFrame,
    getLeft,
    getProps,
    getRight,
    getStates,
    getStyles
} from "./modifier.mjs";
import {dirname as pathDirname, relative as pathRelative, resolve as pathResolve, sep as pathSep} from 'node:path';
import {getTemplateSelected} from "../utils/config.mjs";
import {TEMPLATE_MAPPING} from "./templates/mapping.mjs";
import {containsLogicReference, containsNavigationAction} from '../compiler/behavior.mjs';
import {ensureServiceFile, relativeImport, specStructure} from '../generators/project-structure.mjs';

const template = getTemplateSelected();

const reactAssetPath = value => typeof value === 'string'
    ? value.replace(/asset:\/\/figma\//g, '/images/figma/')
    : value;

const reactStyleAssets = styles => {
    const normalized = Object.fromEntries(
        Object.entries(styles ?? {})
            .filter(([key, value]) => value !== undefined && value !== null && !['fallbackWidth', 'fallbackHeight'].includes(key))
            .map(([key, value]) => [key, reactAssetPath(value)])
    );
    normalized.boxSizing = 'border-box';
    normalized.minWidth ??= 0;
    if (`${normalized.width ?? ''}`.trim() === '100%') normalized.maxWidth = '100%';
    return normalized;
};

function defaultOnFrameColumn(styles) {
    return `{${JSON.stringify({
        ...reactStyleAssets(styles),
        ...{display: 'flex', flexDirection: 'column'}
    })}}`;
}

function defaultOnFrameRow(styles) {
    return `{${JSON.stringify({
        ...reactStyleAssets(styles),
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
    const {base, styles = {}, id = ''} = frame ?? {};
    // console.log(id, '------');
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
 * @param data {object}
 * @param onChild {(boolean)=>*}
 * @return {string}
 */
export function getConditionFrameStatement(data, onChild) {
    const frame = getFrame(data);
    const styles = getStyles(data);
    const column = `{${JSON.stringify({
        ...reactStyleAssets(styles),
        display: 'flex', flexDirection: 'column',
    })}}`;
    const row = `{${JSON.stringify({
        ...reactStyleAssets(styles),
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
    }
        // else if (`${base}` === 'text') {
        //     return 'div';
    // }
    else if (`${base}` === 'input' || (`${base}` === 'container' && data?.modifier?.props?.control === 'input')) {
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
    const targetValue = value => typeof value === 'string'
        ? value.replace(/^asset:\/\/figma\//, '/images/figma/')
        : value;
    const actionStatement = (action, eventName = 'event') => {
        if (`${action?.action ?? ''}`.startsWith('navigation.')) {
            const route = {...action};
            delete route.action;
            return `setCurrentRoute(${JSON.stringify(route)})`;
        }
        if (action?.action === 'state.set' && action.target) {
            const value = action.value === 'event.value'
                ? `(${eventName}?.target?.value ?? ${eventName})`
                : JSON.stringify(action.value);
            return `set${firstUpperCase(action.target)}(${value})`;
        }
        return '';
    };
    const eventExpression = action => {
        const actions = action?.action === 'sequence' ? action.actions ?? [] : [action];
        const statements = actions.map(action => actionStatement(action, 'event')).filter(Boolean);
        return `(event)=>{${statements.map(statement => `${statement};`).join('')}}`;
    };
    const getValue = ifDoElse(
        v => `${v}`.trim().toLowerCase().startsWith('states.'),
        v => `${v}`.trim().replace(/^(states.)/ig, '')
            .replace(/asset:\/\/figma\/([a-zA-Z0-9._-]+)/g, "'/images/figma/$1'"),
        ifDoElse(
            v => `${v}`.trim().toLowerCase().startsWith('inputs.'),
            v => `${v}`.trim().replace(/^(inputs.)/ig, '')
                .replace(/asset:\/\/figma\/([a-zA-Z0-9._-]+)/g, "'/images/figma/$1'"),
            ifDoElse(
                v => /^(?:logics|services)\./i.test(`${v}`.trim()),
                ifDoElse(
                    x => `${x}`.trim().endsWith('()'),
                    x => `${`${x}`.trim().replace(/^(?:logics|services)\.|\(\)/ig, '')}({component,args:[]})`,
                    x => `(...args)=>${`${x}`.trim().replace(/^(?:logics|services)\.|\(\)/ig, '')}({component,args})`
                ),
                ifDoElse(
                    t => `${t}`.startsWith("'_'+"),
                    t => `${t}`,
                    t => `${JSON.stringify(targetValue(t) ?? '')}`
                        .replaceAll(/^"|"$/ig, "'")
                ),
            )
        )
    );
    return Object
        .keys(props)
        .filter(k => props[k] !== undefined && props[k] !== null && k !== 'control')
        .map(k => {
            const value = props[k];
            if (/^on[A-Z]/.test(k) && value && typeof value === 'object') {
                return `${k}={${eventExpression(value)}}`;
            }
            return `${k}={${getValue(value)}}`;
        })
        .join('\n\t\t\t')
}

export function getActionImportStatement(data, unParsedPath) {
    if (template !== 'reactjs' || !containsNavigationAction(data)) return '';
    const outputPath = pathResolve(getSrcPathFromBlueprintPath(unParsedPath));
    const routingPath = pathResolve(process.cwd(), 'src', 'routing.mjs');
    let importPath = pathRelative(pathDirname(outputPath), routingPath).split(pathSep).join('/');
    if (!importPath.startsWith('.')) importPath = `./${importPath}`;
    return `import {setCurrentRoute} from '${importPath}';`;
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
export function getStatesStatement(data, specPath) {
    const states = getStates(data);
    if (template === 'reactjs' && specPath && Object.keys(states).length > 0) {
        const componentName = specStructure(specPath, 'reactjs').componentName;
        const initialState = Object.fromEntries(Object.entries(states).map(([key, value]) => [
            key,
            /^(inputs\.)/i.test(`${value}`.trim())
                ? {__expression: `${value}`.replace(/^(inputs\.)/i, '')}
                : value
        ]));
        const initialExpression = `{${Object.entries(initialState).map(([key, value]) =>
            `${JSON.stringify(key)}:${value && typeof value === 'object' && '__expression' in value ? value.__expression : JSON.stringify(value)}`
        ).join(',')}}`;
        const declarations = Object.keys(states).flatMap(key => [
            `const ${key}=componentState.${key};`,
            `const set${firstUpperCase(key)}=React.useCallback((next)=>setComponentState((current)=>({${key}:typeof next==='function'?next(current.${key}):next})),[setComponentState]);`
        ]);
        return `const [componentState,setComponentState]=useModuleState(${JSON.stringify(componentName)},${initialExpression});\n\t${declarations.join('\n\t')}`;
    }
    const getStateIV = k => /^(inputs\.)/ig.test(`${states[k]}`.trim())
        ? `${states[k]}`.replace(/^(inputs.)/ig, '')
        : JSON.stringify(states[k]);
    return TEMPLATE_MAPPING.statesPresentation[template](states, getStateIV);
}

export function getModuleStoreImportStatement(data, specPath) {
    if (template !== 'reactjs' || Object.keys(getStates(data)).length === 0) return '';
    const outputPath = pathResolve(getSrcPathFromBlueprintPath(specPath));
    const storePath = specStructure(specPath, 'reactjs').storePath;
    return `import {useModuleState} from '${relativeImport(outputPath, storePath)}';`;
}

/**
 * @param data{*}
 * @return {string}
 * */
export function getEffectsStatement(data) {
    const effects = getEffects(data);
    const getDependencies = k => sanitizeEffectDependency(effects[k]?.watch);
    const getBody = k => /^(?:logics|services)\./i.test(`${effects[k]?.body}`.trim())
        ? `${effects[k]?.body}`.trim().replace(/^(?:logics|services)\.|\(\)/ig, '')
        : effects[k]?.body ?? '{}';
    return TEMPLATE_MAPPING.sideEffectsPresentation[template](effects, getBody, getDependencies);
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
    return TEMPLATE_MAPPING.inputsPresentation[template](inputs);
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
    if (!containsLogicReference(data) && Object.keys(getEffects(data)).length === 0) return '';
    const useMemoDependencies = getUseMemoDependencies(data);
    const statesMap = getStateMapForLogicInput(getStates(data));
    const inputsMap = getInputsMapForLogicInput(data);
    const effects = getEffects(data);
    const ignoreComment = Object.keys(effects).length > 0
        ? ''
        : '// eslint-disable-next-line no-unused-vars\n';
    return `${ignoreComment}const component = React.useMemo(()=>({states:{${statesMap}},inputs:{${inputsMap}}}),[${useMemoDependencies}]);`;
}

/**
 *
 * @param data {*} map of the specification
 * @param unParsedPath {string} specification path
 * @param projectPath {string} project root path
 * @return {Promise<string>}
 */
export async function getLogicsImportStatement(data = {}, unParsedPath = '', projectPath = '') {
    const filter = x => /^(?:logics|services)\./i.test(`${x}`.trim());
    const map = x => `${x}`.trim().replace(/^(?:logics|services)\.|\(\)/ig, '');
    const getStyleInputs = ifDoElse(
        x => /^(?:logics|services)\./i.test(`${x}`.trim()),
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
                .replace(/^(?:logics|services)\.|\(\)/ig, '')
        ]
    }, []);
    const exports = Array.from([...propsInputs, ...effectsInputs, ...styleInputs].reduce((a, b) => a.add(b), new Set()));
    if (exports.length === 0) return '';

    const structure = specStructure(unParsedPath, 'reactjs');
    const servicePath = await ensureServiceFile({
        servicePath: structure.servicePath,
        legacyPath: structure.legacyServicePath,
        functions: exports,
        template: 'reactjs'
    });
    const outputPath = pathResolve(getSrcPathFromBlueprintPath(unParsedPath));
    return `import {${exports.join(',')}} from '${relativeImport(outputPath, servicePath)}';`;
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
                v => /^(?:logics|services)\./i.test(`${v}`.trim()),
                v => `${`${v}`.trim().replace(/^(?:logics|services)\.|\(\)/ig, '')}({component,args: []})`,
                v => `${JSON.stringify(typeof v === 'string' ? v.replace(/asset:\/\/figma\//g, '/images/figma/') : v ?? '')}`.trim()
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
    const style = getStyles(data);
    const stateDep = Object.values(style)
        .filter(x => `${x}`.trim().toLowerCase().startsWith('states.'))
        .map(y => `${y}`.replaceAll('states.', '').trim())
    const inputDep = Object.values(style)
        .filter(x => `${x}`.trim().toLowerCase().startsWith('inputs.'))
        .map(y => `${y}`.replaceAll('inputs.', '').trim())
    const hasLogicDep = Object.values(style)
        .filter(x => /^(?:logics|services)\./i.test(`${x}`.trim()))
        .length > 0;
    const dependencies = Array.from([
        ...stateDep,
        ...inputDep,
        ...[hasLogicDep ? 'component' : undefined]
    ].reduce((a, b) => a.add(b), new Set())).join(',');
    const getStyleStatement = ifDoElse(
        t => /^(?:logics|services)\./i.test(`${t}`.trim()),
        t => `const style = React.useMemo(()=>${`${t}`.replace(/^(?:logics|services)\.|\(\)/ig, '')}({component,args:[]}),[component]);`,
        t => `const style = React.useMemo(()=>(${getStyleMap(t)}),[${dependencies}]);`
    );
    return getStyleStatement(style);
}
