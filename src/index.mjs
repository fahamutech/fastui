#! /usr/bin/env node


import {readSpecs, specToJSON} from "./services/specs.mjs";
import {composeComponent} from "./services/component.mjs";
import {composeCondition} from "./services/condition.mjs";
import {composeLoop} from "./services/loop.mjs";
import {
    ensureAppRouteFileExist,
    ensureBlueprintFolderExist,
    ensureSchemaFileExist,
    ensureStartScript,
    ensureWatchFileExist, loadEnvFile
} from "./services/helper.mjs";
import {
    fetchFigmaFile,
    getDesignDocument,
    getPagesAndTraverseChildren,
    walkFrameChildren
} from "./services/automation/figma.mjs";
import {join, resolve} from "node:path";

const {argv} = process;

const command1 = argv[2];

function getMergedCondition(condition) {
    const {base, styles = {},id} = condition?.modifier?.frame ?? {};
    const frameBase = base ?? condition?.modifier?.frame ?? 'column.start';
    return condition ? {
        ...condition,
        base: 'rectangle',
        modifier: {
            ...condition?.modifier ?? {},
            frame: {
                id,
                base: `${frameBase}`.replace(/(\.\s*stack)/ig, ''),
                styles,
            },
            states: {condition: false},
            effects: {onStart: {body: 'logics.onStart', watch: []}},
            // props: {}
        }
    } : undefined;
}

function getMergedLoop(loop) {
    const {base, styles = {}, id} = loop?.modifier?.frame ?? {};
    const frameBase = base ?? loop?.modifier?.frame;
    return loop ? {
        ...loop,
        base: 'rectangle',
        modifier: {
            ...loop?.modifier ?? {},
            frame: {
                id,
                base: `${frameBase}`.replace(/(\.\s*stack)/ig, ''),
                styles,
            },
            states: {data: []},
            effects: {onStart: {body: 'logics.onStart', watch: []}},
        }
    } : undefined;
}

const specsCommand = argv[3];
switch (command1) {
    case 'specs':
        switch (specsCommand) {
            case 'list':
                console.log(await readSpecs(argv[4]));
                done();
                break;
            case 'automate':
                await ensureBlueprintFolderExist();
                const srcPath = resolve(join(process.cwd(), 'src', 'blueprints'));
                await loadEnvFile();
                // console.log(process.env);
                const token = process.env.FIGMA_TOKEN;
                const figFile = process.env.FIGMA_FILE;
                const data = await fetchFigmaFile({token, figFile});
                const document = getDesignDocument(data);
                const children = await getPagesAndTraverseChildren({document, srcPath, token, figFile});
                await walkFrameChildren({children, srcPath, token, figFile});
                await ensureAppRouteFileExist({
                    pages: children.map(x => ({
                        name: x?.name,
                        module: x?.module,
                        id: x?.id
                    })),
                    initialId: document?.flowStartingPoints?.[0]?.nodeId
                });
                break;
            case 'build':
                for (const specPath of await readSpecs(argv[4])) {
                    const data = await specToJSON(specPath);
                    // console.log(JSON.stringify(data,null,2), specPath);
                    const {component, components, condition, loop} = JSON.parse(JSON.stringify(data ?? {}));
                    const paths = {path: specPath, projectPath: process.cwd()};
                    await composeComponent({data: components ?? component, ...paths});
                    const mergedCondition = getMergedCondition(condition);
                    await composeCondition({data: mergedCondition, ...paths});
                    const mergedLoop = getMergedLoop(loop);
                    await composeLoop({data: mergedLoop, ...paths});
                }
                done();
                break;
            default:
                notFound(specsCommand);
        }
        break;
    case 'watch':
        await ensureWatchFileExist();
        done('INFO : Done create watch file');
        break;
    case 'init':
        await ensureBlueprintFolderExist();
        await ensureWatchFileExist();
        await ensureSchemaFileExist();
        await ensureStartScript();
        done('INFO : Done initiate');
        break;
    default:
        notFound(command1);
}

function notFound(command) {
    console.log(`INFO : Command not found ${command}`);
}

function done(message = 'INFO : Done build specs') {
    console.log(message);
}