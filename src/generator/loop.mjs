import {
    getComponentMemoStatement,
    getComponentsImportStatement,
    getEffectsStatement,
    getFileName,
    getFilenameFromBlueprintPath,
    getFrameStatement,
    getLogicsImportStatement,
    getPropsStatement,
    getSrcPathFromBlueprintPath,
    getStatesStatement,
    getStyleStatement,
    prepareGetContentView
} from "./index.mjs";
import {getFeed, getFrame} from "./modifier.mjs";
import {ensurePathExist, firstUpperCase, removeWhiteSpaces, snakeToCamel} from "../helpers/general.mjs";
import {writeFile} from "node:fs/promises";

function getContentViewWithoutExtend(data) {
    const feed = getFeed(data);
    const propsString = getPropsStatement(data);
    const getComponentName = x => firstUpperCase(snakeToCamel(getFilenameFromBlueprintPath(x)));
    const view = `
        <div 
            style={style}
            ${propsString}
        >
            {data?.map((item,index)=> (<div key={item?._key??keyIndex++}><${getComponentName(feed)} loopIndex={index} loopElement={item}/></div>))}
        </div>
    `;
    return feed ? view : '<span/>';
}

/**
 *
 * @param data {*} map of the specification
 * @param path {string} specification path
 * @param projectPath {string} project root path
 * @return {Promise<void>}
 */
export async function composeLoop({data, path, projectPath}) {
    if (!data) {
        return;
    }
    const statesInString = getStatesStatement(data);
    const effectsString = getEffectsStatement(data);
    const componentMemoStatement = getComponentMemoStatement(data);
    const logicsImportStatement = await getLogicsImportStatement(data, path, projectPath);
    const componentsImportStatement = getComponentsImportStatement(data);
    const styleStatement = getStyleStatement(data);

    const viewWithoutExtend = getContentViewWithoutExtend(data);

    const content = `
import React from 'react';
${logicsImportStatement}
${componentsImportStatement}

let keyIndex=0;

// eslint-disable-next-line react/prop-types
export function ${getFileName(path)}({view,loopIndex,loopElement}) {
    ${statesInString}
    
    ${componentMemoStatement}
    
    ${styleStatement}

    ${effectsString}

    return(${getFrameStatement(getFrame(data), prepareGetContentView({data, viewWithoutExtend}))});
}
    `;

    const srcPath = getSrcPathFromBlueprintPath(path);
    await ensurePathExist(srcPath);
    await writeFile(srcPath, removeWhiteSpaces(content));
}
