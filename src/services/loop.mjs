import {
    getComponentMemoStatement,
    getComponentsImportStatement,
    getEffectsStatement,
    getFileName,
    getFilenameFromBlueprintPath,
    getFrameStatement,
    getLogicsStatement,
    getPropsStatement,
    getSrcPathFromBlueprintPath,
    getStatesStatement,
    getStyleStatement,
    prepareGetContentView
} from "./index.mjs";
import {getFeed, getFrame} from "./modifier.mjs";
import {ensurePathExist, firstUpperCase, snakeToCamel} from "../utils/index.mjs";
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
    // const view = `condition===true?${rightComponent}:${leftComponent}`;
    return feed ? view : '<span/>';
}

export async function composeLoop({data, path, projectPath}) {
    // console.log(data);
    if (!data) {
        return;
    }
    const statesInString = getStatesStatement(data);
    const effectsString = getEffectsStatement(data);
    const componentStatement = getComponentMemoStatement(data);
    const logicsStatement = await getLogicsStatement(data, path, projectPath);
    const componentsImportStatement = getComponentsImportStatement(data);
    const styleStatement = getStyleStatement(data);

    const viewWithoutExtend = getContentViewWithoutExtend(data);

    const content = `
import React from 'react';
${logicsStatement}
${componentsImportStatement}

let keyIndex=0;

export function ${getFileName(path)}({view}) {
    ${statesInString}
    
    const loopIndex = React.useMemo(()=>undefined,[]);
    const loopElement = React.useMemo(()=>undefined,[]);
    
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
