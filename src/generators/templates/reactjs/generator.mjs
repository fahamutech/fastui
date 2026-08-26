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
import {createHash} from 'node:crypto';
import * as yaml from 'js-yaml';
import {getTemplateSelected} from "../../../tooling/config.mjs";
import {TEMPLATE_MAPPING} from "../mapping.mjs";
import {containsLogicReference, containsNavigationAction, containsTranslationBinding} from '../../behavior.mjs';
import {referencedInputKeys, referencedStateKeys} from '../../bindings.mjs';
import {ensureServiceFile, identifier, relativeImport, specStructure} from '../../project-structure.mjs';
import {getFileName, getFilenameFromBlueprintPath} from '../../naming.mjs';

const template = getTemplateSelected();

const reactAssetPath = value => typeof value === 'string'
    ? value.replaceAll('asset://figma/', '/images/figma/')
    : value;

const reactStyleAssets = styles => {
    const spaceValue = styles?.spaceValue;
    const normalized = Object.fromEntries(
        Object.entries(styles ?? {})
            .filter(([key, value]) => value !== undefined && value !== null && !['fallbackWidth', 'fallbackHeight', 'spaceValue'].includes(key))
            .map(([key, value]) => [key, reactAssetPath(value)])
    );
    normalized.boxSizing = 'border-box';
    // `backgroundGradient` is the target-neutral representation written by
    // the Figma translator. CSS consumes it as a normal background image.
    if (normalized.backgroundGradient && !normalized.backgroundImage) {
        normalized.backgroundImage = normalized.backgroundGradient;
    }
    delete normalized.backgroundGradient;
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
        const specId = `${path}`.replace(/^\.\//, '').replace(/\.ya?ml$/i, '');
        return {path, base, alias, specId};
    });
}

function reuseChildImportSpecs(data) {
    const children = data?.modifier?.overrides?.children ?? {};
    return Object.entries(children)
        .filter(([, path]) => typeof path === 'string' && /\.ya?ml$/i.test(path))
        .map(([slot, path]) => ({
            slot,
            path,
            name: firstUpperCase(snakeToCamel(getFilenameFromBlueprintPath(path))),
            specId: `${path}`.replace(/^\.\//, '').replace(/\.ya?ml$/i, ''),
        }));
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
        ? `<div ${frameWrapperProps(frame?.id, extraProps)} style={{...${JSON.stringify(reactStyleAssets(frame?.current ?? {}))},...(reuseProps.style??{}),...(initialProps.style??{})}}>${ownView}</div>`
        : ownView;
    const nextStyle = `{${JSON.stringify(reactStyleAssets(frame?.next ?? {}))}}`;
    const nextViews = extend.map(({alias, specId}, index) => {
        const fallback = `<${alias} loopIndex={loopIndex} loopElement={loopElement} instanceId={\`${'${resolvedInstanceId}'}\/${index}\/${specId}\`} componentOverrides={componentOverrides?.descendants?.[${index}]??{}}/>`;
        const child = `{componentOverrides?.children?.[${index}]??${fallback}}`;
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
    // A growing column must be allowed to shrink below its contents. This is
    // essential when a descendant owns vertical scrolling; without it, the
    // column's min-content height pushes preceding siblings (such as a page
    // header) out of a viewport whose root clips overflow.
    if (frameDirection(base) === 'column' && extraBaseStyles.flex !== undefined) {
        extraBaseStyles.minHeight ??= 0;
    }
    if (frameIsStack(base)) {
        const layers = ordered
            .map(item => `<div style={{gridArea:'1 / 1'}}>${item}</div>`)
            .join('');
        return `<div ${frameWrapperProps(baseId, baseProps)} style={{...${JSON.stringify({
            display: 'grid',
            ...extraBaseStyles
        })},...(reuseProps.style??{}),...(initialProps.style??{})}}>${layers}</div>`;
    }
    const baseStyle = JSON.stringify({
        display: 'flex',
        flexDirection: frameDirection(base),
        ...extraBaseStyles,
    });
    return `<div ${frameWrapperProps(baseId, baseProps)} style={{...${baseStyle},...(reuseProps.style??{}),...(initialProps.style??{})}}>${ordered.join('')}</div>`;
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
    if (`${base}` === 'input' || (`${base}` === 'container' && data?.modifier?.props?.control === 'input')) {
        return data?.modifier?.props?.multiline === true || data?.modifier?.props?.type === 'multiline' ? 'textarea' : 'input';
    }
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
    return logic?.isCall ? `${logic.name}(component.withArgs(${logicArgsArraySource(logic)}))` : null;
}

function translationVariable(binding) {
    const key = `${binding?.key ?? 'text'}`.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 40);
    const suffix = createHash('sha1').update(JSON.stringify({key: binding?.key, args: binding?.args ?? {}})).digest('hex').slice(0, 8);
    return `fastUITranslation_${key || 'text'}_${suffix}`;
}

function reactTranslationArgs(binding) {
    const args = binding?.args && typeof binding.args === 'object'
        ? Object.entries(binding.args).map(([key, value]) => {
            const expression = typeof value === 'string' && /^(?:states|inputs)\./i.test(value)
                ? value.replace(/^(?:states|inputs)\./i, '')
                : JSON.stringify(value);
            return `${JSON.stringify(key)}:${expression}`;
        })
        : [];
    return args.length ? `{${args.join(',')}}` : '{}';
}

function reactTranslationCall(binding) {
    return translationVariable(binding);
}

function translationBindings(data) {
    const bindings = new Map();
    const visit = value => {
        if (Array.isArray(value)) return value.forEach(visit);
        if (!value || typeof value !== 'object') return;
        if (value.translation && typeof value.translation === 'object') {
            bindings.set(translationVariable(value.translation), value.translation);
            return;
        }
        Object.values(value).forEach(visit);
    };
    visit(data);
    return [...bindings.entries()];
}

function getTranslationStatements(data) {
    return translationBindings(data)
        .map(([name, binding]) => `const ${name}=useFastUITranslation(${JSON.stringify(binding.key ?? '')},${reactTranslationArgs(binding)});`)
        .join('\n\t');
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
            return `componentStore.setField(resolvedInstanceId,${JSON.stringify(action.target)},${value},stateSeed)`;
        }
        return '';
    };
    const eventExpression = action => {
        const actions = action?.action === 'sequence' ? action.actions ?? [] : [action];
        const statements = actions.map(action => actionStatement(action, 'event')).filter(Boolean);
        return `(event)=>{${statements.map(statement => `${statement};`).join('')}}`;
    };
    const getValue = v => v?.translation && typeof v.translation === 'object'
        ? reactTranslationCall(v.translation)
        : ifDoElse(
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
                        x => `${`${x}`.trim().replace(/^(?:logics|services)\.|\(\)/ig, '')}(component.withArgs([]))`,
                        x => `(...args)=>${`${x}`.trim().replace(/^(?:logics|services)\.|\(\)/ig, '')}(component.withArgs(args))`
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
    )(v);
    return Object
        .keys(props)
        .filter(k => props[k] !== undefined && props[k] !== null && !['control', 'multiline'].includes(k))
        .map(k => {
            const value = props[k];
            if (k === 'type' && value === 'multiline') return '';
            if (/^on[A-Z]/.test(k) && value && typeof value === 'object') {
                if (k === 'onSubmit') return `onKeyDown={(event)=>{if(event.key==='Enter'){${eventExpression(value).replace(/^\(event\)=>/, '')}}}}`;
                return `${k}={${eventExpression(value)}}`;
            }
            // 'label' maps to aria-label for accessibility on arbitrary elements
            if (k === 'label') return `aria-label={${getValue(value)}}`;
            if (k === 'onChange' && typeof value === 'string' && /^(?:logics|services)\./i.test(value) && `${props.value ?? ''}`.startsWith('states.')) {
                const stateKey = `${props.value}`.replace(/^states\./i, '');
                const serviceName = parseLogicReference(value)?.name;
                return `onChange={(event)=>{const nextValue=event?.target?.value??event;componentStore.setField(resolvedInstanceId,${JSON.stringify(stateKey)},nextValue,stateSeed);${serviceName}(component.withArgs([nextValue,event]));}}`;
            }
            if (k === 'onSubmit' && typeof value === 'string' && /^(?:logics|services)\./i.test(value)) {
                const serviceName = parseLogicReference(value)?.name;
                return `onKeyDown={(event)=>{if(event.key==='Enter'){${serviceName}(component.withArgs([event.currentTarget?.value,event]));}}}`;
            }
            if (k === 'autofill') return `autoComplete={${getValue(value)}}`;
            return `${k}={${getValue(value)}}`;
        })
        .filter(Boolean)
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
    if (template === 'reactjs' && specPath && hasComponentStore(data)) {
        const consumed = consumedStateKeys(data);
        if (consumed.length === 0) {
            return 'useFastUISelector(componentStore,resolvedInstanceId,()=>null,stateSeed);';
        }
        return consumed
            .map(key => `const ${identifier(key)}=useFastUISelector(componentStore,resolvedInstanceId,state=>state[${JSON.stringify(key)}],stateSeed);`)
            .join('\n\t');
    }
    const getStateIV = k => /^(inputs\.)/ig.test(`${states[k]}`.trim())
        ? `${states[k]}`.replace(/^(inputs.)/ig, '')
        : JSON.stringify(states[k]);
    return TEMPLATE_MAPPING.statesPresentation[template](states, getStateIV);
}

export function getModuleStoreImportStatement(data, specPath) {
    if (template !== 'reactjs' || (Object.keys(getStates(data)).length === 0 && Object.keys(getEffects(data)).length === 0)) return '';
    const outputPath = pathResolve(getSrcPathFromBlueprintPath(specPath));
    const structure = specStructure(specPath, 'reactjs');
    const camel = `${structure.componentName[0] ?? ''}`.toLowerCase() + structure.componentName.slice(1);
    return `import {${identifier(camel)}Store} from '${relativeImport(outputPath, structure.storePath)}';`;
}

/**
 * @param data{*}
 * @return {string}
 * */
export function getEffectsStatement(data) {
    const effects = getEffects(data);
    return Object.keys(effects).map(key => {
        const dependency = sanitizeEffectDependency(effects[key]?.watch);
        const body = effects[key]?.body;
        const service = /^(?:logics|services)\./i.test(`${body}`.trim())
            ? `${body}`.trim().replace(/^(?:logics|services)\.|\(\)/ig, '')
            : null;
        if (`${key}`.toLowerCase() === 'oninit' && service) {
            return `React.useEffect(()=>{componentStore.initialize(resolvedInstanceId,()=>${service}(component.withArgs([])),stateSeed);},[componentStore,resolvedInstanceId]);`;
        }
        if (service) {
            return `React.useEffect(()=>{void ${service}(component.withArgs([]));},[${dependency ?? ''}]);`;
        }
        return `React.useEffect(()=>{${body ?? ''}},[${dependency ?? ''}]);`;
    }).join('\n\t');
}

/**
 *
 * @param data
 * @return {string}
 */
export function getInputsStatement(data = {}) {
    return TEMPLATE_MAPPING.inputsPresentation[template]([
        ...referencedInputKeys(data),
        'loopElement',
        'loopIndex',
    ]);
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

/**
 *
 * @param data {*}
 * @return {string}
 */
export function getComponentMemoStatement(data, specPath) {
    if (!containsLogicReference(data) && Object.keys(getEffects(data)).length === 0) return '';
    const componentId = specPath ? specStructure(specPath, 'reactjs').specId : 'component';
    const navigate = containsNavigationAction(data) ? ',navigate:setCurrentRoute' : '';
    return `const component=React.useMemo(()=>createFastUIComponentContext({store:componentStore,componentId:${JSON.stringify(componentId)},instanceId:resolvedInstanceId,inputs${navigate}}),[componentStore,resolvedInstanceId,${getInputsStatement(data)}]);`;
}

function figmaServiceBody(action) {
    const actions = action?.action === 'sequence' ? action.actions ?? [] : [action];
    return actions.map(item => {
        if (`${item?.action ?? ''}`.startsWith('navigation.')) {
            const route = {...item};
            delete route.action;
            return `  context.navigate(${JSON.stringify(route)});`;
        }
        if (item?.action === 'state.set' && item.target) {
            return `  context.setState(${JSON.stringify(item.target)}, ${JSON.stringify(item.value)});`;
        }
        return '';
    }).filter(Boolean).join('\n');
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
        functions: exports,
        template: 'reactjs',
        initialStateByFunction: (() => {
            const sample = data?.modifier?.metadata?.loopInitialData;
            const initName = parseLogicReference(data?.modifier?.effects?.onInit?.body)?.name;
            return initName && Array.isArray(sample) ? {[initName]: {data: sample}} : {};
        })(),
        reactBodiesByFunction: Object.fromEntries(Object.entries(data?.modifier?.metadata?.figmaServiceActions ?? {})
            .map(([name, action]) => [name, figmaServiceBody(action)])
            .filter(([, body]) => body)),
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

    const reuseImports = [];
    if (typeof data?.base === 'string' && /\.ya?ml$/i.test(data.base)) {
        const name = firstUpperCase(snakeToCamel(getFilenameFromBlueprintPath(data.base)));
        reuseImports.push(`import {${name}} from '${data.base.replace(/\.ya?ml$/i, '.jsx')}';`);
    }
    for (const {path, name} of reuseChildImportSpecs(data)) {
        reuseImports.push(`import {${name}} from '${path.replace(/\.ya?ml$/i, '.jsx')}';`);
    }

    return [...new Set([...singleImports, ...extendImports, ...reuseImports])].join('\n');
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
                    v => `${`${v}`.trim().replace(/^(?:logics|services)\.|\(\)/ig, '')}(component.withArgs([]))`,
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
    const getStyleStatement = ifDoElse(
        t => /^(?:logics|services)\./i.test(`${t}`.trim()),
        t => `const style = ${`${t}`.replace(/^(?:logics|services)\.|\(\)/ig, '')}(component.withArgs([]));`,
        t => `const style = ${getStyleMap(t)};`
    );
    return getStyleStatement(style);
}

// -- component -------------------------------------------------------------

function componentStoreName(path) {
    const name = specStructure(path, 'reactjs').componentName;
    const camel = `${name[0] ?? ''}`.toLowerCase() + name.slice(1);
    return `${identifier(camel)}Store`;
}

function hasComponentStore(data) {
    return Object.keys(getStates(data)).length > 0 || Object.keys(getEffects(data)).length > 0;
}

function consumedStateKeys(data) {
    const states = getStates(data);
    const keys = new Set(referencedStateKeys(data).filter(key => Object.hasOwn(states, key)));
    if (getRight(data) && Object.hasOwn(states, 'condition')) keys.add('condition');
    if (getFeed(data) && Object.hasOwn(states, 'data')) keys.add('data');
    return [...keys];
}

function inputNames(data) {
    return getInputsStatement(data).split(',').map(value => value.trim()).filter(Boolean);
}

function reactComponentPrelude(data, path) {
    const structure = specStructure(path, 'reactjs');
    const storeful = hasComponentStore(data);
    const needsContext = containsLogicReference(data) || Object.keys(getEffects(data)).length > 0;
    const needsIdentity = storeful || needsContext || getExtendList(data).length > 0 || /\.ya?ml$/i.test(`${data?.base ?? ''}`) || Boolean(getFeed(data)) || Boolean(getLeft(data)) || Boolean(getRight(data));
    const inputs = inputNames(data);
    const lines = [];
    if (needsIdentity) lines.push(`const resolvedInstanceId=instanceId??${JSON.stringify(structure.specId)};`);
    if (storeful || needsContext) lines.push(`const inputs={${inputs.join(',')}};`);
    if (storeful) {
        lines.push(`const componentStore=${componentStoreName(path)};`);
        lines.push('const stateSeed={inputs,initialState};');
    } else if (needsContext) {
        lines.push('const componentStore=null;');
    }
    return lines.join('\n\t');
}

function reactRuntimeImportStatement(data, path, projectPath) {
    const names = new Set();
    if (hasComponentStore(data)) names.add('useFastUISelector');
    if (containsLogicReference(data) || Object.keys(getEffects(data)).length > 0) names.add('createFastUIComponentContext');
    if (['input', 'textarea'].includes(getBase(data))) names.add('useFastUIControlledInput');
    if (!names.size) return '';
    return `import {${[...names].join(',')}} from '${relativeImport(pathResolve(getSrcPathFromBlueprintPath(path)), pathResolve(projectPath, 'src', 'fastui_runtime.mjs'))}';`;
}

function reactFunctionProps(data) {
    const inputs = getInputsStatement(data);
    return `${inputs ? `${inputs},` : ''}instanceId,initialState={},initialProps={},componentOverrides={},...reuseProps`;
}

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
    return [propsString, '{...reuseProps}', '{...initialProps}'].filter(Boolean).join('\n\t\t\t');
}

function componentOwnView(data) {
    const base = getBase(data);
    const propsString = getPropsStatement(data);
    const styleProp = hasMeaningfulStyleEntries(getStyles(data)) ? 'style={{...style,...(reuseProps.style??{}),...(initialProps.style??{})}}' : '';
    const children = getChildren(data);
    const childContent = children?.type === 'state' || children?.type === 'input'
        ? `{${children?.value}}`
        : children?.type === 'translation'
            ? `{${reactTranslationCall(children.value)}}`
        : children?.type === 'logic'
            ? `{${reactLogicInvocation(children?.value)}}`
            : children?.value === undefined || children?.value === null || children?.value === ''
                ? ''
                : `{${JSON.stringify(children.value)}}`;
    if (base === 'input' || base === 'textarea' || base === 'img') return `
        <${base}
            ${base === 'input' || base === 'textarea' ? 'ref={inputRef}' : ''}
            ${propsString}
            {...reuseProps}
            {...initialProps}
            ${styleProp}
        />
    `;
    return `
        <${base}
            ${propsString}
            {...reuseProps}
            {...initialProps}
            ${styleProp}
        >${childContent}</${base}>
    `;
}

function reuseComponentOwnView(data) {
    const name = firstUpperCase(snakeToCamel(getFilenameFromBlueprintPath(data.base)));
    const propsString = getPropsStatement(data);
    const frameStyles = reactStyleAssets(getFrame(data).baseStyles ?? {});
    const localStyle = hasMeaningfulStyleEntries(getStyles(data)) ? '...style,' : '';
    const styleProp = localStyle || hasMeaningfulStyleEntries(frameStyles)
        ? `style={{${localStyle}...${JSON.stringify(frameStyles)}}}`
        : '';
    const children = reuseChildImportSpecs(data);
    const childEntries = children.map(({slot, name: childName, specId}) =>
        `${JSON.stringify(slot)}:<${childName} loopIndex={loopIndex} loopElement={loopElement} instanceId={\`${'${resolvedInstanceId}'}/override/${slot}/${specId}\`}/>`
    ).join(',');
    const overrideProp = children.length
        ? `componentOverrides={{...componentOverrides,children:{...(componentOverrides.children??{}),${childEntries}}}}`
        : 'componentOverrides={componentOverrides}';
    return `<${name}
        loopIndex={loopIndex}
        loopElement={loopElement}
        instanceId={resolvedInstanceId}
        initialState={{...${JSON.stringify(getStates(data))},...initialState}}
        initialProps={initialProps}
        ${overrideProp}
        ${propsString}
        ${styleProp}
        {...reuseProps}
    />`;
}

/**
 * @param data {*} map of the specification
 * @param path {string} specification path
 * @param projectPath {string} project root path
 * @return {Promise<void>}
 */
export async function composeReactComponent({data, path, projectPath}) {
    const reuseData = data;
    const isReuse = typeof data?.base === 'string' && /\.ya?ml$/i.test(data.base);
    const statesInString = getStatesStatement(data, path)
    const effectsString = getEffectsStatement(data);

    const logicsStatement = await getLogicsImportStatement(data, path, projectPath);
    const translationStatement = containsTranslationBinding(data)
        ? `import {useFastUITranslation} from '${relativeImport(pathResolve(getSrcPathFromBlueprintPath(path)), pathResolve(projectPath, 'src', 'translations', 'generated.mjs'))}';`
        : '';
    const runtimeStatement = reactRuntimeImportStatement(data, path, projectPath);
    const storeStatement = getModuleStoreImportStatement(data, path);
    const componentsImportStatement = getComponentsImportStatement(data);
    const actionImportStatement = getActionImportStatement(data, path);
    const componentStatement = getComponentMemoStatement(data, path);

    const styleStatement = hasMeaningfulStyleEntries(getStyles(data)) ? getStyleStatement(data) : '';
    const frame = getFrame(data);
    const ownView = isReuse
        ? reuseComponentOwnView(reuseData)
        : componentHasPlaceholderOwnView(data) ? '' : componentOwnView(data);
    const ownProps = isReuse ? '' : componentHasPlaceholderOwnView(data) ? componentOwnWrapperProps(data) : '';

    const prelude = reactComponentPrelude(data, path);
    const translationBindings = getTranslationStatements(data);
    const inputValue = `${getProps(data).value ?? ''}`.startsWith('states.')
        ? `${getProps(data).value}`.replace(/^states\./i, '')
        : `${getProps(data).value ?? ''}`.startsWith('inputs.')
            ? `${getProps(data).value}`.replace(/^inputs\./i, '')
            : JSON.stringify(getProps(data).value ?? '');
    const inputStatement = ['input', 'textarea'].includes(getBase(data)) ? `const inputRef=useFastUIControlledInput(${inputValue});` : '';
    // A spec-file base is already a complete rendered component. Its instance
    // frame styles are forwarded by reuseComponentOwnView(), so composing it
    // again would create an outer wrapper with the same styles (and compound
    // layout styles such as padding).
    const renderedView = isReuse ? ownView : composeFrame(data, frame, ownView, ownProps);
    const content = `
import React from 'react';
${logicsStatement}
${translationStatement}
${runtimeStatement}
${storeStatement}
${componentsImportStatement}
${actionImportStatement}

// eslint-disable-next-line react/prop-types
export const ${getFileName(path)}=React.memo(function ${getFileName(path)}({${reactFunctionProps(data)}}){
    ${prelude}
    ${statesInString}
    ${translationBindings}
    ${componentStatement}
    ${inputStatement}
    ${styleStatement}
    ${effectsString}
    return(${renderedView});
});
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
    const childId = (path, slot) => `instanceId={\`${'${resolvedInstanceId}'}\/${slot}\/${`${path}`.replace(/^\.\//, '').replace(/\.ya?ml$/i, '')}\`}`;
    const leftComponent = left ? `<${getComponentName(left)} loopIndex={loopIndex} loopElement={loopElement} ${childId(left, 'left')}/>` : '<span/>';
    const rightComponent = right ? `<${getComponentName(right)} loopIndex={loopIndex} loopElement={loopElement} ${childId(right, 'right')}/>` : '<span/>';
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
    return [getPropsStatement(propsData), '{...initialProps}'].filter(Boolean).join(' ');
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
    const componentStatement = getComponentMemoStatement(data, path);
    const logicsStatement = await getLogicsImportStatement(data, path, projectPath);
    const storeStatement = getModuleStoreImportStatement(data, path);
    const componentsImportStatement = getComponentsImportStatement(data);
    const actionImportStatement = getActionImportStatement(data, path);
    const runtimeStatement = reactRuntimeImportStatement(data, path, projectPath);
    const translationStatement = containsTranslationBinding(data)
        ? `import {useFastUITranslation} from '${relativeImport(pathResolve(getSrcPathFromBlueprintPath(path)), pathResolve(projectPath, 'src', 'translations', 'generated.mjs'))}';`
        : '';

    const frame = getFrame(data);
    const ownView = conditionOwnView(data);
    const ownProps = conditionOwnProps(data);
    const prelude = reactComponentPrelude(data, path);
    const translationStatements = getTranslationStatements(data);

    const content = `
import React from 'react';
${logicsStatement}
${translationStatement}
${runtimeStatement}
${storeStatement}
${componentsImportStatement}
${actionImportStatement}

// eslint-disable-next-line react/prop-types
export const ${getFileName(path)}=React.memo(function ${getFileName(path)}({${reactFunctionProps(data)}}) {
    ${prelude}
    ${statesInString}
    ${translationStatements}
    ${componentStatement}

    ${effectsString}

    return(${composeFrame(data, frame, ownView, ownProps)});
});
    `;

    const srcPath = getSrcPathFromBlueprintPath(path);
    await ensurePathExist(srcPath);
    await writeFile(srcPath, removeWhiteSpaces(content));
}

// -- loop ---------------------------------------------------------------

function getLoopScrollProp(data) {
    return data?.modifier?.props?.scroll;
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
        delete propsData.modifier.props.itemKey;
    }
    return [getPropsStatement(propsData), '{...initialProps}'].filter(Boolean).join(' ');
}

function loopItemIdentityExpression(data) {
    const itemKey = data?.modifier?.props?.itemKey;
    const authored = typeof itemKey === 'string' && itemKey.trim()
        ? `item?.[${JSON.stringify(itemKey.trim())}]??`
        : '';
    return `${authored}item?._key??item?.id??item?.key??index`;
}

async function getLoopEstimate(data, path) {
    const isHorizontal = getIsLoopHorizontal(data);
    const axis = isHorizontal ? 'width' : 'height';
    const fallbackAxis = isHorizontal
        ? 'fallbackWidth'
        : 'fallbackHeight';

    const estimateFrom = spec => {
        const frame = getFrame(spec);

        return (
            Number(frame?.baseStyles?.[axis]) ||
            Number(frame?.baseStyles?.[fallbackAxis]) ||
            Number(getStyles(spec)?.[axis]) ||
            undefined
        );
    };

    /*
     * IMPORTANT:
     * Do not estimate an item from the LOOP itself.
     */
    const feedPath = getFeed(data);

    if (feedPath && path) {
        try {
            const absoluteFeedPath = pathResolve(
                pathDirname(path),
                feedPath
            );

            const feedSource = await readFile(
                absoluteFeedPath,
                'utf8'
            );

            const feedSpec = yaml.load(feedSource) ?? {};

            const feedData =
                feedSpec.component ??
                feedSpec.condition ??
                feedSpec.loop ??
                {};

            const feedEstimate = estimateFrom(feedData);

            if (feedEstimate) {
                return feedEstimate;
            }
        } catch (_) {
            // Fall through to default estimate.
        }
    }

    return isHorizontal ? 240 : 80;
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
    const itemIdentity = loopItemIdentityExpression(data);
    const child = `<${getComponentName(feed)} loopIndex={index} loopElement={item} instanceId={\`${'${resolvedInstanceId}'}\/${'${itemIdentity}'}\`}/>`;
    const scrollStyle = scroll === 'both'
        ? "{{...style, overflowX: 'auto', overflowY: 'auto', position: 'relative', minWidth: 0, minHeight: 0}}"
        : scroll === 'horizontal'
            ? `{{...style, display:'flex', flexDirection:'row', flexWrap:'nowrap', width:'100%', minWidth:0, overflowY:'hidden', overflowX:'auto'${gap > 0 ? `, gap:${gap}` : ''}}}`
            : scroll === 'vertical'
                ? "{{...style, overflowY: 'auto', overflowX:'hidden',  position: 'relative', minHeight: 0, flex: 1}}"
                : '{style}';
    if (!feed) return '<span/>';
    if (!scroll && !hasOwnStyles && !hasOwnProps) {
        return `{data?.map((item,index)=> {const itemIdentity=${itemIdentity};return (<React.Fragment key={itemIdentity}>${child}</React.Fragment>);})}`;
    }
    if (!scroll) {
        return `
        <div 
            style={style}
            ${propsString}
        >
            {data?.map((item,index)=> {const itemIdentity=${itemIdentity};return (<React.Fragment key={itemIdentity}>${child}</React.Fragment>);})}
        </div>
    `;
    }
    if (scroll === 'horizontal') {
        return `
        <div 
            style=${scrollStyle}
            ${propsString}
        >
            {data?.map((item,index)=> {const itemIdentity=${itemIdentity};return (<div key={itemIdentity} style={{flex:'0 0 auto'}}>${child}</div>);})}
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
                {visibleItems.map(({item,index})=> {const itemIdentity=${itemIdentity};return (<div key={itemIdentity} style={virtualItemStyle(index)}>${child}</div>);})}
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
    const componentMemoStatement = getComponentMemoStatement(data, path);
    const logicsImportStatement = await getLogicsImportStatement(data, path, projectPath);
    const storeStatement = getModuleStoreImportStatement(data, path);
    const componentsImportStatement = getComponentsImportStatement(data);
    const actionImportStatement = getActionImportStatement(data, path);
    const runtimeStatement = reactRuntimeImportStatement(data, path, projectPath);
    const translationStatement = containsTranslationBinding(data)
        ? `import {useFastUITranslation} from '${relativeImport(pathResolve(getSrcPathFromBlueprintPath(path)), pathResolve(projectPath, 'src', 'translations', 'generated.mjs'))}';`
        : '';
    const styleStatement = getStyleStatement(data);

    const frame = getFrame(data);
    const ownView = loopOwnView(data);
    const ownProps = ownView === '<span/>' ? loopOwnProps(data) : '';
    const needsStyleStatement = ownView.includes('style={style}') || ownView.includes('{...style,');
    const prelude = reactComponentPrelude(data, path);
    const translationStatements = getTranslationStatements(data);
    const scroll = getLoopScrollProp(data);
    const isHorizontal = getIsLoopHorizontal(data);
    const estimate = await getLoopEstimate(data, path);
    const loopGap = Number(getFrame(data)?.baseStyles?.spaceValue) || 0;

    const virtualization = scroll && scroll !== 'horizontal'
        ? `
const listRef=React.useRef(null);
const [viewport,setViewport]=React.useState({
    offset:0,
    size:0
});

const estimateSize=${estimate};
const itemGap=${loopGap};
const itemStride=estimateSize+itemGap;

const items=Array.isArray(data)?data:[];
const isHorizontal=${isHorizontal};

React.useLayoutEffect(()=>{
    const node=listRef.current;

    if(!node) return;

    const update=()=>setViewport({
        offset:isHorizontal
            ? node.scrollLeft
            : node.scrollTop,

        size:isHorizontal
            ? node.clientWidth
            : node.clientHeight
    });

    update();

    node.addEventListener(
        'scroll',
        update,
        {passive:true}
    );

    window.addEventListener(
        'resize',
        update
    );

    return ()=>{
        node.removeEventListener(
            'scroll',
            update
        );

        window.removeEventListener(
            'resize',
            update
        );
    };
},[isHorizontal,items.length]);

const overscan=3;

const startIndex=Math.max(
    0,
    Math.floor(
        viewport.offset / itemStride
    ) - overscan
);

const endIndex=Math.min(
    items.length,
    Math.ceil(
        (viewport.offset + viewport.size) /
        itemStride
    ) + overscan
);

const visibleItems=items
    .slice(startIndex,endIndex)
    .map((item,offset)=>({
        item,
        index:startIndex+offset
    }));

const totalSize=
    items.length === 0
        ? 0
        : (
            items.length * estimateSize +
            (items.length - 1) * itemGap
        );

const virtualInnerStyle=isHorizontal
    ? {
        position:'relative',
        width:totalSize,
        height:'100%'
    }
    : {
        position:'relative',
        height:totalSize
    };

const virtualItemStyle=index=>isHorizontal
    ? {
        position:'absolute',
        left:index*itemStride,
        top:0,
        width:estimateSize
    }
    : {
        position:'absolute',
        top:index*itemStride,
        left:0,
        right:0,
        height:estimateSize
    };
`
        : '';

    const content = `
import React from 'react';
${logicsImportStatement}
${translationStatement}
${runtimeStatement}
${storeStatement}
${componentsImportStatement}
${actionImportStatement}

// eslint-disable-next-line react/prop-types
export const ${getFileName(path)}=React.memo(function ${getFileName(path)}({${reactFunctionProps(data)}}) {
    ${prelude}
    ${statesInString}
    ${translationStatements}
    ${componentMemoStatement}
    
    ${needsStyleStatement ? styleStatement : ''}
    ${virtualization}

    ${effectsString}

    return(${composeFrame(data, frame, ownView === '<span/>' ? '' : ownView, ownProps)});
});
    `;

    const srcPath = getSrcPathFromBlueprintPath(path);
    await ensurePathExist(srcPath);
    await writeFile(srcPath, removeWhiteSpaces(content));
}
