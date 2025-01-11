// Constants
import {join, resolve} from "node:path";
import {
    fetchFigmaFile,
    getDesignDocument,
    getPagesAndTraverseChildren,
    walkFrameChildren
} from "../services/automation/figma.mjs";
import {
    ensureAppRouteFileExist,
    ensureBlueprintFolderExist, ensureSchemaFileExist, ensureStartScript,
    ensureWatchFileExist,
    loadEnvFile
} from "../services/generator/helper.mjs";
import {readSpecs, specToJSON} from "../services/generator/specs.mjs";
import {composeComponent} from "../services/generator/component.mjs";
import {composeCondition} from "../services/generator/condition.mjs";
import {composeLoop} from "../services/generator/loop.mjs";
import {getMergedCondition} from "./merge_condition.mjs";
import {getMergedLoop} from "./merge_loop.mjs";

const CONSTANTS = {
    COMMAND_TYPES: {
        SPECS: 'specs',
        WATCH: 'watch',
        INIT: 'init'
    },
    SPECS_COMMANDS: {
        LIST: 'list',
        AUTOMATE: 'automate',
        BUILD: 'build'
    },
    FILE_TYPES: {
        PAGE: '_page',
        DIALOG: '_dialog'
    },
    PATHS: {
        BLUEPRINTS: 'src/blueprints'
    }
};

// Logger utility
const logger = {
    info: (msg) => console.log(`INFO: ${msg}`),
    error: (msg) => console.error(`ERROR: ${msg}`),
    debug: (msg) => console.debug(`DEBUG: ${msg}`),
    done: (msg) => console.log(`DONE: ${msg}`)
};

/**
 * @typedef {Object} FigmaConfig
 * @property {string} token
 * @property {string} figFile
 * @property {string} srcPath
 */

/**
 * Input validation
 */
const validateInput = (command, args) => {
    if (!command) throw new Error('Command is required');
};

const notFound = command => console.log(`INFO : Command not found ${command}`);

/**
 * Configuration setup
 */
const setupFigmaConfig = async () => {
    await loadEnvFile();
    return {
        token: process.env.FIGMA_TOKEN,
        figFile: process.env.FIGMA_FILE,
        srcPath: resolve(join(process.cwd(), CONSTANTS.PATHS.BLUEPRINTS))
    };
};

/**
 * Document processing
 */
const fetchAndProcessDocument = async (config) => {
    const data = await fetchFigmaFile({
        token: config.token,
        figFile: config.figFile
    });
    const document = getDesignDocument(data);
    logger.info('Document processing completed');
    return document;
};

/**
 * Children processing
 */
const processChildren = async (config, document) => {
    const children = await getPagesAndTraverseChildren({
        document,
        srcPath: config.srcPath,
        token: config.token,
        figFile: config.figFile
    });

    logger.info('Starting frame processing');
    await walkFrameChildren({
        children,
        srcPath: config.srcPath,
        token: config.token,
        figFile: config.figFile
    });

    return children;
};

/**
 * Page generation
 */
const generatePages = (children) => {
    const pageRouteMap = x => ({
        name: x?.name,
        module: x?.module,
        id: x?.id
    });

    const isPage = name => name?.split(' ')[0]?.trim()?.endsWith(CONSTANTS.FILE_TYPES.PAGE);
    const isDialog = name => name?.split(' ')[0]?.trim()?.endsWith(CONSTANTS.FILE_TYPES.DIALOG);

    return [
        ...children.filter(x => isPage(x?.name)),
        ...children.filter(x => isDialog(x?.name))
    ].map(pageRouteMap);
};

/**
 * Spec processing
 */
const processSpec = async (specPath) => {
    try {
        const data = await specToJSON(specPath);
        const {component, components, condition, loop} = JSON.parse(JSON.stringify(data ?? {}));
        const paths = {
            path: specPath,
            projectPath: process.cwd()
        };

        await Promise.all([
            composeComponent({data: components ?? component, ...paths}),
            composeCondition({data: getMergedCondition(condition), ...paths}),
            composeLoop({data: getMergedLoop(loop), ...paths})
        ]);
    } catch (error) {
        logger.error(`Error processing spec ${specPath}: ${error.message}`);
        throw error;
    }
};

/**
 * Command handlers
 */
const handleSpecsList = async (path) => {
    const specs = await readSpecs(path);
    console.log(specs);
    return 'Done list specs';
};

const handleSpecsAutomate = async () => {
    try {
        await ensureBlueprintFolderExist();
        const config = await setupFigmaConfig();
        const document = await fetchAndProcessDocument(config);
        const children = await processChildren(config, document);
        const pages = generatePages(children);

        await ensureAppRouteFileExist({
            pages,
            initialId: document?.flowStartingPoints?.[0]?.nodeId
        });

        return 'Done write specs from figma';
    } catch (error) {
        logger.error(`Automation error: ${error.message}`);
        throw error;
    }
};

const handleSpecsBuild = async (path) => {
    try {
        const specs = await readSpecs(path);
        await Promise.all(specs.map(processSpec));
        return 'Done build from specs';
    } catch (error) {
        logger.error(`Build error: ${error.message}`);
        throw error;
    }
};

const initializeProject = async () => {
    try {
        await Promise.all([
            ensureBlueprintFolderExist(),
            ensureWatchFileExist(),
            ensureSchemaFileExist(),
            ensureStartScript()
        ]);
        return 'Done initiate';
    } catch (error) {
        logger.error(`Initialization error: ${error.message}`);
        throw error;
    }
};

/**
 * Main command handlers
 */
const handleSpecsCommands = async (specsCommand, argv) => {
    try {
        switch (specsCommand) {
            case CONSTANTS.SPECS_COMMANDS.LIST:
                return await handleSpecsList(argv[4]);
            case CONSTANTS.SPECS_COMMANDS.AUTOMATE:
                return await handleSpecsAutomate();
            case CONSTANTS.SPECS_COMMANDS.BUILD:
                return await handleSpecsBuild(argv[4]);
            default:
                return notFound(specsCommand);
        }
    } catch (error) {
        logger.error('Error processing specs command:', error);
        throw error;
    }
};

/**
 * Main command processor
 */
const processCommand = async (command1, specsCommand, argv) => {
    try {
        validateInput(command1, argv);

        switch (command1) {
            case CONSTANTS.COMMAND_TYPES.SPECS:
                const result = await handleSpecsCommands(specsCommand, argv);
                logger.done(result);
                break;

            case CONSTANTS.COMMAND_TYPES.WATCH:
                await ensureWatchFileExist();
                logger.done('Done create watch file');
                break;

            case CONSTANTS.COMMAND_TYPES.INIT:
                const initResult = await initializeProject();
                logger.done(initResult);
                break;

            default:
                notFound(command1);
        }
    } catch (error) {
        logger.error(`Command processing error: ${error.message}`);
        process.exit(1);
    }
};


export {
    processCommand,
    handleSpecsCommands,
    handleSpecsList,
    handleSpecsAutomate,
    handleSpecsBuild,
    initializeProject
};