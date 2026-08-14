/**
 * Project scaffolding side effects that aren't spec translation or code
 * generation: creating the blueprint folder, the file-watcher script, the
 * IDE-facing JSON schema, and the `npm start` wiring for a React project.
 */
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile, writeFile} from 'node:fs/promises';
import os from 'os';
import {ensureFileExist, ensurePathExist} from '../shared/fs.mjs';

// fastui.schema.json ships alongside package.json at the package root; read
// it from there instead of keeping a second, driftable copy inline.
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Copies the packaged FastUI JSON schema into the target project so editors
 * can offer autocomplete/validation for blueprint YAML files.
 */
export async function ensureSchemaFileExist() {
    const filePath = resolve(join('fastui.schema.json'));
    await ensureFileExist(filePath);
    const schema = await readFile(resolve(packageRoot, 'fastui.schema.json'), 'utf8');
    await writeFile(filePath, schema);
}

export async function ensureWatchFileExist(blueprintRoot = join('src', 'blueprints')) {
    const filePath = resolve(join('watch.mjs'));
    await ensureFileExist(filePath);
    await writeFile(filePath, `import {watch} from 'node:fs'
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {exec} from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const blueprintRoot = ${JSON.stringify(blueprintRoot.split('\\').join('/'))};

let calledTimes = 0;
const changes = {};
let timeout;

function getTimeout() {
    return setTimeout(() => {
        for (const filename of Object.values(changes)) {
            if (!\`\${filename}\`.endsWith('.yml') || \`\${filename}\`.endsWith('~')) {
                return;
            }
            const file = \`./\${blueprintRoot}/\${filename}\`;
            delete changes[filename];
            calledTimes-=1;
            exec(\`fastui specs build \${file}\`, {
                cwd: __dirname
            }, (error, stdout, stderr) => {
            });
        }
    }, calledTimes > 0 ? 2000 : 100);
}

watch(join(__dirname, ...blueprintRoot.split('/')), {recursive: true}, (event, filename) => {
    if (!\`\${filename}\`.endsWith('.yml') || \`\${filename}\`.endsWith('~')) {
        return;
    }
    if (calledTimes > 0) {
        clearTimeout(timeout);
        changes[filename]=filename;
        timeout = getTimeout();
        calledTimes += 1;
        return;
    }
    calledTimes = 1;
    changes[filename]=filename;
    timeout = getTimeout();
});
`);
}

export async function ensureBlueprintFolderExist(blueprintRoot = join('src', 'blueprints')) {
    const filePath = resolve(blueprintRoot);
    await ensurePathExist(filePath);
}

export async function ensureStartScript(template = 'reactjs', blueprintRoot = join('src', 'blueprints')) {
    if (template !== 'reactjs') return;
    const isWin = os.platform() === 'win32';
    const joiner = isWin ? '|' : '&';
    const filePath = resolve(join('package.json'));
    await ensureFileExist(filePath);
    const file = await readFile(filePath, {encoding: 'utf-8'});
    const fileMap = JSON.parse(`${file}`.trim().startsWith('{') ? file : '"{}"');
    const {scripts = {}} = fileMap;
    const {start, dev = 'vite'} = scripts;
    const current = start || dev;
    const startParts = `${current}`.split(joiner).map(value => value.trim());
    const lastScript = startParts.find(value => !value.includes('watch.mjs') && !value.includes('fastui specs build')) || dev;
    await writeFile(filePath, JSON.stringify({
        ...fileMap,
        scripts: {
            ...scripts,
            start: `node ./watch.mjs ${joiner} fastui specs build ./${blueprintRoot.split('\\').join('/')} ${joiner} ${lastScript}`
        }
    }, null, 2));
}
