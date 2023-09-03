import {
    compose,
    ensureFileExist,
    ensurePathExist,
    firstUpperCase,
    ifDoElse,
    justList,
    snakeToCamel
} from "../utils/index.mjs";
import {getChildren, getEffects, getExtend, getFrame, getProps, getStyles} from "./modifier.mjs";
import {appendFile, writeFile} from "node:fs/promises";
import {
    getBase,
    getComponentMemoStatement, getComponentsImportStatement,
    getEffectsStatement,
    getFileName,
    getFilenameFromBlueprintPath,
    getFrameStatement,
    getInputsStatement, getLogicsStatement,
    getPropsStatement,
    getSrcPathFromBlueprintPath,
    getStatesStatement,
    getUseMemoDependencies,
    prepareGetContentView
} from "./index.mjs";

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

function getContentViewWithoutExtend(data) {
    const base = getBase(data);
    const propsString = getPropsStatement(data);
    const children = getChildren(data);
    return `
        <${base} 
            style={style}
            ${propsString}
        >${children?.type === 'state' || children?.type === 'input' ? `{${children?.value}}` : `${children?.value}`}</${base}>
    `;
}


export async function composeComponent({data, path, projectPath}) {
    if (!data) {
        return;
    }

    const statesInString = getStatesStatement(data)
    const effectsString = getEffectsStatement(data);

    const logicsStatement = await getLogicsStatement(data, path, projectPath);
    const componentsImportStatement = getComponentsImportStatement(data);


    const useMemoDependencies = getUseMemoDependencies(data);
    const componentStatement = getComponentMemoStatement(data);
    const getStyleStatement = ifDoElse(
        t => `${t}`.trim().toLowerCase().startsWith('logics.'),
        t => `const style = React.useMemo(()=>${`${t}`.replace(/^(logics.)|\(\)/ig, '')}({component,args:[]}),[component]);`,
        t => `const style = React.useMemo(()=>(${getStyleMap(t)}),[${useMemoDependencies}]);`
    );
    const styleStatement = getStyleStatement(getStyles(data));
    const viewWithoutExtend = getContentViewWithoutExtend(data);

    const content = `
import React from 'react';
${logicsStatement}
${componentsImportStatement}

export function ${getFileName(path)}(${getInputsStatement(data) === '' ? '' : `{${getInputsStatement(data)}}`}){
    ${statesInString}
    
    ${componentStatement}
    
    ${styleStatement}
    
    ${effectsString}
    
    return(${getFrameStatement(getFrame(data), prepareGetContentView({data, viewWithoutExtend}))});
}
    `;

    const srcPath = getSrcPathFromBlueprintPath(path);
    await ensurePathExist(srcPath);
    await writeFile(srcPath, content.replace(/\s+/ig, ' '));
}
