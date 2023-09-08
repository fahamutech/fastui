import {ensureFileExist, ensurePathExist} from "../utils/index.mjs";
import {join, resolve} from "node:path";
import {writeFile} from "node:fs/promises";


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