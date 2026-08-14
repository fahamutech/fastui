/**
 * React/JSX code generation. Everything framework-specific for the reactjs
 * target lives here (mirrors templates/flutter/generator.mjs); component.mjs,
 * condition.mjs and loop.mjs are thin dispatchers that pick this generator or
 * the Flutter one based on the selected template.
 */
import {
    compose,
    firstUpperCase,
    ifDoElse,
    itOrEmptyList,
    justList,
    removeWhiteSpaces,
    snakeToCamel,
} from "../../../shared/fn.mjs";
import {ensurePathExist} from "../../../shared/fs.mjs";
import {
    getChildren,
    getEffects,
    getExtend,
    getFeed,
    getFrame,
    getLeft,
    getProps,
    getRight,
    getStates,
    getStyles,
    getWrapper,
} from "../../modifier.mjs";
import {dirname as pathDirname, relative as pathRelative, resolve as pathResolve, sep as pathSep} from 'node:path';
import {writeFile} from 'node:fs/promises';
import {getTemplateSelected} from "../../../tooling/config.mjs";
import {TEMPLATE_MAPPING} from "../mapping.mjs";
import {containsLogicReference, containsNavigationAction} from '../../behavior.mjs';
import {ensureServiceFile, relativeImport, specStructure} from '../../project-structure.mjs';
import {getFileName, getFilenameFromBlueprintPath} from '../../naming.mjs';

const template = getTemplateSelected();

const reactAssetPath = value => typeof value === 'string'
    ? value.replaceAll('asset://figma/', '/images/figma/')
    : value;

const reactStyleAssets = styles => {
    const spaceValue = styles?.spaceValue;
    const normalized = Object.fromEntries(
        Object.entries(styles ?? {})
            .filter(([key, value]) => value !== undefined && value !== null && !['fallbackWidth', 'fallbackHeight', 'spaceValue', 'childDirection'].includes(key))
            .map(([key, value]) => [key, reactAssetPath(value)])
    );
    normalized.boxSizing = 'border-box';
    normalized.minWidth ??= 0;
    if (spaceValue > 0) normalized.gap = spaceValue;
    if (`${normalized.width ?? ''}`.trim() === '100%') normalized.maxWidth = '100%';
    return normalized;
};

function frameDirection(base) {
    return `${base ?? ''}`.trim().toLowerCase().startsWith('row') ? 'row' : 'column';
}

function frameIsEnd(base) {
    return `${base ?? ''}`.trim().toLowerCase().includes('.end');
}

function frameIsStack(base) {
    return `${base ?? ''}`.trim().toLowerCase().includes('.stack');
}

// The subset of a frame's real styles that must travel with the wrapper div,
// since the wrapper (not the frame) is the box exposed as a flex item to
// whichever sibling/parent composes this node.
function participationStyles(styles = {}) {
    const {flex, width, height} = styles ?? {};
    return {flex, width, height};
}

/**
 * Real, own-axis styles for this node's frame div (background, padding,
 * alignment, sizing, etc). Own axis is frame.base, distinct from the
 * sibling-facing wrapper axis.
 * @param frame {{base,styles}}
 * @return {string}
 */
export function frameStyleString(frame) {
    return `{${JSON.stringify({
        ...reactStyleAssets(frame?.styles ?? {}),
        display: 'flex',
        flexDirection: frameDirection(frame?.base),
    })}}`;
}

/**
 * Renders the positional wrapper div (driven by the PARENT/sibling axis) that
 * places this node's own frame/composition chain next to the {view} slot used
 * by whoever further composes this node.
 *
 * @param frame {{base,id,styles}} this node's own frame (used for id/styles fallback)
 * @param wrapper {{base,id}} sibling axis; falls back to frame.base/id when absent
 * @param onChild {(boolean)=>*} returns this node's own composed content, given `withStack`
 * @return {string}
 */
export function getFrameStatement(frame, wrapper, onChild) {
    const frameId = frame?.id ?? '';
    const wrapperBase = wrapper?.base ?? frame?.base ?? frame;
    const wrapperId = wrapper?.id ?? (frameId ? `${frameId}_wrapper` : '');
    const withStack = frameIsStack(wrapperBase);
    const wrapperStyle = `{${JSON.stringify({
        ...reactStyleAssets(participationStyles(frame?.styles)),
        display: 'flex',
        flexDirection: frameDirection(wrapperBase),
    })}}`;
    const child = onChild(withStack);
    const ordered = frameIsEnd(wrapperBase) ? `{view}${child}` : `${child}{view}`;
    return `<div id={'${wrapperId}'} style=${wrapperStyle}>${ordered}</div>`;
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
 * @param unParsedPath{string}
 * @return {string}
 */
export function getSrcPathFromBlueprintPath(unParsedPath) {
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
    } else if (`${base}` === 'input' || (`${base}` === 'container' && data?.modifier?.props?.control === 'input')) {
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
 * Builds this node's own content (`viewWithoutExtend`), passed as the `view`
 * prop into the extended sibling so it lands next to that sibling's own
 * composition chain, wrapped in a plain `{frameId}_ww` div that only exists
 * to route/name the composed call - it carries no styling of its own.
 *
 * @param data {*}
 * @param viewWithoutExtend {string}
 * @param frameId {string}
 * @return {function(boolean): string|*}
 */
export function prepareGetContentView({data, viewWithoutExtend, frameId = ''}) {
    const base = getBase(data);
    const propsString = getPropsStatement(data);
    const extendBase = getExtendBase(data);

    return function (withStack) {
        if (!extendBase) return viewWithoutExtend;
        if (withStack === true) {
            return `<${base}  style={style} ${propsString}><${extendBase} loopIndex={loopIndex} loopElement={loopElement}></${extendBase}></${base}>`;
        }
        return `<div id={'${frameId}_ww'}><${extendBase} loopIndex={loopIndex} loopElement={loopElement} view={${viewWithoutExtend}}></${extendBase}></div>`;
    };
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

// -- component -------------------------------------------------------------

// This node's own frame: real styles (background, padding, sizing) + own
// direction, wrapping the leaf element. Distinct from the positional wrapper
// (driven by the parent's axis) rendered by getFrameStatement.
function componentOwnFrame(data) {
    const base = getBase(data);
    const frame = getFrame(data);
    const propsString = getPropsStatement(data);
    const children = getChildren(data);
    const leaf = `
        <${base}
            style={style}
            ${propsString}
        >${children?.type === 'state' || children?.type === 'input' ? `{${children?.value}}` : `${children?.value}`}</${base}>
    `;
    return `<div id={'${frame?.id ?? ''}'} style=${frameStyleString(frame)}>${leaf}</div>`;
}

/**
 * @param data {*} map of the specification
 * @param path {string} specification path
 * @param projectPath {string} project root path
 * @return {Promise<void>}
 */
export async function composeReactComponent({data, path, projectPath}) {
    const statesInString = getStatesStatement(data, path)
    const effectsString = getEffectsStatement(data);

    const logicsStatement = await getLogicsImportStatement(data, path, projectPath);
    const storeStatement = getModuleStoreImportStatement(data, path);
    const componentsImportStatement = getComponentsImportStatement(data);
    const actionImportStatement = getActionImportStatement(data, path);
    const componentStatement = getComponentMemoStatement(data);

    const styleStatement = getStyleStatement(data);
    const viewWithoutExtend = componentOwnFrame(data);
    const frame = getFrame(data);

    const content = `
import React from 'react';
${logicsStatement}
${storeStatement}
${componentsImportStatement}
${actionImportStatement}

// eslint-disable-next-line react/prop-types
export function ${getFileName(path)}(${getInputsStatement(data) === '' ? '' : `{${getInputsStatement(data)}}`}){
    ${statesInString}
    
    ${componentStatement}
    
    ${styleStatement}
    
    ${effectsString}
    
    return(${getFrameStatement(frame, getWrapper(data), prepareGetContentView({data, viewWithoutExtend, frameId: frame?.id ?? ''}))});
}
    `;

    const srcPath = getSrcPathFromBlueprintPath(path);
    await ensurePathExist(srcPath);
    await writeFile(srcPath, removeWhiteSpaces(content));
}

// -- condition --------------------------------------------------------------

// This node's own frame: real styles + own direction, wrapping the left/right
// composed call. Distinct from the positional wrapper rendered by
// getFrameStatement, which is driven by the parent's axis.
function conditionOwnFrame(data) {
    const frame = getFrame(data);
    const extend = getExtend(data);
    const left = getLeft(data);
    const right = getRight(data);
    const propsData = structuredClone(data);
    if (propsData?.modifier?.props) delete propsData.modifier.props.id;
    const propsString = getPropsStatement(propsData);
    const styleString = frameStyleString(frame);
    const frameId = frame?.id ?? '';

    const getComponentName = x => firstUpperCase(snakeToCamel(getFilenameFromBlueprintPath(x)));
    const leftComponent = left ? `<div id={'${frameId}'} style=${styleString} ${propsString}><${getComponentName(left)} loopIndex={loopIndex} loopElement={loopElement}/></div>` : '<span/>';
    const rightComponent = right ? `<div id={'${frameId}'} style=${styleString} ${propsString}><${getComponentName(right)} loopIndex={loopIndex} loopElement={loopElement}/></div>` : '<span/>';
    const view = right ? `condition===true?${rightComponent}:${leftComponent}` : leftComponent;
    return extend ? view : `{${view}}`;
}

/**
 * @param data {*} map of the specification
 * @param path {string} specification path
 * @param projectPath {string} project root path
 * @return {Promise<void>}
 */
export async function composeReactCondition({data, path, projectPath}) {
    const statesInString = getStatesStatement(data, path);
    const effectsString = getEffectsStatement(data);
    const componentStatement = getComponentMemoStatement(data);
    const logicsStatement = await getLogicsImportStatement(data, path, projectPath);
    const storeStatement = getModuleStoreImportStatement(data, path);
    const componentsImportStatement = getComponentsImportStatement(data);
    const actionImportStatement = getActionImportStatement(data, path);

    const viewWithoutExtend = conditionOwnFrame(data);
    const frame = getFrame(data);

    const content = `
import React from 'react';
${logicsStatement}
${storeStatement}
${componentsImportStatement}
${actionImportStatement}

// eslint-disable-next-line react/prop-types
export function ${getFileName(path)}({view,loopIndex,loopElement}) {
    ${statesInString}
    
    ${componentStatement}

    ${effectsString}

    return(${getFrameStatement(frame, getWrapper(data), prepareGetContentView({data, viewWithoutExtend, frameId: frame?.id ?? ''}))});
}
    `;

    const srcPath = getSrcPathFromBlueprintPath(path);
    await ensurePathExist(srcPath);
    await writeFile(srcPath, removeWhiteSpaces(content));
}

// -- loop ---------------------------------------------------------------

// This node's own frame: real styles + own direction, wrapping the scrollable
// feed. Distinct from the positional wrapper rendered by getFrameStatement.
function loopOwnFrame(data) {
    const feed = getFeed(data);
    const frame = getFrame(data);
    const scroll = data?.modifier?.props?.scroll;
    const propsData = structuredClone(data);
    if (propsData?.modifier?.props) delete propsData.modifier.props.scroll;
    const propsString = getPropsStatement(propsData);
    const getComponentName = x => firstUpperCase(snakeToCamel(getFilenameFromBlueprintPath(x)));
    const scrollStyle = scroll === 'both'
        ? "{{...style, overflowX: 'auto', overflowY: 'auto'}}"
        : scroll === 'horizontal'
            ? "{{...style, overflowX: 'auto'}}"
            : scroll === 'vertical'
                ? "{{...style, overflowY: 'auto'}}"
                : '{style}';
    const feedDiv = `
        <div 
            style=${scrollStyle}
            ${propsString}
        >
            {data?.map((item,index)=> (<div key={item?._key??keyIndex++}><${getComponentName(feed)} loopIndex={index} loopElement={item}/></div>))}
        </div>
    `;
    if (!feed) return '<span/>';
    return `<div id={'${frame?.id ?? ''}'} style=${frameStyleString(frame)}>${feedDiv}</div>`;
}

/**
 *
 * @param data {*} map of the specification
 * @param path {string} specification path
 * @param projectPath {string} project root path
 * @return {Promise<void>}
 */
export async function composeReactLoop({data, path, projectPath}) {
    const statesInString = getStatesStatement(data, path);
    const effectsString = getEffectsStatement(data);
    const componentMemoStatement = getComponentMemoStatement(data);
    const logicsImportStatement = await getLogicsImportStatement(data, path, projectPath);
    const storeStatement = getModuleStoreImportStatement(data, path);
    const componentsImportStatement = getComponentsImportStatement(data);
    const actionImportStatement = getActionImportStatement(data, path);
    const styleStatement = getStyleStatement(data);

    const viewWithoutExtend = loopOwnFrame(data);
    const frame = getFrame(data);

    const content = `
import React from 'react';
${logicsImportStatement}
${storeStatement}
${componentsImportStatement}
${actionImportStatement}

let keyIndex=0;

// eslint-disable-next-line react/prop-types
export function ${getFileName(path)}({view,loopIndex,loopElement}) {
    ${statesInString}
    
    ${componentMemoStatement}
    
    ${styleStatement}

    ${effectsString}

    return(${getFrameStatement(frame, getWrapper(data), prepareGetContentView({data, viewWithoutExtend, frameId: frame?.id ?? ''}))});
}
    `;

    const srcPath = getSrcPathFromBlueprintPath(path);
    await ensurePathExist(srcPath);
    await writeFile(srcPath, removeWhiteSpaces(content));
}
