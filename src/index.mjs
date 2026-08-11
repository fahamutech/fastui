#! /usr/bin/env node

import {readSpecs} from "./services/specs.mjs";
import {
    ensureAppRouteFileExist,
    ensureBlueprintFolderExist,
    ensureWatchFileExist,
    loadEnvFile
} from "./services/helper.mjs";
import {fetchFigmaFile} from "./services/automation/figma.mjs";
import {join, resolve} from "node:path";
import {getBlueprintRoot, getTemplateSelected, normalizeTemplate} from "./utils/config.mjs";
import {initializeProject} from "./services/project.mjs";
import {translateFigmaToSpecs} from './translators/figma-to-spec.mjs';
import {generateCodeFromSpecs} from './generators/spec-to-code.mjs';

const {argv} = process;

const command1 = argv[2];
const specsCommand = argv[3];
const notFound = command => console.log(`INFO : Command not found ${command}`);
const done = message => console.log(message ?? 'INFO : Done');

switch (command1) {
    case 'specs':
        switch (specsCommand) {
            case 'list':
                console.log(await readSpecs(argv[4]));
                done('INFO : Done list specs');
                break;
            case 'automate':
                const automateArgs = argv.slice(4);
                const explicitAutomateTemplate = automateArgs.find(value => ['reactjs', 'flutter'].includes(`${value}`.toLowerCase()));
                const automateTemplate = getTemplateSelected(explicitAutomateTemplate);
                const freshFigmaFile = automateArgs.includes('--fresh');
                const automateRoot = getBlueprintRoot(automateTemplate);
                await ensureBlueprintFolderExist(automateRoot);
                const srcPath = resolve(join(process.cwd(), automateRoot));
                await loadEnvFile();
                const token = process.env.FIGMA_TOKEN;
                const figFile = process.env.FIGMA_FILE;
                const data = await fetchFigmaFile({token, figFile, fresh: freshFigmaFile});
                const translation = await translateFigmaToSpecs({
                    data,
                    srcPath,
                    token,
                    figFile,
                    downloadAssets: freshFigmaFile
                });
                const appRouteArgs = {pages: translation.pages, initialId: translation.initialId, template: automateTemplate};
                await ensureAppRouteFileExist(appRouteArgs);
                done('INFO : Done write specs from figma');
                break;
            case 'build':
                await generateCodeFromSpecs({root: argv[4], projectPath: process.cwd()});
                done('INFO : Done build from specs');
                break;
            default:
                notFound(specsCommand);
        }
        break;
    case 'watch':
        await ensureWatchFileExist(getBlueprintRoot(getTemplateSelected(argv[3])));
        done('INFO : Done create watch file');
        break;
    case 'init': {
        const requestedTemplate = `${argv[3] ?? ''}`.trim().toLowerCase();
        if (requestedTemplate && !['reactjs', 'flutter'].includes(requestedTemplate)) {
            console.error('INFO : init supports only reactjs or flutter');
            process.exitCode = 1;
            break;
        }
        const initTemplate = normalizeTemplate(argv[3] ?? getTemplateSelected());
        const initialized = await initializeProject({template: initTemplate});
        done(`INFO : Done initiate ${initialized.template} project`);
        break;
    }
    default:
        notFound(command1);
}
