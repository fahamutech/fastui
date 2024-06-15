import {
    getComponentMemoStatement,
    getComponentsImportStatement,
    getConditionFrameStatement,
    getEffectsStatement,
    getFileName,
    getFilenameFromBlueprintPath,
    getLogicsImportStatement,
    getSrcPathFromBlueprintPath,
    getStatesStatement,
    prepareGetContentView
} from "./index.mjs";
import {getExtend, getFrame, getLeft, getRight} from "./modifier.mjs";
import {ensurePathExist, firstUpperCase, removeWhiteSpaces, snakeToCamel} from "../utils/index.mjs";
import {writeFile} from "node:fs/promises";

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
    const styleString = JSON.stringify(styleWithFrameDirection);

    const getComponentName = x => firstUpperCase(snakeToCamel(getFilenameFromBlueprintPath(x)));
    const leftComponent = left ? `<div style={${styleString}}><${getComponentName(left)} loopIndex={loopIndex} loopElement={loopElement}/></div>` : '<span/>';
    const rightComponent = right ? `<div style={${styleString}}><${getComponentName(right)} loopIndex={loopIndex} loopElement={loopElement}/></div>` : '<span/>';
    const view = `condition===true?${rightComponent}:${leftComponent}`;
    return extend ? view : `{${view}}`;
}

export async function composeCondition({data, path, projectPath}) {
    if (!data) {
        return;
    }
    const statesInString = getStatesStatement(data);
    const effectsString = getEffectsStatement(data);
    const componentStatement = getComponentMemoStatement(data);
    const logicsStatement = await getLogicsImportStatement(data, path, projectPath);
    const componentsImportStatement = getComponentsImportStatement(data);

    const viewWithoutExtend = getContentViewWithoutExtend(data);

    const content = `
import React from 'react';
${logicsStatement}
${componentsImportStatement}

export function ${getFileName(path)}({view,loopIndex,loopElement}) {
    ${statesInString}
    
    ${componentStatement}

    ${effectsString}

    return(${getConditionFrameStatement(getFrame(data), prepareGetContentView({data, viewWithoutExtend}))});
}
    `;

    const srcPath = getSrcPathFromBlueprintPath(path);
    await ensurePathExist(srcPath);
    await writeFile(srcPath, removeWhiteSpaces(content));
}
