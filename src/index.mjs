import {glob} from "glob";
import * as yaml from "js-yaml"
import {readFile, writeFile} from 'node:fs/promises'
import {ensurePathExist, snakeToCamel} from "./util.mjs";
import {getChildren} from "./modifier.mjs";

export async function readSpecs(rootFolder) {
    const root = rootFolder === '/' ? './' : rootFolder?.endsWith('/') ? rootFolder : `${rootFolder ?? '.'}/`;
    // console.log(root,'ROOOT');
    return await glob(`${root}**/*.yml`);
}

export async function specToJSON(specPath) {
    return yaml.load(await readFile(specPath, {encoding: 'utf-8'}));
}

export async function composeComponent({data, path}) {
    if (!data) {
        return;
    }
    const srcPath = `${path}`.trim()
        .replace(/^(blueprints)/ig, 'src')
        .replace(/(.yml)/ig, '.mjs');
    const fileName = `${path}`.split('/').pop().replace('.yml', '');
    const camelCashFileName = snakeToCamel(fileName);
    const style = {...data?.modifier ?? {}, props: undefined};
    const children = getChildren({...data?.modifier} ?? {});

    const content = `
import React from 'react';

export function ${camelCashFileName}(props){

    return(
        <div style={${JSON.stringify(style)}}>
            ${children?.type === 'state' ? `{${children?.value}}` : `${children?.value}`}
        </div>
    )
}
    `;
    await ensurePathExist(srcPath);
    await writeFile(srcPath, content);
}