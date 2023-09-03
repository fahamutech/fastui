import {
    getComponentMemoStatement,
    getComponentsImportStatement,
    getEffectsStatement,
    getFileName,
    getFilenameFromBlueprintPath,
    getFrameStatement,
    getLogicsStatement,
    getSrcPathFromBlueprintPath,
    getStatesStatement,
    prepareGetContentView
} from "./index.mjs";
import {getExtend, getFrame, getLeft, getRight} from "./modifier.mjs";
import {ensurePathExist, firstUpperCase, snakeToCamel} from "../utils/index.mjs";
import {writeFile} from "node:fs/promises";

function getContentViewWithoutExtend(data) {
    const extend = getExtend(data);
    const left = getLeft(data);
    const right = getRight(data);
    const getComponentName = x => firstUpperCase(snakeToCamel(getFilenameFromBlueprintPath(x)));
    const leftComponent = left ? `<${getComponentName(left)}/>` : '<span/>';
    const rightComponent = right ? `<${getComponentName(right)}/>` : '<span/>';
    const view = `condition===true?${rightComponent}:${leftComponent}`;
    return extend ? view : `{${view}}`;
}

export async function composeCondition({data, path, projectPath}) {
    // console.log(data);
    if (!data) {
        return;
    }
    const statesInString = getStatesStatement(data);
    const effectsString = getEffectsStatement(data);
    const componentStatement = getComponentMemoStatement(data);
    const logicsStatement = await getLogicsStatement(data, path, projectPath);
    const componentsImportStatement = getComponentsImportStatement(data);

    const viewWithoutExtend = getContentViewWithoutExtend(data);

    const content = `
import React from 'react';
${logicsStatement}
${componentsImportStatement}

export function ${getFileName(path)}({view}) {
    ${statesInString}
    
    ${componentStatement}

    ${effectsString}

    return(${getFrameStatement(getFrame(data), prepareGetContentView({data, viewWithoutExtend}))});
}
    `;

    const srcPath = getSrcPathFromBlueprintPath(path);
    await ensurePathExist(srcPath);
    await writeFile(srcPath, content.replace(/\s+/ig, ' '));
}
