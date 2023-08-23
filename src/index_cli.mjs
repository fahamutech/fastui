#! /usr/bin/env node


import {readSpecs, specToJSON} from "./index.mjs";
import {composeComponent} from "./components.mjs";

const {argv} = process;

const command1 = argv[2];

switch (command1) {
    case 'specs':
        const specsCommand = argv[3];
        switch (specsCommand) {
            case 'list':
                console.log(await readSpecs(argv[4]));
                done();
                break;
            case 'build':
                const specs = await readSpecs(argv[4]);
                for (const spec of specs) {
                    const data = await specToJSON(spec);
                    await composeComponent({data: data?.components, path: spec});
                }
                done()
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
    console.log(`INFO : Done`);
}