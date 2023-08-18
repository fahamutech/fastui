#! /usr/bin/env node

import {composeComponent, readSpecs, specToJSON} from "./index.mjs";

const {argv} = process;

const command1 = argv[2];

switch (command1) {
    case 'specs':
        const specsCommand = argv[3];
        switch (specsCommand) {
            case 'list':
                console.log(await readSpecs(argv[4]));
                break;
            case 'build':
                const specs = await readSpecs(argv[4]);
                for(const spec of specs){
                    const data = await specToJSON(spec);
                    await composeComponent({data: data?.components, path: spec});
                }
                break;
        }
        break;
}