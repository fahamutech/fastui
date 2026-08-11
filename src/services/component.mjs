import {ensurePathExist, removeWhiteSpaces} from "../utils/index.mjs";
import {getChildren, getFrame} from "./modifier.mjs";
import {writeFile} from "node:fs/promises";
import {
    getBase,
    getActionImportStatement,
    getComponentMemoStatement,
    getComponentsImportStatement,
    getEffectsStatement,
    getFileName,
    getFrameStatement,
    getInputsStatement,
    getLogicsImportStatement,
    getModuleStoreImportStatement,
    getPropsStatement,
    getSrcPathFromBlueprintPath,
    getStatesStatement,
    getStyleStatement,
    prepareGetContentView
} from "./index.mjs";
import {getTemplateSelected} from "../utils/config.mjs";
import {composeFlutterComponent} from "./templates/flutter/generator.mjs";

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
    if (getTemplateSelected() === 'flutter') {
        return composeFlutterComponent({data, path, projectPath});
    }

    const statesInString = getStatesStatement(data, path)
    const effectsString = getEffectsStatement(data);

    const logicsStatement = await getLogicsImportStatement(data, path, projectPath);
    const storeStatement = getModuleStoreImportStatement(data, path);
    const componentsImportStatement = getComponentsImportStatement(data);
    const actionImportStatement = getActionImportStatement(data, path);
    const componentStatement = getComponentMemoStatement(data);

    const styleStatement = getStyleStatement(data);
    const viewWithoutExtend = getContentViewWithoutExtend(data);

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
    
    return(${getFrameStatement(getFrame(data), prepareGetContentView({data, viewWithoutExtend}))});
}
    `;

    const srcPath = getSrcPathFromBlueprintPath(path);
    await ensurePathExist(srcPath);
    await writeFile(srcPath, removeWhiteSpaces(content));
}
