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
        const pattern = `${rootParts.join(pathSep)}${pathSep}**${pathSep}${rootFileName.replace('.yml', '')}.yml`;
        return await glob(pattern, {
            ignore: [join('**', pathSep, 'node_modules', pathSep, '**')]
        });
    }
    const root = rootFolder === pathSep
        ? `.${pathSep}`
        : rootFolder?.endsWith(pathSep)
            ? rootFolder
            : `${rootFolder ?? '.'}${pathSep}`;
    return await glob(`${root}**${pathSep}*.yml`, {
        ignore: [join('**', pathSep, 'node_modules', pathSep, '**')]
    });
}

export async function specToJSON(specPath) {
    return yaml.load(await readFile(pathResolve(specPath), {encoding: 'utf-8'}), {});
}

