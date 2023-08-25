import {
    compose,
    ensureFileExist,
    ensurePathExist,
    firstUpperCase,
    ifDoElse,
    itOrEmptyList,
    snakeToCamel
} from "./util.mjs";
import {getChildren, getEffects, getProps, getStates, getStyle} from "./modifier.mjs";
import {writeFile, appendFile} from "node:fs/promises";

function getStateMapForLogicInput(states) {
    return Object.keys(states).reduce((a, b) => {
        return a.concat(`"${b}":${b}, "set${firstUpperCase(b)}": set${firstUpperCase(b)}`)
    }, '');
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
        return `"${watch}"`
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
    const states = getStates(data);
    const statesMap = getStateMapForLogicInput(states);
    const inputsMap = getInputsMapForLogicInput(data);
    const getDependencies = k => sanitizeEffectDependency(effects[k]?.watch ?? '');
    const getBody = k => `${effects[k]?.body}`.trim().toLowerCase().startsWith('logics.')
        ? `${effects[k]?.body}`.trim().replace(/^(logics.)/ig, '')
        : effects[k]?.body ?? '{}';
    return Object
        .keys(effects ?? {})
        .map(k => `/*${k}*/
    React.useEffect(()=>${getBody(k)}({component:{states: {${statesMap}}, inputs: {${inputsMap}}},args:[]}),[${getDependencies(k)}]);`)
        .join('\n\t');
}

function getPropsStatement(data) {
    const props = getProps(data);
    const states = getStates(data);
    const statesMap = getStateMapForLogicInput(states);
    const inputsMap = getInputsMapForLogicInput(data);
    const getValue = ifDoElse(
        v => `${v}`.trim().toLowerCase().startsWith('states.'),
        v => `${v}`.trim().replace(/^(states.)/ig, ''),
        ifDoElse(
            v => `${v}`.trim().toLowerCase().startsWith('inputs.'),
            v => `${v}`.trim().replace(/^(inputs.)/ig, ''),
            ifDoElse(
                v => `${v}`.trim().toLowerCase().startsWith('logics.'),
                v => `(...args)=>${`${v}`.trim().replace(/^(logics.)/ig, '')}({component:{states:{${statesMap}},inputs:{${inputsMap}}},args})`,
                v => `${JSON.stringify(v?? '')}`.trim()
            )
        )
    )
    return Object
        .keys(props)
        .filter(k => props[k] !== undefined && props[k] !== null)
        .map(k => `${k}={${getValue(props[k])}}`)
        .join('\n\t\t\t')
}

function getInputsStatement(data = {}) {
    const filter = x => `${x}`.trim().toLowerCase().startsWith('inputs.');
    const map = x => `${x}`.trim().replace(/^(inputs.)/ig, '');
    const propsInputs = Object.values({...data?.modifier?.props ?? {}}).filter(filter).map(map);
    const statesInputs = Object.values({...data?.modifier?.states ?? {}}).filter(filter).map(map);
    const effects = {...data?.modifier?.effects ?? {}};
    const effectsInputs = Object.keys(effects).reduce((a, b) => {
        return [
            ...a,
            ...itOrEmptyList(effects[b]?.watch).filter(filter).map(map)
        ]
    }, []);
    return propsInputs.concat(statesInputs, effectsInputs).join(',');
}

async function getLogicsStatement(data = {}, path = '', projectPath = '', states = {}) {
    const pathParts = `${path}`.split('/');
    pathParts.pop();
    const pathSteps = pathParts.filter(x => x !== 'blueprints').map(_ => '..');
    const filter = x => `${x}`.trim().toLowerCase().startsWith('logics.');
    const map = x => `${x}`.trim().replace(/^(logics.)/ig, '');
    const propsInputs = Object.values({...data?.modifier?.props ?? {}}).filter(filter).map(map);
    const effects = {...data?.modifier?.effects ?? {}};
    const effectsInputs = Object.keys(effects).reduce((a, b) => {
        return [
            ...a,
            `${effects[b]?.body}`.trim().replace(/^(logics.)/ig, '')
        ]
    }, []);
    const exports = Array.from([...propsInputs, ...effectsInputs].reduce((a, b) => a.add(b), new Set()));

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
    return `import {${exports?.join(',')}} from '${logicImportPath}'`
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

    const logicsStatement = await getLogicsStatement(data, path, projectPath, getStates(data));

    const content = `
import React from 'react';
${logicsStatement}

export function ${getFileName(path)}({${getInputsStatement(data)}}){
    ${statesInString}
    
    ${effectsString}
    
    return(
        <${base} 
            style={${JSON.stringify(getStyle(data))}}
            ${propsString}
        >
            ${children?.type === 'state' || children?.type === 'input' ? `{${children?.value}}` : `${children?.value}`}
        </${base}>
    );
}
    `;

    const srcPath = getSrcPathFromBlueprintPath(path);
    await ensurePathExist(srcPath);
    await writeFile(srcPath, content);
}
