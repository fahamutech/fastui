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
    getExtendList,
    getFeed,
    getFrame,
    getLeft,
    getProps,
    getRight,
    getStates,
    getStyles,
    parseLogicReference,
} from "../../modifier.mjs";
import {dirname as pathDirname, relative as pathRelative, resolve as pathResolve, sep as pathSep} from 'node:path';
import {readFile, writeFile} from 'node:fs/promises';
import * as yaml from 'js-yaml';
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

function hasMeaningfulStyleEntries(styles = {}) {
    return Object.entries(styles).some(([, value]) => value !== undefined && value !== null);
}

function frameDirection(base) {
    return `${base ?? ''}`.trim().toLowerCase().startsWith('row') ? 'row' : 'column';
}

function frameIsEnd(base) {
    return `${base ?? ''}`.trim().toLowerCase().includes('.end');
}

function frameIsStack(base) {
    return `${base ?? ''}`.trim().toLowerCase().includes('.stack');
}

/**
 * Real styles for this node's own rendered view (background, padding,
 * alignment, sizing, etc), driven by `frame.current`.
 * @param frame {{base,current}}
 * @return {string}
 */
export function frameCurrentStyleString(frame) {
    return `{${JSON.stringify(reactStyleAssets(frame?.current ?? {}))}}`;
}

/**
 * Ordered `{path, alias}` entries for `modifier.extend`, aliasing the
 * imported component name only when two extend targets share the same
 * generated component name.
 * @param data {*}
 * @return {{path:string, base:string, alias:string}[]}
 */
function extendImportSpecs(data) {
    const paths = getExtendList(data);
    const baseNames = paths.map(path => firstUpperCase(snakeToCamel(getFilenameFromBlueprintPath(path))));
    const counts = baseNames.reduce((map, name) => map.set(name, (map.get(name) ?? 0) + 1), new Map());
    return paths.map((path, index) => {
        const base = baseNames[index];
        const alias = counts.get(base) > 1 ? `${base}_${index}` : base;
        return {path, base, alias};
    });
}

/**
 * Renders the top-down composition for one primitive: this node's own view
 * (styled by `frame.current`) plus one wrapper per `modifier.extend` child
 * (styled uniformly by `frame.next`), ordered and arranged per `frame.base`
 * (row.start/row.end/column.start/column.end/*.stack). `frame.base` is the
 * outer container and always fills the space available to it (`flex: 1`).
 *
 * @return {string}
 * @param frameId
 * @param extraProps
 */
function frameWrapperProps(frameId, extraProps = '') {
    const idProp = frameId ? `id={'${frameId}'}` : '';
    return [idProp, extraProps].filter(Boolean).join(' ');
}

function containerScrollStyles(scroll, baseStyles = {}) {
    const scrollStyles = scroll === 'both'
        ? {overflowX: 'auto', overflowY: 'auto'}
        : scroll === 'horizontal'
            ? {overflowX: 'auto', overflowY: 'hidden'}
            : scroll === 'vertical'
                ? {overflowY: 'auto', overflowX: 'hidden'}
                : {};
    const hasExplicitHeight = baseStyles.height !== undefined || baseStyles.minHeight !== undefined || baseStyles.maxHeight !== undefined;
    const hasExplicitWidth = baseStyles.width !== undefined || baseStyles.minWidth !== undefined || baseStyles.maxWidth !== undefined;
    const hasExplicitFlex = baseStyles.flex !== undefined || baseStyles.flexGrow !== undefined || baseStyles.flexBasis !== undefined;
    if ((scroll === 'vertical' || scroll === 'both') && !hasExplicitHeight && !hasExplicitFlex) {
        scrollStyles.flex = 1;
    }
    if (scroll === 'vertical' || scroll === 'both') {
        scrollStyles.minHeight = 0;
    }
    if ((scroll === 'horizontal' || scroll === 'both') && !hasExplicitWidth) {
        scrollStyles.minWidth = 0;
    }
    return scrollStyles;
}

export function composeFrame(data, frame, ownView, extraProps = '') {
    const extend = extendImportSpecs(data);
    const hasCurrentWrapper = hasMeaningfulStyleEntries(frame?.current ?? {});
    const hasNextWrapper = hasMeaningfulStyleEntries(frame?.next ?? {});
    const hasOwnView = `${ownView ?? ''}`.trim() !== '';
    const current = hasCurrentWrapper
        ? `<div ${frameWrapperProps(frame?.id, extraProps)} style=${frameCurrentStyleString(frame)}>${ownView}</div>`
        : ownView;
    const nextStyle = `{${JSON.stringify(reactStyleAssets(frame?.next ?? {}))}}`;
    const nextViews = extend.map(({alias}, index) => {
        const child = `<${alias} loopIndex={loopIndex} loopElement={loopElement}/>`;
        return hasNextWrapper
            ? `<div id={'${frame?.id ?? ''}_next_${index}'} style=${nextStyle}>${child}</div>`
            : child;
    });

    const hasBaseWrapper = Boolean(frame?.base)
        || hasMeaningfulStyleEntries(frame?.baseStyles ?? {})
        || extend.length > 0
        || hasCurrentWrapper
        || Boolean(extraProps)
        || Boolean(frame?.id);
    if (!hasBaseWrapper) return current;

    const base = frame?.base;
    const baseId = hasCurrentWrapper ? `${frame?.id ?? ''}_base` : frame?.id;
    const baseProps = !hasCurrentWrapper ? extraProps : '';
    const currentItem = hasOwnView || hasCurrentWrapper ? current : '';
    const ordered = frameIsEnd(base)
        ? [...nextViews, ...[currentItem].filter(Boolean)]
        : [...[currentItem].filter(Boolean), ...nextViews];
    const scrollStyles = getFeed(data) ? {} : containerScrollStyles(data?.modifier?.props?.scroll, frame?.baseStyles ?? {});
    const extraBaseStyles = {...reactStyleAssets(frame?.baseStyles ?? {}), ...scrollStyles};
    if (frameIsStack(base)) {
        const layers = ordered
            .map(item => `<div style={{gridArea:'1 / 1'}}>${item}</div>`)
            .join('');
        return `<div ${frameWrapperProps(baseId, baseProps)} style={${JSON.stringify({
            display: 'grid',
            ...extraBaseStyles
        })}}>${layers}</div>`;
    }
    const baseStyle = `{${JSON.stringify({
        display: 'flex',
        flexDirection: frameDirection(base),
        ...extraBaseStyles,
    })}}`;
    return `<div ${frameWrapperProps(baseId, baseProps)} style=${baseStyle}>${ordered.join('')}</div>`;
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
    if (`${base}` === 'image') return 'img';
    if (`${base}` === 'input' || (`${base}` === 'container' && data?.modifier?.props?.control === 'input')) return 'input';
    // Render as anchor element when href prop is present
    if (getProps(data).href) return 'a';
    return 'div';
}

/**
 *
 * @param data{*}
 * @return {string}
 */
function logicArgsArraySource(logic) {
    return `${logic?.argsSource ?? ''}`.trim() === '' ? '[]' : `[${logic.argsSource}]`;
}

function reactLogicInvocation(value) {
    const logic = parseLogicReference(value);
    return logic?.isCall ? `${logic.name}({component,args:${logicArgsArraySource(logic)}})` : null;
}

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
                v => reactLogicInvocation(v) !== null,
                v => reactLogicInvocation(v),
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
            // 'label' maps to aria-label for accessibility on arbitrary elements
            if (k === 'label') return `aria-label={${getValue(value)}}`;
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
        return `const [componentState,setComponentState]=useModuleState(${JSON.stringify(componentName)},{...${initialExpression},...overrideStates});\n\t${declarations.join('\n\t')}`;
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
    let inputs = propsInputs.concat(statesInputs, effectsInputs, styleInputs, ['loopElement', 'loopIndex']);
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
    const map = x => parseLogicReference(x)?.name ?? `${x}`.trim().replace(/^(?:logics|services)\.|\(\)/ig, '');
    const getStyleInputs = ifDoElse(
        x => /^(?:logics|services)\./i.test(`${x}`.trim()),
        compose(justList, map),
        x => Object.values(x).filter(filter).map(map)
    );
    const styleInputs = getStyleInputs(getStyles(data));
    const propsInputs = Object.values(getProps(data)).filter(filter).map(map);
    const childLogic = getChildren(data)?.type === 'logic' ? [map(getChildren(data)?.value)] : [];
    const effects = getEffects(data);
    const effectsInputs = Object.keys(effects).reduce((a, b) => {
        return [
            ...a,
            map(`${effects[b]?.body}`.trim())
        ]
    }, []);
    const exports = Array.from([...propsInputs, ...effectsInputs, ...styleInputs, ...childLogic].reduce((a, b) => a.add(b), new Set()));
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
    const left = getLeft(data);
    const right = getRight(data);
    const feed = getFeed(data);

    const singleImports = [left, right, feed].map(x => {
        if (typeof x === 'string' && x.endsWith('.yml')) {
            const component = firstUpperCase(snakeToCamel(getFilenameFromBlueprintPath(x)));
            const importPath = `${x}`.trim().startsWith('.') ? x : `./${x}`;
            return `import {${component}} from '${importPath.replace('.yml', '.jsx')}';`;
        }
        return null;
    }).filter(y => y !== null);

    const extendImports = extendImportSpecs(data).map(({path, base, alias}) => {
        const importPath = `${path}`.trim().startsWith('.') ? path : `./${path}`;
        const specifier = base === alias ? base : `${base} as ${alias}`;
        return `import {${specifier}} from '${importPath.replace('.yml', '.jsx')}';`;
    });

    return [...singleImports, ...extendImports].join('\n');
}

function getStyleMap(style) {
    const getValue = ifDoElse(
        v => `${v}`.trim().toLowerCase().startsWith('states.'),
        v => `${v}`.trim().replace(/^(states.)/ig, ''),
        ifDoElse(
            v => `${v}`.trim().toLowerCase().startsWith('inputs.'),
            v => `${v}`.trim().replace(/^(inputs.)/ig, ''),
            ifDoElse(
                v => reactLogicInvocation(v) !== null,
                v => reactLogicInvocation(v),
                ifDoElse(
                    v => /^(?:logics|services)\./i.test(`${v}`.trim()),
                    v => `${`${v}`.trim().replace(/^(?:logics|services)\.|\(\)/ig, '')}({component,args: []})`,
                    v => `${JSON.stringify(typeof v === 'string' ? v.replace(/asset:\/\/figma\//g, '/images/figma/') : v ?? '')}`.trim()
                )
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

// This node's own leaf element; frame wrapping/composition happens in
// composeFrame(), shared with condition and loop.
function componentHasPlaceholderOwnView(data) {
    const base = getBase(data);
    const children = getChildren(data);
    const props = getProps(data);
    const ownProps = Object.fromEntries(Object.entries(props).filter(([key, value]) => value !== undefined && value !== null && !['id', 'onClick', 'children', 'control', 'scroll'].includes(key)));
    return base === 'div'
        && !hasMeaningfulStyleEntries(getStyles(data))
        && !`${children?.value ?? ''}`.trim()
        && Object.keys(ownProps).length === 0;
}

function componentOwnWrapperProps(data) {
    const propsData = structuredClone(data);
    if (propsData?.modifier?.props) {
        delete propsData.modifier.props.id;
        delete propsData.modifier.props.scroll;
    }
    const propsString = getPropsStatement(propsData);
    return [propsString, '{...overrideProps}'].filter(Boolean).join('\n\t\t\t');
}

function componentOwnView(data) {
    const base = getBase(data);
    const propsString = getPropsStatement(data);
    const children = getChildren(data);
    const childContent = children?.type === 'state' || children?.type === 'input'
        ? `{${children?.value}}`
        : children?.type === 'logic'
            ? `{${reactLogicInvocation(children?.value)}}`
            : `${children?.value}`;
    return `
        <${base}
            style={style}
            ${propsString}
            {...overrideProps}
        >${childContent}</${base}>
    `;
}

/**
 * Generates a thin wrapper component that imports the base component (from
 * `data.__specBaseRelative`) and re-renders it, forwarding local modifier
 * overrides as `overrideStyles`, `overrideProps`, and `overrideStates` props.
 * The base component is responsible for merging these with its own defaults.
 *
 * @param data {*} map of the specification (contains __specBaseRelative)
 * @param path {string} specification path
 * @return {Promise<void>}
 */
export async function composeReactSpecBaseWrapper({data, path}) {
    const baseRelative = data.__specBaseRelative;
    const baseJsxPath = baseRelative.replace(/\.ya?ml$/i, '.jsx');
    const baseName = getFileName(baseRelative);
    const overrideStyles = JSON.stringify(reactStyleAssets(getStyles(data)));
    const overrideProps = JSON.stringify(Object.fromEntries(
        Object.entries(getProps(data)).filter(([, v]) => v !== undefined && v !== null)
    ));
    const overrideStates = JSON.stringify(getStates(data));
    const inputsStatement = getInputsStatement(data);
    const content = `
import React from 'react';
import {${baseName}} from '${baseJsxPath}';

// eslint-disable-next-line react/prop-types
export function ${getFileName(path)}(${inputsStatement === '' ? '' : `{${inputsStatement}}`}){
    return(<${baseName}
        loopIndex={loopIndex}
        loopElement={loopElement}
        overrideStyles={${overrideStyles}}
        overrideProps={${overrideProps}}
        overrideStates={${overrideStates}}
    />);
}
    `;
    const srcPath = getSrcPathFromBlueprintPath(path);
    await ensurePathExist(srcPath);
    await writeFile(srcPath, removeWhiteSpaces(content));
}

/**
 * @param data {*} map of the specification
 * @param path {string} specification path
 * @param projectPath {string} project root path
 * @return {Promise<void>}
 */
export async function composeReactComponent({data, path, projectPath}) {
    if (data.__specBase) {
        return composeReactSpecBaseWrapper({data, path});
    }

    const statesInString = getStatesStatement(data, path)
    const effectsString = getEffectsStatement(data);

    const logicsStatement = await getLogicsImportStatement(data, path, projectPath);
    const storeStatement = getModuleStoreImportStatement(data, path);
    const componentsImportStatement = getComponentsImportStatement(data);
    const actionImportStatement = getActionImportStatement(data, path);
    const componentStatement = getComponentMemoStatement(data);

    const styleStatement = getStyleStatement(data);
    const frame = getFrame(data);
    const ownView = componentHasPlaceholderOwnView(data) ? '' : componentOwnView(data);
    const ownProps = componentHasPlaceholderOwnView(data) ? componentOwnWrapperProps(data) : '';

    const styleStatementRenamed = styleStatement.replace(/\bconst style\b/, 'const _baseStyle');
    const inputsDecl = getInputsStatement(data) === '' ? '' : `${getInputsStatement(data)},`;
    const content = `
import React from 'react';
${logicsStatement}
${storeStatement}
${componentsImportStatement}
${actionImportStatement}

// eslint-disable-next-line react/prop-types
export function ${getFileName(path)}({${inputsDecl}overrideStyles={},overrideProps={},overrideStates={}}){
    ${statesInString}
    
    ${componentStatement}
    
    ${styleStatementRenamed}
    const style = React.useMemo(()=>({..._baseStyle,...overrideStyles}),[_baseStyle,overrideStyles]);
    
    ${effectsString}
    
    return(${composeFrame(data, frame, ownView, ownProps)});
}
    `;

    const srcPath = getSrcPathFromBlueprintPath(path);
    await ensurePathExist(srcPath);
    await writeFile(srcPath, removeWhiteSpaces(content));
}

// -- condition --------------------------------------------------------------

// This node's own branch result (left/right); frame wrapping/composition
// (including this node's own props) happens in composeFrame(), shared with
// component and loop.
function conditionOwnView(data) {
    const left = getLeft(data);
    const right = getRight(data);
    const getComponentName = x => firstUpperCase(snakeToCamel(getFilenameFromBlueprintPath(x)));
    const leftComponent = left ? `<${getComponentName(left)} loopIndex={loopIndex} loopElement={loopElement}/>` : '<span/>';
    const rightComponent = right ? `<${getComponentName(right)} loopIndex={loopIndex} loopElement={loopElement}/>` : '<span/>';
    const view = right ? `condition===true?${rightComponent}:${leftComponent}` : leftComponent;
    return `{${view}}`;
}

// Props for the condition's own wrapping element (e.g. onClick, cursor);
// `id` is dropped because composeFrame() already applies frame.id there.
function conditionOwnProps(data) {
    const propsData = structuredClone(data);
    if (propsData?.modifier?.props) {
        delete propsData.modifier.props.id;
        delete propsData.modifier.props.scroll;
    }
    return getPropsStatement(propsData);
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

    const frame = getFrame(data);
    const ownView = conditionOwnView(data);
    const ownProps = conditionOwnProps(data);
    const inputsDecl = getInputsStatement(data) === '' ? '' : `${getInputsStatement(data)},`;

    const content = `
import React from 'react';
${logicsStatement}
${storeStatement}
${componentsImportStatement}
${actionImportStatement}

// eslint-disable-next-line react/prop-types
export function ${getFileName(path)}({${inputsDecl}overrideStyles={},overrideProps={},overrideStates={}}) {
    ${statesInString}
    
    ${componentStatement}

    ${effectsString}

    return(${composeFrame(data, frame, ownView, ownProps)});
}
    `;

    const srcPath = getSrcPathFromBlueprintPath(path);
    await ensurePathExist(srcPath);
    await writeFile(srcPath, removeWhiteSpaces(content));
}

// -- loop ---------------------------------------------------------------

function getLoopScrollProp(data) {
    const layoutDirection =
        frameDirection(data?.modifier?.frame?.base?.type ?? data?.modifier?.frame?.base);
    return data?.modifier?.props?.scroll ?? layoutDirection === 'row' ? 'horizontal' : 'vertical';
}

function getIsLoopHorizontal(data) {
    return getLoopScrollProp(data) === 'horizontal';
}

// This node's own scrollable feed; frame wrapping/composition happens in
// composeFrame(), shared with component and condition.
function loopOwnProps(data) {
    const propsData = structuredClone(data);
    if (propsData?.modifier?.props) {
        delete propsData.modifier.props.scroll;
        delete propsData.modifier.props.id;
    }
    return getPropsStatement(propsData);
}

async function getLoopEstimate(data, path) {
    const isHorizontal = getIsLoopHorizontal(data);
    const axis = isHorizontal ? 'width' : 'height';
    const fallbackAxis = isHorizontal ? 'fallbackWidth' : 'fallbackHeight';
    const estimateFrom = spec => Number(getFrame(spec)?.baseStyles?.[axis]) || Number(getFrame(spec)?.baseStyles?.[fallbackAxis]) || Number(getStyles(spec)?.[axis]);
    const directEstimate = estimateFrom(data);
    if (directEstimate) return directEstimate;
    const feedPath = getFeed(data);
    if (!feedPath || !path) return isHorizontal ? 240 : 80;
    try {
        const absoluteFeedPath = pathResolve(pathDirname(path), feedPath);
        const feedSource = await readFile(absoluteFeedPath, 'utf8');
        const feedSpec = yaml.load(feedSource) ?? {};
        const feedData = feedSpec.component ?? feedSpec.condition ?? feedSpec.loop ?? {};
        return estimateFrom(feedData) || (isHorizontal ? 240 : 80);
    } catch (_) {
        return isHorizontal ? 240 : 80;
    }
}

function loopOwnView(data) {
    const feed = getFeed(data);
    const scroll = getLoopScrollProp(data);
    const propsString = loopOwnProps(data);
    const hasOwnStyles = hasMeaningfulStyleEntries(getStyles(data));
    const hasOwnProps = `${propsString}`.trim() !== '';
    const frame = getFrame(data);
    const gap = Number(frame?.baseStyles?.spaceValue) || 0;
    const getComponentName = x => firstUpperCase(snakeToCamel(getFilenameFromBlueprintPath(x)));
    const scrollStyle = scroll === 'both'
        ? "{{...style, overflowX: 'auto', overflowY: 'auto', position: 'relative', minWidth: 0, minHeight: 0}}"
        : scroll === 'horizontal'
            ? `{{...style, display:'flex', flexDirection:'row', flexWrap:'nowrap', width:'100%', minWidth:0, overflowY:'hidden', overflowX:'auto'${gap > 0 ? `, gap:${gap}` : ''}}}`
            : scroll === 'vertical'
                ? "{{...style, overflowY: 'auto', overflowX:'hidden',  position: 'relative', minHeight: 0, flex: 1}}"
                : '{style}';
    if (!feed) return '<span/>';
    if (!scroll && !hasOwnStyles && !hasOwnProps) {
        return `{data?.map((item,index)=> (<${getComponentName(feed)} key={item?._key??index} loopIndex={index} loopElement={item}/>))}`;
    }
    if (!scroll) {
        return `
        <div 
            style={style}
            ${propsString}
        >
            {data?.map((item,index)=> (<${getComponentName(feed)} key={item?._key??index} loopIndex={index} loopElement={item}/>))}
        </div>
    `;
    }
    if (scroll === 'horizontal') {
        return `
        <div 
            style=${scrollStyle}
            ${propsString}
        >
            {data?.map((item,index)=> (<div key={item?._key??index} style={{flex:'0 0 auto'}}><${getComponentName(feed)} loopIndex={index} loopElement={item}/></div>))}
        </div>
    `;
    }
    return `
        <div 
            ref={listRef}
            style=${scrollStyle}
            ${propsString}
        >
            <div style={virtualInnerStyle}>
                {visibleItems.map(({item,index})=> (<div key={item?._key??index} style={virtualItemStyle(index)}><${getComponentName(feed)} loopIndex={index} loopElement={item}/></div>))}
            </div>
        </div>
    `;
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

    const frame = getFrame(data);
    const ownView = loopOwnView(data);
    const ownProps = ownView === '<span/>' ? loopOwnProps(data) : '';
    const needsStyleStatement = ownView.includes('style={style}') || ownView.includes('{...style,');
    const inputsDecl = getInputsStatement(data) === '' ? '' : `${getInputsStatement(data)},`;
    const scroll = getLoopScrollProp(data);
    const isHorizontal = getIsLoopHorizontal(data);
    const estimate = await getLoopEstimate(data, path);
    const virtualization = scroll && scroll !== 'horizontal'
        ? `const listRef = React.useRef(null);
    const [viewport,setViewport]=React.useState({offset:0,size:0});
    const estimateSize=${estimate};
    const items=Array.isArray(data)?data:[];
    const isHorizontal=${isHorizontal};
    React.useLayoutEffect(()=>{
        const node=listRef.current;
        if(!node) return;
        const update=()=>setViewport({offset:isHorizontal?node.scrollLeft:node.scrollTop,size:isHorizontal?node.clientWidth:node.clientHeight});
        update();
        node.addEventListener('scroll',update,{passive:true});
        window.addEventListener('resize',update);
        return ()=>{
            node.removeEventListener('scroll',update);
            window.removeEventListener('resize',update);
        };
    },[isHorizontal,items.length]);
    const overscan=3;
    const startIndex=Math.max(0,Math.floor(viewport.offset/estimateSize)-overscan);
    const endIndex=Math.min(items.length,Math.ceil((viewport.offset+viewport.size)/estimateSize)+overscan);
    const visibleItems=items.slice(startIndex,endIndex).map((item,offset)=>({item,index:startIndex+offset}));
    const virtualInnerStyle=isHorizontal?{position:'relative',width:items.length*estimateSize,height:'100%'}:{position:'relative',height:items.length*estimateSize};
    const virtualItemStyle=index=>isHorizontal?{position:'absolute',left:index*estimateSize,top:0,width:estimateSize}:{position:'absolute',top:index*estimateSize,left:0,right:0};`
        : '';

    const content = `
import React from 'react';
${logicsImportStatement}
${storeStatement}
${componentsImportStatement}
${actionImportStatement}

// eslint-disable-next-line react/prop-types
export function ${getFileName(path)}({${inputsDecl}overrideStyles={},overrideProps={},overrideStates={}}) {
    ${statesInString}
    
    ${componentMemoStatement}
    
    ${needsStyleStatement ? styleStatement : ''}
    ${virtualization}

    ${effectsString}

    return(${composeFrame(data, frame, ownView === '<span/>' ? '' : ownView, ownProps)});
}
    `;

    const srcPath = getSrcPathFromBlueprintPath(path);
    await ensurePathExist(srcPath);
    await writeFile(srcPath, removeWhiteSpaces(content));
}
