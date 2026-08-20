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
import {createFastUIComponentContext} from '../../src/fastui_runtime.mjs';

// eslint-disable-next-line react/prop-types
export const TestComp = React.memo(function TestComp({loopElement, loopIndex, instanceId, initialState={}, initialProps={}}) {
    const resolvedInstanceId = instanceId ?? "test_comp";
    const inputs = {loopElement, loopIndex};
    const componentStore = null;
    const component = React.useMemo(() => createFastUIComponentContext({
        store: componentStore,
        componentId: "test_comp",
        instanceId: resolvedInstanceId,
        inputs
    }), [componentStore, resolvedInstanceId, loopElement, loopIndex]);
    const style = {
        "height": 54,
        "backgroundColor": "blue",
        "color": getColor(component.withArgs([]))
    };
    return (
        <div style={style} {...initialProps}></div>
    );
});
    
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
