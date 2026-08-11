import {
    getComponentMemoStatement,
    getActionImportStatement,
    getComponentsImportStatement,
    getConditionFrameStatement,
    getEffectsStatement,
    getFileName,
    getFilenameFromBlueprintPath,
    getLogicsImportStatement, getPropsStatement,
    getModuleStoreImportStatement,
    getSrcPathFromBlueprintPath,
    getStatesStatement,
    prepareGetContentView
} from "./index.mjs";
import {getExtend, getFrame, getLeft, getRight} from "./modifier.mjs";
import {ensurePathExist, firstUpperCase, removeWhiteSpaces, snakeToCamel} from "../utils/index.mjs";
import {writeFile} from "node:fs/promises";
import {getTemplateSelected} from "../utils/config.mjs";
import {composeFlutterCondition} from "./templates/flutter/generator.mjs";

function getContentViewWithoutExtend(data) {
    const {styles, base} = getFrame(data) ?? {};
    const extend = getExtend(data);
    const left = getLeft(data);
    const right = getRight(data);
    const styleWithFrameDirection = {
        ...styles,
        display: 'flex',
        flexDirection: base?.startsWith('row') ? 'row' : 'column',
        [base?.startsWith('row') ? 'marginRight' : 'marginBottom']: styles?.spaceValue,
        // spaceField: undefined,
        spaceValue: undefined
    }
    const styleString = JSON.stringify(styleWithFrameDirection)
        .replace(/asset:\/\/figma\//g, '/images/figma/');
    const propsString = getPropsStatement(data);
    // console.log(propsString,'-----',data)

    const getComponentName = x => firstUpperCase(snakeToCamel(getFilenameFromBlueprintPath(x)));
    const leftComponent = left ? `<div style={${styleString}} ${propsString}><${getComponentName(left)} loopIndex={loopIndex} loopElement={loopElement}/></div>` : '<span/>';
    const rightComponent = right ? `<div style={${styleString}} ${propsString}><${getComponentName(right)} loopIndex={loopIndex} loopElement={loopElement}/></div>` : '<span/>';
    const view = right ? `condition===true?${rightComponent}:${leftComponent}` : leftComponent;
    return extend ? view : `{${view}}`;
}

export async function composeCondition({data, path, projectPath}) {
    if (!data) {
        return;
    }
    if (getTemplateSelected() === 'flutter') {
        return composeFlutterCondition({data, path, projectPath});
    }
    const statesInString = getStatesStatement(data, path);
    const effectsString = getEffectsStatement(data);
    const componentStatement = getComponentMemoStatement(data);
    const logicsStatement = await getLogicsImportStatement(data, path, projectPath);
    const storeStatement = getModuleStoreImportStatement(data, path);
    const componentsImportStatement = getComponentsImportStatement(data);
    const actionImportStatement = getActionImportStatement(data, path);

    const viewWithoutExtend = getContentViewWithoutExtend(data);

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

    return(${getConditionFrameStatement(data, prepareGetContentView({data, viewWithoutExtend}))});
}
    `;

    const srcPath = getSrcPathFromBlueprintPath(path);
    await ensurePathExist(srcPath);
    await writeFile(srcPath, removeWhiteSpaces(content));
}
