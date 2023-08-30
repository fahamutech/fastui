import {
    compose,
    ensureFileExist,
    ensurePathExist,
    firstUpperCase,
    ifDoElse,
    itOrEmptyList, justList,
    snakeToCamel
} from "./util.mjs";
import {getChildren, getEffects, getExtend, getFrame, getProps, getStates, getStyles} from "./modifier.mjs";
import {writeFile, appendFile} from "node:fs/promises";

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

function sanitizeEffectDependency(data) {
    const mapWatch = watch => {
        if (`${watch}`.trim().toLowerCase().startsWith('states.')) {
            return `${watch}`.replace(/^(states.)/ig, '');
        }
        if (`${watch}`.trim().toLowerCase().startsWith('inputs.')) {
            return `${watch}`.replace(/^(inputs.)/ig, '');
        }
        return watch === undefined ? undefined : `"${watch}"`
    };
    return Array.isArray(data) ? data.map(mapWatch).join(',') : mapWatch(data);
}

function getSrcPathFromBlueprintPath(path) {
    const pathParts = `${path}`.split('/').filter(x => x !== 'blueprints');
    return `${pathParts.join('/')}`
        // .replace(/^(blueprints)/ig, 'src')
        .replace(/(.yml)/ig, '.mjs');
}

function getFilenameFromBlueprintPath(path) {
    return `${path}`.split('/').pop().replace('.yml', '');
}

function getStatesStatement(states = {}) {
    const getState = k => `${states[k]}`.trim().toLowerCase().startsWith('inputs.')
        ? `${states[k]}`.trim().replace(/^(inputs.)/ig, '')
        : JSON.stringify(states[k])
    return Object
        .keys(states ?? {})
        .map(k => `const [${k},set${firstUpperCase(k)}] = React.useState(${getState(k)});`)
        .join('\n\t');
}

function getEffectsStatement(data) {
    const effects = getEffects(data);
    const getDependencies = k => sanitizeEffectDependency(effects[k]?.watch);
    const getBody = k => `${effects[k]?.body}`.trim().toLowerCase().startsWith('logics.')
        ? `${effects[k]?.body}`.trim().replace(/^(logics.)|\(\)/ig, '')
        : effects[k]?.body ?? '{}';
    return Object
        .keys(effects ?? {})
        .map(k => `/*${k}*/
    React.useEffect(()=>${getBody(k)}({component,args:[]}),[${getDependencies(k)}]);`)
        .join('\n\t');
}

function getPropsStatement(data) {
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
                v => `${JSON.stringify(v ?? '')}`.trim()
            )
        )
    );
    return Object
        .keys(props)
        .filter(k => props[k] !== undefined && props[k] !== null)
        .map(k => `${k}={${getValue(props[k])}}`)
        .join('\n\t\t\t')
}

function getInputsStatement(data = {}) {
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
    return propsInputs.concat(statesInputs, effectsInputs, styleInputs, ['view']).join(',');
}

async function getLogicsStatement(data = {}, path = '', projectPath = '') {
    const pathParts = `${path}`.split('/');
    pathParts.pop();
    const pathSteps = pathParts.filter(x => x !== 'blueprints').map(_ => '..');
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
    const logicImportPath = `${pathSteps.join('/')}/${pathParts.join('/')}/../logics/${logicFileName}`;
    const logicFolderPath = pathParts.join('/') + '/../logics';
    await ensurePathExist(logicFolderPath);
    await ensureFileExist(`${logicFolderPath}/${logicFileName}`);
    try {
        const importedLogic = await import(`${projectPath}/${logicFolderPath}/${logicFileName}`);
        for (const e of exports) {
            if (importedLogic[e] === undefined) {
                await appendFile(`${logicFolderPath}/${logicFileName}`, `
/**
* @param data {
* {component: {states: *,inputs: *}, args: Array<*>}
* }
*/
export function ${e}(data) {
    // TODO: Implement the logic
    throw new Error('Method ${e} not implemented');
}`)
            }
        }
    } catch (e) {
        console.log(e);
    }
    return `import {${exports?.join(',')}} from '${logicImportPath}';`
}

function getBase(data) {
    const base = data?.base ?? '';
    if (`${base}` === 'image') {
        return 'img';
    } else if (`${base}` === 'text') {
        return 'span';
    } else {
        return 'div';
    }
}

function getFrameStatement(frame, child) {
    const column = '{{display: "flex",position: "relative",flexDirection: "column"}}';
    const row = '{{display: "flex",position: "relative",flexDirection: "row"}}';
    const stack = '{{position: "relative"}}';
    if (`${frame}`.trim().toLowerCase() === 'column.start') {
        return `
            <div style=${column}>
                ${child}
                {view}
            </div>
        `;
    } else if (`${frame}`.trim().toLowerCase() === 'column.end') {
        return `
            <div style=${column}>
                {view}
                ${child}
            </div>
        `;
    } else if (`${frame}`.trim().toLowerCase() === 'row.start') {
        return `
            <div style=${row}>
                ${child}
                {view}
            </div>
        `;
    } else if (`${frame}`.trim().toLowerCase() === 'row.end') {
        return `
            <div style=${row}>
                {view}
                ${child}
            </div>
        `;
    } else {
        return `
            <div style=${column}>
                ${child}
                {view}
            </div>
        `;
    }
    // else if(`${frame}`.trim().toLowerCase() === 'stack'){
    //     return `
    //         <div style="${stack}">
    //
    //             <div style="{{position: "absolute"}}">
    //                 ${child}
    //             </div>
    //         </div>
    //     `;
    // }
}

function getExtendBase(extend) {
    if (typeof extend === 'string' && extend.includes('.yml')) {
        return firstUpperCase(snakeToCamel(getFilenameFromBlueprintPath(extend)));
    }
    return undefined;
}

async function getComponentsImportStatement(extend) {
    if (typeof extend === 'string' && extend.includes('.yml')) {
        const component = firstUpperCase(snakeToCamel(getFilenameFromBlueprintPath(extend)));
        const importPath = `${extend}`.trim().startsWith('.') ? extend : `./${extend}`;
        return `import {${component}} from '${importPath.replace('.yml', '.mjs')}';`
    }
    return '';
}

export async function composeComponent({data, path, projectPath}) {
    if (!data) {
        return;
    }
    const getFileName = compose(firstUpperCase, snakeToCamel, getFilenameFromBlueprintPath);
    const children = getChildren(data);
    const base = getBase(data);

    const statesInString = getStatesStatement(getStates(data))
    const effectsString = getEffectsStatement(data);
    const propsString = getPropsStatement(data);

    const logicsStatement = await getLogicsStatement(data, path, projectPath);
    const componentsImportStatement = await getComponentsImportStatement(getExtend(data));

    const statesMap = getStateMapForLogicInput(getStates(data));
    const inputsMap = getInputsMapForLogicInput(data);
    const useMemoDependencies = [
        ...Object.keys(getStates(data)),
        getInputsStatement(data).split(',')
    ].join(',');
    const componentStatement = `const component = React.useMemo(()=>({states:{${statesMap}},inputs:{${inputsMap}}}),[${useMemoDependencies}]);`;
    const getStyleStatement = ifDoElse(
        t => `${t}`.trim().toLowerCase().startsWith('logics.'),
        t => `const style = React.useMemo(()=>${`${t}`.replace(/^(logics.)|\(\)/ig, '')}({component,args:[]}),[component]);`,
        t => `const style = React.useMemo(()=>(${getStyleMap(t)}),[${useMemoDependencies}]);`
    )
    const styleStatement = getStyleStatement(getStyles(data));

    const extendBase = getExtendBase(getExtend(data));

    const contentViewWithoutExtend = `
        <${base} 
            style={style}
            ${propsString}
        >${children?.type === 'state' || children?.type === 'input' ? `{${children?.value}}` : `${children?.value}`}</${base}>
    `;
    const contentViewWithExtend = `
        <${extendBase} view={${contentViewWithoutExtend}}></${extendBase}>
    `;

    const contentView = extendBase ? contentViewWithExtend : contentViewWithoutExtend;

    const content = `
import React from 'react';
${logicsStatement}
${componentsImportStatement}

export function ${getFileName(path)}(${getInputsStatement(data) === '' ? '' : `{${getInputsStatement(data)}}`}){
    ${statesInString}
    
    ${componentStatement}
    
    ${styleStatement}
    
    ${effectsString}
    
    return(${getFrameStatement(getFrame(data), contentView)});
}
    `;

    const srcPath = getSrcPathFromBlueprintPath(path);
    await ensurePathExist(srcPath);
    await writeFile(srcPath, content.replace(/\s+/ig, ' '));
}
