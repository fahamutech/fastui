#! /usr/bin/env node


import {readSpecs, specToJSON} from "./services/specs.mjs";
import {composeComponent} from "./services/component.mjs";
import {composeCondition} from "./services/condition.mjs";

const {argv} = process;

const command1 = argv[2];

function getMergedCondition(condition) {
    return condition ? {
        ...condition,
        base: 'rectangle',
        modifier: {
            ...condition?.modifier ?? {},
            frame: condition?.modifier?.frame
                ? `${condition?.modifier?.frame}`.replace(/(\.\s*stack)/ig, '')
                : condition?.modifier?.frame,
            states: {condition: false},
            effects: {onStart: {body: 'logics.onStart', watch: []}},
            props: {}
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
                    const {component, components, condition} = JSON.parse(JSON.stringify(data));
                    const paths = {path: specPath, projectPath: process.cwd()};
                    await composeComponent({data: components ?? component, ...paths});
                    const mergedCondition = getMergedCondition(condition);
                    await composeCondition({data: mergedCondition, ...paths});
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