import {glob} from "glob";
import * as yaml from "js-yaml"
import {readFileSync} from 'node:fs'

export async function readSpecs(rootFolder){
    const root = rootFolder==='/'?'./':rootFolder?.endsWith('/')?rootFolder:`${rootFolder??'.'}/`;
    console.log(root,'ROOOT');
    return await glob(`${root}**/*.yml`);
}

export async function specToJSON(specPath){
   return yaml.load(readFileSync(specPath, {encoding: 'utf-8'}));
}

export async function composeComponent(data){
    console.log(data);
}