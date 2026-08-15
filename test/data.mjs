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

export const specFile = `
import React from 'react';
import {getColor} from '../services/test_comp.mjs';

// eslint-disable-next-line react/prop-types
export function TestComp({loopElement, loopIndex, overrideStyles={}, overrideProps={}, overrideStates={}}) {
    // eslint-disable-next-line no-unused-vars
    const component = React.useMemo(() => ({
        states: {},
        inputs: {"loopElement": loopElement, "loopIndex": loopIndex}
    }), [loopElement, loopIndex]);
    
    const _baseStyle = React.useMemo(() => ({
        "height": 54,
        "backgroundColor": "blue",
        "color": getColor({component, args: []})
    }), [component]);
    const style = React.useMemo(() => ({..._baseStyle, ...overrideStyles}), [_baseStyle, overrideStyles]);
    
    return (
        <div style={style} {...overrideProps}></div>
    );
}
    
`;

export const logicFile = `
/**
* @param data {
* {component: {states: *,inputs: *}, args: Array<*>}
* }
*/
export function getColor(data) {
    // TODO: Implement the logic
}`;
