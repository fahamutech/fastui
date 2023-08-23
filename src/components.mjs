import {compose, ensurePathExist, firstUpperCase, ifDoElse, itOrEmptyList, snakeToCamel} from "./util.mjs";
import {getChildren, getEffects, getProps, getStates, getStyle} from "./modifier.mjs";
import {writeFile} from "node:fs/promises";

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
    return `${path}`.trim()
        .replace(/^(blueprints)/ig, 'src')
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

function getEffectsStatement(effects = {}) {
    const getDependencies = k => sanitizeEffectDependency(effects[k]?.watch ?? '');
    const getBody = k => `${effects[k]?.body}`.trim().toLowerCase().startsWith('logics.')
        ? `${effects[k]?.body}`.trim().replace(/^(logics.)/ig, '')
        : effects[k]?.body ?? '{}';
    return Object
        .keys(effects ?? {})
        .map(k => `/*${k}*/
    React.useEffects(()=>${getBody(k)}({component:this}),[${getDependencies(k)}]);`)
        .join('\n\t');
}

function getPropsStatement(props = {}) {
    const getValue = ifDoElse(
        v => `${v}`.trim().toLowerCase().startsWith('states.'),
        v => `${v}`.trim().replace(/^(states.)/ig, ''),
        ifDoElse(
            v => `${v}`.trim().toLowerCase().startsWith('inputs.'),
            v => `${v}`.trim().replace(/^(inputs.)/ig, ''),
            ifDoElse(
                v => `${v}`.trim().toLowerCase().startsWith('logics.'),
                v => `${v}`.trim().replace(/^(logics.)/ig, ''),
                v => `${v ?? ''}`.trim()
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

export function getBase(data) {
    const base = data?.base ?? '';
    // if (`${base}` === 'rectangle') {
    //     return 'div';
    // } else
    if (`${base}` === 'image') {
        return 'img';
    } else if (`${base}` === 'text') {
        return 'span';
    } else {
        return 'div';
    }
}

export async function composeComponent({data, path}) {
    if (!data) {
        return;
    }
    const getFileName = compose(firstUpperCase, snakeToCamel, getFilenameFromBlueprintPath);
    const children = getChildren(data);
    const base = getBase(data);

    const statesInString = getStatesStatement(getStates(data))
    const effectsString = getEffectsStatement(getEffects(data));
    const propsString = getPropsStatement(getProps(data));

    const content = `
import React from 'react';


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
