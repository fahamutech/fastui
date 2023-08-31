import {glob} from "glob";
import * as yaml from "js-yaml"
import {readFile} from 'node:fs/promises'

export async function readSpecs(rootFolder) {
    if (`${rootFolder}`.endsWith('.yml')) {
        const rootParts = `${rootFolder}`.split('/');
        const rootFileName = rootParts.pop();
        const pattern = `${rootParts.join('/')}/**/${rootFileName.replace('.yml', '')}.yml`;
        // console.log(pattern, 'FILENAME');
        return await glob(pattern, {
            ignore: ['**/node_modules/**']
        });
    }
    const root = rootFolder === '/' ? './' : rootFolder?.endsWith('/') ? rootFolder : `${rootFolder ?? '.'}/`;
    return await glob(`${root}**/*.yml`, {
        ignore: ['**/node_modules/**']
    });
}

export async function specToJSON(specPath) {
    return yaml.load(await readFile(specPath, {encoding: 'utf-8'}), {});
}

