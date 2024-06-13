import {join, sep} from "node:path";

export const watchFileContent = `import {watch} from 'node:fs'
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {exec} from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

watch(join(__dirname, 'src', 'blueprints'), {recursive: true}, (event, filename) => {
    if (!\`\${filename}\`.endsWith('.yml') || \`\${filename}\`.endsWith('~')) {
        return;
    }
    const file = \`./src/blueprints/\${filename}\`;
    exec(\`fastui specs build \${file}\`, {
        cwd: __dirname
    }, (error, stdout, stderr) => {
    });
});
`;

export const specFile = ` import React from 'react'; import {getColor} from '${join('..','test','blueprints','logics','test_comp.mjs').split(sep).join('/')}'; export function TestComp({view,loopElement,loopIndex}){ const component = React.useMemo(()=>({states:{},inputs:{\"view\":view,\"loopElement\":loopElement,\"loopIndex\":loopIndex}}),[view,loopElement,loopIndex]); const style = React.useMemo(()=>({\"height\":54,\"backgroundColor\":\"blue\",\"color\":getColor({component,args: []})}),[view,loopElement,loopIndex]); return( <div style={{\"display\":\"flex\",\"flexDirection\":\"column\"}}> <div style={style} ></div> {view} </div> ); } `;
export const logicFile = `
/**
* @param data {
* {component: {states: *,inputs: *}, args: Array<*>}
* }
*/
export function getColor(data) {
    // TODO: Implement the logic
    // throw new Error('Method getColor not implemented');
}`;