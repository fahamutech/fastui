#! /usr/bin/env node

import {readSpecs} from "./specs/reader.mjs";
import {ensureBlueprintFolderExist, ensureWatchFileExist} from "./tooling/scaffold.mjs";
import {loadEnvFile} from "./tooling/env.mjs";
import {ensureAppRouteFileExist} from './generators/routing.mjs';
import {fetchFigmaFile} from "./translators/figma/index.mjs";
import {join, resolve} from "node:path";
import {getBlueprintRoot, getTemplateSelected, normalizeTemplate} from "./tooling/config.mjs";
import {initializeProject} from "./tooling/project.mjs";
import {translateFigmaToSpecs} from './translators/figma-to-spec.mjs';
import {generateCodeFromSpecs} from './generators/spec-to-code.mjs';
import {createRequire} from 'node:module';

// ─── ANSI colour helpers (no external deps) ──────────────────────────────────
const tty = process.stdout.isTTY;
const c = {
    bold:   s => tty ? `\x1b[1m${s}\x1b[0m`  : s,
    dim:    s => tty ? `\x1b[2m${s}\x1b[0m`  : s,
    cyan:   s => tty ? `\x1b[36m${s}\x1b[0m` : s,
    green:  s => tty ? `\x1b[32m${s}\x1b[0m` : s,
    yellow: s => tty ? `\x1b[33m${s}\x1b[0m` : s,
    red:    s => tty ? `\x1b[31m${s}\x1b[0m` : s,
};

// ─── Package version (read from package.json without fs dance) ────────────────
const _require = createRequire(import.meta.url);
const pkg = _require('../package.json');
const VERSION = pkg.version ?? '0.0.0';
const NAME    = pkg.name    ?? 'fastui';

// ─── Output helpers ───────────────────────────────────────────────────────────
const log   = msg  => console.log(msg);
const info  = msg  => console.log(`${c.cyan('info')}  ${msg}`);
const ok    = msg  => console.log(`${c.green('done')}  ${msg}`);
const warn  = msg  => console.warn(`${c.yellow('warn')}  ${msg}`);
const fatal = (msg, code = 1) => { console.error(`${c.red('error')} ${msg}`); process.exit(code); };

// ─── Argument helpers ─────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const hasFlag = (...flags) => flags.some(f => args.includes(f));
const flagVal = flag => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : undefined; };
const positional = args.filter(a => !a.startsWith('-'));

// ─── Global flags ────────────────────────────────────────────────────────────
if (hasFlag('--version', '-v')) {
    log(`${NAME} ${VERSION}`);
    process.exit(0);
}

// ─── Help text ────────────────────────────────────────────────────────────────
const HELP = `
${c.bold(`${NAME}`)} ${c.dim(`v${VERSION}`)} — FastUI code generator

${c.bold('USAGE')}
  fastui <command> [subcommand] [options]

${c.bold('COMMANDS')}
  ${c.cyan('init')} ${c.yellow('<reactjs|flutter>')}
    Initialise a new FastUI project. The framework argument is required.

  ${c.cyan('specs list')} ${c.dim('[path]')}
    List all YAML blueprint specs under [path]. Falls back to the project
    blueprint root when [path] is omitted.

  ${c.cyan('specs build')} ${c.dim('[path]')}
    Generate source code from YAML blueprints under [path].

  ${c.cyan('specs automate')} ${c.dim('[reactjs|flutter] [--fresh]')}
    Pull a Figma file, translate it to YAML blueprints, and write routing.
    Reads FIGMA_TOKEN and FIGMA_FILE from the environment or .env file.
    Pass ${c.yellow('--fresh')} to force a re-download of the Figma document.

  ${c.cyan('watch')} ${c.dim('[reactjs|flutter]')}
    Create/update the file-watcher helper for the selected template.

${c.bold('OPTIONS')}
  ${c.yellow('-v')}, ${c.yellow('--version')}   Print version and exit
  ${c.yellow('-h')}, ${c.yellow('--help')}      Show this help message
  ${c.yellow('--fresh')}         (automate) Force re-download of Figma document
  ${c.yellow('--template')} ${c.dim('<name>')}  Explicitly choose reactjs or flutter

${c.bold('ENVIRONMENT')}
  FIGMA_TOKEN   Personal access token for the Figma REST API
  FIGMA_FILE    Figma file key (from the URL: figma.com/design/<key>/…)

${c.bold('EXAMPLES')}
  fastui init reactjs          # initialise a React project
  fastui init flutter           # initialise a Flutter project
  fastui specs build src/blueprints
  fastui specs automate reactjs --fresh
  fastui watch flutter
`.trimStart();

if (hasFlag('--help', '-h') || positional.length === 0) {
    log(HELP);
    process.exit(0);
}

// ─── Resolve template from --template flag or positional args ─────────────────
const TEMPLATES = ['reactjs', 'flutter'];
const explicitTemplateFlag = flagVal('--template');
const explicitTemplatePos  = positional.find(a => TEMPLATES.includes(a.toLowerCase()));
const explicitTemplate     = explicitTemplateFlag ?? explicitTemplatePos;

// ─── Command dispatch ─────────────────────────────────────────────────────────
const [command, subcommand] = positional;

try {
    switch (command) {

        // ── init ──────────────────────────────────────────────────────────────
        case 'init': {
            const requested = `${explicitTemplate ?? ''}`.trim().toLowerCase();
            if (!requested) {
                fatal(`Framework is required for init. Run: fastui init reactjs  or  fastui init flutter`);
            }
            if (!TEMPLATES.includes(requested)) {
                fatal(`'${requested}' is not a valid framework. Choose ${c.yellow('reactjs')} or ${c.yellow('flutter')}.`);
            }
            const template = normalizeTemplate(requested);
            info(`Initialising ${c.cyan(template)} project…`);
            const result = await initializeProject({template});
            ok(`Project initialised  (${c.cyan(result.template)})`);
            break;
        }

        // ── specs ─────────────────────────────────────────────────────────────
        case 'specs': {
            if (!subcommand) {
                warn('Missing subcommand for specs. Run fastui --help for usage.');
                process.exit(1);
            }
            switch (subcommand) {

                case 'list': {
                    const target = positional[2] ?? getBlueprintRoot(getTemplateSelected(explicitTemplate));
                    info(`Listing specs${target ? ` in ${c.dim(target)}` : ''}…`);
                    const list = await readSpecs(target);
                    log(list);
                    ok('Spec list complete');
                    break;
                }

                case 'build': {
                    const root = positional[2] ?? getBlueprintRoot(getTemplateSelected(explicitTemplate));
                    info(`Building code from specs${root ? ` in ${c.dim(root)}` : ''}…`);
                    await generateCodeFromSpecs({root, projectPath: process.cwd()});
                    ok('Build complete');
                    break;
                }

                case 'automate': {
                    const template  = getTemplateSelected(explicitTemplate);
                    const fresh     = hasFlag('--fresh');
                    const bpRoot    = getBlueprintRoot(template);
                    const srcPath   = resolve(join(process.cwd(), bpRoot));

                    info(`Automating from Figma  ${c.dim(`(template: ${template}${fresh ? ', fresh' : ''})`)}…`);

                    await ensureBlueprintFolderExist(bpRoot);
                    await loadEnvFile();

                    const token   = process.env.FIGMA_TOKEN;
                    const figFile = process.env.FIGMA_FILE;

                    if (!token)   fatal('FIGMA_TOKEN is not set. Add it to .env or export it before running.');
                    if (!figFile) fatal('FIGMA_FILE is not set.  Add it to .env or export it before running.');

                    info(`Fetching Figma file ${c.dim(figFile)}…`);
                    const data = await fetchFigmaFile({token, figFile, fresh});

                    info('Translating Figma design to YAML specs…');
                    const translation = await translateFigmaToSpecs({
                        data,
                        srcPath,
                        token,
                        figFile,
                        downloadAssets: fresh
                    });

                    info('Writing routing file…');
                    await ensureAppRouteFileExist({
                        pages:     translation.pages,
                        initialId: translation.initialId,
                        template
                    });

                    ok(`Figma → specs complete  (${translation.pages?.length ?? 0} pages written)`);
                    break;
                }

                default:
                    fatal(`Unknown specs subcommand '${subcommand}'. Run fastui --help for usage.`);
            }
            break;
        }

        // ── watch ─────────────────────────────────────────────────────────────
        case 'watch': {
            const template = getTemplateSelected(explicitTemplate);
            info(`Creating watch file for ${c.cyan(template)}…`);
            await ensureWatchFileExist(getBlueprintRoot(template));
            ok('Watch file ready');
            break;
        }

        // ── unknown ───────────────────────────────────────────────────────────
        default:
            fatal(`Unknown command '${command}'. Run fastui --help to see available commands.`);
    }
} catch (err) {
    fatal(err?.message ?? String(err));
}
