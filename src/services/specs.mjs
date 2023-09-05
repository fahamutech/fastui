import {glob} from "glob";
import * as yaml from "js-yaml"
import {readFile} from 'node:fs/promises'
import {join, resolve as pathResolve, sep as pathSep} from 'node:path'

export async function readSpecs(unParsedRootFolder) {
    const cwd = process.cwd();
    const rootFolder = pathResolve(unParsedRootFolder).replace(cwd, '.');
    // console.log(rootFolder);
    if (`${rootFolder}`.endsWith('.yml')) {
        const rootParts = `${rootFolder}`.split(pathSep);
        const rootFileName = rootParts.pop();
        const pattern =
            `${rootParts.join('/')}/**/${rootFileName.replace('.yml', '')}.yml`;
        console.log(pattern,'----PATTERN----')
        return await glob(pattern, {
            ignore: ['**/node_modules/**']
        });
    }
    const root = rootFolder === pathSep
        ? `./`
        : rootFolder?.endsWith(pathSep)
            ? rootFolder?.replace(pathSep,'/')
            : `${rootFolder ?? '.'}/`;
    const pattern = `${root.replace(pathSep,'/')}**/*.yml`;
    console.log(pattern,'----PATTERN----')
    return await glob(pattern, {
        ignore: ['**/node_modules/**']
    });
}

export async function specToJSON(specPath) {
    return yaml.load(await readFile(pathResolve(specPath), {encoding: 'utf-8'}), {});
}

