import {ensurePathExist, removeWhiteSpaces} from "../helpers/general.mjs";
import {getChildren, getFrame} from "./modifier.mjs";
import {writeFile} from "node:fs/promises";
import {
    getBase,
    getComponentMemoStatement,
    getComponentsImportStatement,
    getEffectsStatement,
    getFileName,
    getFrameStatement,
    getInputsStatement,
    getLogicsImportStatement,
    getPropsStatement,
    getSrcPathFromBlueprintPath,
    getStatesStatement,
    getStyleStatement,
    prepareGetContentView
} from "./index.mjs";

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

    const logicsStatement = await getLogicsImportStatement(data, path, projectPath);
    const componentsImportStatement = getComponentsImportStatement(data);
    const componentStatement = getComponentMemoStatement(data);

    const styleStatement = getStyleStatement(data);
    const viewWithoutExtend = getContentViewWithoutExtend(data);

    const content = `
import React from 'react';
${logicsStatement}
${componentsImportStatement}

// eslint-disable-next-line react/prop-types
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
    await writeFile(srcPath, removeWhiteSpaces(content));
}

