import {ensureFileExist, ensurePathExist} from "../utils/index.mjs";
import {join, resolve} from "node:path";
import {readFile, writeFile} from "node:fs/promises";
import os from "os";


export async function ensureWatchFileExist() {
    const filePath = resolve(join('watch.mjs'));
    await ensureFileExist(filePath);
    await writeFile(filePath, `import {watch} from 'node:fs'
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
`);
}

export async function ensureBlueprintFolderExist() {
    const filePath = resolve(join('src', 'blueprints'));
    await ensurePathExist(filePath);
}

export async function ensureStartScript() {
    const isWin = os.platform() === 'win32';
    const joiner = isWin ? '|' : '&';
    const filePath = resolve(join('package.json'));
    await ensureFileExist(filePath);
    const file = await readFile(filePath, {encoding: 'utf-8'});
    const fileMap = JSON.parse(`${file}`.trim().startsWith('{')?file:'"{}"');
    const {scripts = {}} = fileMap;
    const {start = 'echo \"no command\"'} = scripts;
    const startParts = `${start}`.split(joiner);
    const lastScript = startParts.pop().trim();
    await writeFile(filePath, JSON.stringify({
        ...fileMap,
        scripts: {
            ...scripts,
            start: `node ./watch.mjs ${joiner} fastui specs build ./src/blueprints ${joiner} ${lastScript}`
        }
    }, null, 2));
}