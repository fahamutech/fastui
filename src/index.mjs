import {glob} from "glob";
import * as yaml from "js-yaml"
import {readFile} from 'node:fs/promises'

export async function readSpecs(rootFolder) {
    const root = rootFolder === '/' ? './' : rootFolder?.endsWith('/') ? rootFolder : `${rootFolder ?? '.'}/`;
    // console.log(root,'ROOOT');
    return await glob(`${root}**/*.yml`);
}

export async function specToJSON(specPath) {
    return yaml.load(await readFile(specPath, {encoding: 'utf-8'}),{});
}

