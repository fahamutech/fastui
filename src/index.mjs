#! /usr/bin/env node


import {readSpecs, specToJSON} from "./services/specs.mjs";
import {composeComponent} from "./services/component.mjs";
import {composeCondition} from "./services/condition.mjs";
import {composeLoop} from "./services/loop.mjs";

const {argv} = process;

const command1 = argv[2];

function getMergedCondition(condition) {
    const {base,styles={}} = condition?.modifier?.frame??{};
    const frameBase  = base??condition?.modifier?.frame;
    return condition ? {
        ...condition,
        base: 'rectangle',
        modifier: {
            ...condition?.modifier ?? {},
            frame: {
                base: `${frameBase}`.replace(/(\.\s*stack)/ig, ''),
                styles,
            },
            states: {condition: false},
            effects: {onStart: {body: 'logics.onStart', watch: []}},
            props: {}
        }
    } : undefined;
}
function getMergedLoop(loop) {
    const {base,styles={}} = loop?.modifier?.frame??{};
    const frameBase  = base??loop?.modifier?.frame;
    return loop ? {
        ...loop,
        base: 'rectangle',
        modifier: {
            ...loop?.modifier ?? {},
            frame: {
                base: `${frameBase}`.replace(/(\.\s*stack)/ig, ''),
                styles,
            },
            states: {data: []},
            effects: {onStart: {body: 'logics.onStart', watch: []}},
        }
    } : undefined;
}

switch (command1) {
    case 'specs':
        const specsCommand = argv[3];
        switch (specsCommand) {
            case 'list':
                console.log(await readSpecs(argv[4]));
                done();
                break;
            case 'build':
                const specsPath = await readSpecs(argv[4]);
                for (const specPath of specsPath) {
                    const data = await specToJSON(specPath);
                    const {component, components, condition,loop} = JSON.parse(JSON.stringify(data??{}));
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
    default:
        notFound(command1);
}

function notFound(command) {
    console.log(`INFO : Command not found ${command1}`);
}

function done() {
    console.log(`INFO : Done build specs`);
}