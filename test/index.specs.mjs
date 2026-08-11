import {expect} from "chai";
import {mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path"
import {tmpdir} from "node:os";
import {readSpecs, specToJSON} from "../src/services/specs.mjs";
import {composeComponent} from "../src/services/component.mjs";
import {composeCondition} from "../src/services/condition.mjs";
import {composeLoop} from "../src/services/loop.mjs";
import {ensureAppRouteFileExist, ensureBlueprintFolderExist, ensureWatchFileExist} from "../src/services/helper.mjs";
import {initializeProject} from "../src/services/project.mjs";
import {resolvePrototypeRoute, routeFromSurfaceName} from "../src/services/navigation.mjs";
import {fetchFigmaFile, getDesignDocument, getPagesAndTraverseChildren, walkFrameChildren} from "../src/services/automation/figma.mjs";
import {generateCodeFromSpecs} from '../src/generators/spec-to-code.mjs';
import {specFile, logicFile} from './data.mjs'

describe('Specs', function () {
    before(() => {
        // console.log(process.cwd(),'++++++CWD+++++')
    })
    describe('list', function () {
        it('should list specs of the selected folder', async function () {
            const resp = await readSpecs(`./test/blueprints`);
            expect(resp).to.includes(join('test', 'blueprints', 'modules', 'test_comp.yml'));
        });
        it('should list spec of the selected file', async function () {
            const resp = await readSpecs(`./test/blueprints/test_comp.yml`);
            expect(resp).to.includes(join('test', 'blueprints', 'modules', 'test_comp.yml'));
        });
    });

    describe('build', function () {
        before(async () => {
            const specsPath = await readSpecs('./test/blueprints');
            for (const specPath of specsPath) {
                const data = await specToJSON(specPath);
                const {component, components, condition, loop} = JSON.parse(JSON.stringify(data ?? {}));
                const paths = {path: specPath, projectPath: process.cwd()};
                await composeComponent({data: components ?? component, ...paths});
            }
        })
        it('should build the specs', async function () {
            const file = await readFile(resolve('./test/modules/test_comp.jsx'));
            expect(
                file.toString().trim().replace(/\s+/ig, '')
            ).eql(
                specFile.trim().replace(/\s+/ig, '')
            );
        });
        it('should write the user-owned service file', async function () {
            const file = await readFile(resolve('./test/services/test_comp.mjs'));
            expect(
                file.toString().trim().replace(/\s+/ig, '')
            ).eql(
                logicFile.trim().replace(/\s+/ig, '')
            );
        });
    });
    describe('watch', function () {
        const _fn = async () => {
            await ensureWatchFileExist();
            const file = await readFile(resolve(join('watch.mjs')));
            expect(file.toString()).to.include('const blueprintRoot = "src/blueprints"');
            expect(file.toString()).to.include('fastui specs build');
        }
        it('should create a watch file', async function () {
            await _fn();
        });
        it('should replace existing watch file', async function () {
            await _fn();
        });
    });
    describe('init', function () {
        it('should create a blueprint folder', async function () {
            await ensureBlueprintFolderExist();
            await readdir(resolve(join('src', 'blueprints')));
        });
    });

    describe('platform generators', function () {
        let root;
        let previousCwd;

        beforeEach(async () => {
            previousCwd = process.cwd();
            root = await mkdtemp(join(tmpdir(), 'fastui-generator-'));
            await mkdir(join(root, 'lib', 'blueprints', 'modules'), {recursive: true});
            process.chdir(root);
            process.env.FASTUI_TEMPLATE = 'flutter';
        });

        afterEach(() => {
            process.chdir(previousCwd);
            delete process.env.FASTUI_TEMPLATE;
        });

        it('generates Flutter components, conditions, loops, imports, and service stubs', async function () {
            const moduleRoot = join(root, 'lib', 'blueprints', 'modules');
            const iconPath = join(moduleRoot, 'icon.yml');
            const labelPath = join(moduleRoot, 'label.yml');
            const buttonPath = join(moduleRoot, 'button.yml');
            const listPath = join(moduleRoot, 'items.yml');
            const staticPath = join(moduleRoot, 'static.yml');
            await writeFile(iconPath, 'component: {}');
            await writeFile(labelPath, 'component: {}');
            await writeFile(buttonPath, 'condition: {}');
            await writeFile(listPath, 'loop: {}');
            await writeFile(staticPath, 'component: {}');

            await composeComponent({path: iconPath, projectPath: root, data: {
                base: 'image',
                modifier: {states: {srcUrl: 'assets/images/figma/icon.svg'}, props: {src: 'states.srcUrl'}, frame: {base: 'row.start'}}
            }});
            await composeComponent({path: labelPath, projectPath: root, data: {
                base: 'text',
                modifier: {extend: './icon.yml', states: {value: 'Continue for $100'}, props: {children: 'states.value'}, styles: {fontSize: 16}, frame: {base: 'row.start', styles: {flex: 1, height: '100%'}}}
            }});
            await composeCondition({path: buttonPath, projectPath: root, data: {
                modifier: {left: './label.yml', props: {onClick: 'logics.onClick'}, frame: {base: 'row.start'}}
            }});
            await composeLoop({path: listPath, projectPath: root, data: {
                modifier: {feed: './label.yml', frame: {base: 'column.start'}}
            }});
            await composeComponent({path: staticPath, projectPath: root, data: {
                base: 'container', modifier: {frame: {base: 'column.start'}}
            }});

            const label = await readFile(join(root, 'lib', 'modules', 'label.dart'), 'utf8');
            const button = await readFile(join(root, 'lib', 'modules', 'button.dart'), 'utf8');
            const list = await readFile(join(root, 'lib', 'modules', 'items.dart'), 'utf8');
            const staticWidget = await readFile(join(root, 'lib', 'modules', 'static.dart'), 'utf8');
            expect(label).to.include('class FastUILabel');
            expect(label).to.include("import './icon.dart';");
            expect(label).to.include("stateValue = 'Continue for \\$100'");
            expect(label).to.include('LayoutBuilder(builder: (context, constraints)');
            expect(label).to.include('constraints.hasBoundedWidth');
            expect(label).to.include('height: constraints.hasBoundedHeight ? constraints.maxHeight');
            expect(button).to.include('GestureDetector(onTap:');
            expect(button).to.include('FastUILabel(');
            expect(list).to.include('List<dynamic>.from(stateData');
            expect(staticWidget).to.include('extends StatelessWidget');
            expect(staticWidget).not.to.include('void initState()');
            expect(await readFile(join(root, 'lib', 'services', 'button.dart'), 'utf8')).to.include('dynamic onClick');
        });

        it('resolves a v2 primitive ref and generates a stateless component', async function () {
            const primitiveRoot = join(root, 'lib', 'blueprints', 'primitives');
            const moduleRoot = join(root, 'lib', 'blueprints', 'modules');
            await mkdir(primitiveRoot, {recursive: true});
            await mkdir(moduleRoot, {recursive: true});
            await writeFile(join(primitiveRoot, 'text.spec.yml'), `version: fastui/v2
kind: primitive
id: primitive.text
node:
  type: text
props:
  value: ''
`);
            const titlePath = join(moduleRoot, 'title.spec.yml');
            await writeFile(titlePath, `version: fastui/v2
kind: component
id: example.title
ref: ../primitives/text.spec.yml
props:
  value: Hello from v2
style:
  typography:
    fontSize: 18
`);
            await generateCodeFromSpecs({root: titlePath, projectPath: root});
            const generated = await readFile(join(root, 'lib', 'modules', 'title_spec.dart'), 'utf8');
            expect(generated).to.include('extends StatelessWidget');
            expect(generated).to.include("'Hello from v2'");
            expect(generated).to.include('fontSize: 18');
        });

        it('initializes a Flutter project and selects lib/blueprints', async function () {
            const fakeFlutter = async () => {
                await mkdir(join(root, 'lib'), {recursive: true});
                await writeFile(join(root, 'pubspec.yaml'), 'name: generated_app\nenvironment:\n  sdk: ">=3.0.0 <4.0.0"\n');
            };
            const result = await initializeProject({template: 'flutter', runCommand: fakeFlutter});
            expect(result).to.deep.equal({template: 'flutter', blueprintRoot: 'lib/blueprints'});
            expect(JSON.parse(await readFile(join(root, 'fastui.config.json'), 'utf8')).template).to.equal('flutter');
            await readdir(join(root, 'lib', 'blueprints'));
            expect(await readFile(join(root, 'lib', 'main.dart'), 'utf8')).to.include('FastUIAppRoute');
            expect(await readFile(join(root, 'lib', 'main.dart'), 'utf8')).to.include('FastUIStateScope');
            expect(await readFile(join(root, 'lib', 'stores', 'observable_store.dart'), 'utf8')).to.include('extends ChangeNotifier');
            expect(await readFile(join(root, 'lib', 'blueprints', 'primitives', 'container.spec.yml'), 'utf8')).to.include('type: container');
            expect(JSON.parse(await readFile(join(root, 'fastui.v2.schema.json'), 'utf8')).properties.node.properties.type.enum).to.deep.equal(['text', 'image', 'container']);
        });

        it('initializes a ReactJS project and selects src/blueprints', async function () {
            const result = await initializeProject({template: 'reactjs'});
            expect(result).to.deep.equal({template: 'reactjs', blueprintRoot: 'src/blueprints'});
            const packageMap = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
            expect(packageMap.dependencies).to.have.property('react');
            expect(packageMap.dependencies).to.have.property('rxjs');
            expect(packageMap.scripts.start).to.include('fastui specs build ./src/blueprints');
            await readdir(join(root, 'src', 'blueprints'));
            expect(await readFile(join(root, 'src', 'main.jsx'), 'utf8')).to.include('ReactDOM.createRoot');
            expect(await readFile(join(root, 'src', 'stores', 'observable_store.mjs'), 'utf8')).to.include('BehaviorSubject');
            expect(await readFile(join(root, 'src', 'stores', 'use_observable.mjs'), 'utf8')).to.include('useSyncExternalStore');
            expect(await readFile(join(root, 'src', 'blueprints', 'primitives', 'text.spec.yml'), 'utf8')).to.include('type: text');
        });

        it('keeps static React components free of state and lifecycle effects', async function () {
            process.env.FASTUI_TEMPLATE = 'reactjs';
            const specPath = join(root, 'src', 'blueprints', 'modules', 'static_panel.yml');
            await mkdir(join(root, 'src', 'blueprints', 'modules'), {recursive: true});
            await composeComponent({path: specPath, projectPath: root, data: {
                base: 'container',
                modifier: {props: {id: 'static'}, styles: {backgroundColor: '#FFFFFF'}, frame: {base: 'column.start'}}
            }});
            const generated = await readFile(join(root, 'src', 'modules', 'static_panel.jsx'), 'utf8');
            expect(generated).not.to.include('useState');
            expect(generated).not.to.include('useEffect');
            process.env.FASTUI_TEMPLATE = 'flutter';
        });

        it('maps neutral assets inside loop fallbacks and frame styles for both targets', async function () {
            const reactSpec = join(root, 'src', 'blueprints', 'modules', 'loop_image.yml');
            await mkdir(join(root, 'src', 'blueprints', 'modules'), {recursive: true});
            process.env.FASTUI_TEMPLATE = 'reactjs';
            await composeComponent({path: reactSpec, projectPath: root, data: {
                base: 'image',
                modifier: {
                    props: {src: 'inputs.loopElement.icon??asset://figma/icon.svg'},
                    frame: {base: 'column.start', styles: {backgroundImage: 'url("asset://figma/background.png")'}}
                }
            }});
            const react = await readFile(join(root, 'src', 'modules', 'loop_image.jsx'), 'utf8');
            expect(react).to.include("loopElement.icon??'/images/figma/icon.svg'");
            expect(react).to.include('/images/figma/background.png');
            expect(react).not.to.include('asset://figma/');

            const reactConditionSpec = join(root, 'src', 'blueprints', 'modules', 'asset_condition.yml');
            await composeCondition({path: reactConditionSpec, projectPath: root, data: {
                modifier: {
                    left: './loop_image.yml',
                    frame: {base: 'row.start', styles: {backgroundImage: 'url("asset://figma/condition.png")'}}
                }
            }});
            const reactCondition = await readFile(join(root, 'src', 'modules', 'asset_condition.jsx'), 'utf8');
            expect(reactCondition).to.include('/images/figma/condition.png');
            expect(reactCondition).not.to.include('asset://figma/');

            const flutterSpec = join(root, 'lib', 'blueprints', 'modules', 'loop_image.yml');
            process.env.FASTUI_TEMPLATE = 'flutter';
            await composeComponent({path: flutterSpec, projectPath: root, data: {
                base: 'image',
                modifier: {props: {src: 'inputs.loopElement.icon??asset://figma/icon.svg'}, frame: {base: 'column.start'}}
            }});
            const flutter = await readFile(join(root, 'lib', 'modules', 'loop_image.dart'), 'utf8');
            expect(flutter).to.include("?? 'assets/images/figma/icon.svg'");
        });

        it('generates neutral navigation actions as stateless React events', async function () {
            process.env.FASTUI_TEMPLATE = 'reactjs';
            const specPath = join(root, 'src', 'blueprints', 'modules', 'nav_card.yml');
            await mkdir(join(root, 'src', 'blueprints', 'modules'), {recursive: true});
            await composeComponent({path: specPath, projectPath: root, data: {
                base: 'container',
                modifier: {
                    props: {onClick: {action: 'navigation.open', name: 'profile', type: 'dialog'}},
                    frame: {base: 'column.start'}
                }
            }});
            const generated = await readFile(join(root, 'src', 'modules', 'nav_card.jsx'), 'utf8');
            expect(generated).to.include("import {setCurrentRoute}");
            expect(generated).to.include('onClick={(event)=>{setCurrentRoute({"name":"profile","type":"dialog"});}}');
            expect(generated).not.to.include('useState');
            expect(generated).not.to.include('useEffect');
            process.env.FASTUI_TEMPLATE = 'flutter';
        });

        it('generates async React guards, lazy routes, sheets, and observable route state', async function () {
            process.env.FASTUI_TEMPLATE = 'reactjs';
            await initializeProject({template: 'reactjs'});
            const pages = [
                {id: 'home', name: 'home_page', module: 'home'},
                {id: 'choices', name: 'choices_sheet', module: 'home'},
            ];
            await ensureAppRouteFileExist({template: 'reactjs', initialId: 'home', pages});
            const guard = await readFile(join(root, 'src', 'routing_guard.mjs'), 'utf8');
            const routing = await readFile(join(root, 'src', 'routing.mjs'), 'utf8');
            const appRoute = await readFile(join(root, 'src', 'AppRoute.jsx'), 'utf8');
            expect(guard).to.include('export async function beforeNavigate');
            expect(guard).to.include("decision: 'allow'");
            expect(routing).to.include("decision === 'cancel'");
            expect(routing).to.include('appState.set({route: resolved})');
            expect(routing).to.include("source = 'action'");
            expect(appRoute).to.include('lazy(() => import(');
            expect(appRoute).to.include('getSheetRoute');
            expect(appRoute).to.include('data-fastui-sheet');

            await writeFile(join(root, 'src', 'routing_guard.mjs'), 'export async function beforeNavigate() { return {decision: "cancel"}; }\n');
            await ensureAppRouteFileExist({template: 'reactjs', initialId: 'home', pages});
            expect(await readFile(join(root, 'src', 'routing_guard.mjs'), 'utf8')).to.include('decision: "cancel"');
            process.env.FASTUI_TEMPLATE = 'flutter';
        });

        it('rejects the removed React Native target', async function () {
            try {
                await initializeProject({template: 'reactnative'});
                expect.fail('React Native should not be accepted');
            } catch (error) {
                expect(error.message).to.include('Use reactjs or flutter');
            }
        });

        it('preserves Figma page, dialog, sheet, swap, back, and close semantics', function () {
            expect(routeFromSurfaceName('home_page')).to.include({name: 'home', type: 'page'});
            expect(routeFromSurfaceName('confirm_dialog')).to.include({name: 'confirm', type: 'dialog'});
            expect(routeFromSurfaceName('choices_bottom_sheet')).to.include({name: 'choices', type: 'sheet'});
            const routes = {
                dialog: {...routeFromSurfaceName('confirm_dialog'), module: 'dialogs'},
                sheet: {...routeFromSurfaceName('choices_sheet'), module: 'sheets'}
            };
            expect(resolvePrototypeRoute({interactions: [{actions: [{type: 'NODE', navigation: 'OVERLAY', destinationId: 'dialog'}]}]}, routes))
                .to.include({name: 'confirm', type: 'dialog', replace: false});
            expect(resolvePrototypeRoute({interactions: [{actions: [{type: 'NODE', navigation: 'SWAP', destinationId: 'sheet'}]}]}, routes))
                .to.include({name: 'choices', type: 'sheet', replace: true});
            expect(resolvePrototypeRoute({interactions: [{actions: [{type: 'BACK'}]}]}, routes)).to.deep.equal({type: 'back'});
            expect(resolvePrototypeRoute({interactions: [{actions: [{type: 'CLOSE'}]}]}, routes)).to.deep.equal({type: 'close'});
        });

        it('uses the cached Figma document unless a fresh download is explicitly requested', async function () {
            const cachePath = join(root, '.fastui', 'figma', 'file.json');
            let downloads = 0;
            const first = await fetchFigmaFile({
                token: 'token', figFile: 'file', fresh: true, cachePath,
                fetcher: async () => ({data: {version: 1}})
            });
            const cached = await fetchFigmaFile({
                figFile: 'file', cachePath,
                fetcher: async () => {
                    downloads++;
                    throw new Error('cache should prevent this request');
                }
            });
            const refreshed = await fetchFigmaFile({
                token: 'token', figFile: 'file', fresh: true, cachePath,
                fetcher: async () => ({data: {version: 2}})
            });
            expect(first.version).to.equal(1);
            expect(cached.version).to.equal(1);
            expect(refreshed.version).to.equal(2);
            expect(downloads).to.equal(0);
        });

        it('combines Figma canvases so shared components can live on a separate design page', function () {
            const document = getDesignDocument({document: {type: 'DOCUMENT', children: [
                {type: 'CANVAS', flowStartingPoints: [{nodeId: 'home'}], children: [{id: 'home', type: 'FRAME'}]},
                {type: 'CANVAS', children: [{id: 'shared-label', type: 'COMPONENT'}]}
            ]}});
            expect(document.children.map(child => child.id)).to.deep.equal(['home', 'shared-label']);
            expect(document.flowStartingPoints).to.deep.equal([{nodeId: 'home'}]);
        });

        it('creates local state only for explicit Figma state-changing interactions', async function () {
            const document = {children: [{
                id: 'state-page', name: 'state_page', type: 'FRAME', visible: true, layoutMode: 'VERTICAL',
                children: [{
                    id: 'toggle', name: 'Toggle_button', type: 'FRAME', layoutMode: 'HORIZONTAL', children: [],
                    interactions: [{actions: [{type: 'CHANGE_TO', destinationId: 'selected-variant'}]}]
                }]
            }]};
            const srcPath = join(root, 'lib', 'blueprints');
            const children = await getPagesAndTraverseChildren({document, srcPath});
            await walkFrameChildren({children, srcPath});
            await generateCodeFromSpecs({root: srcPath, projectPath: root});
            const spec = await readFile(join(srcPath, 'modules', 'state_page', 'itoggle_Toggle_button.yml'), 'utf8');
            const widget = await readFile(join(root, 'lib', 'modules', 'state_page', 'itoggle_toggle_button.dart'), 'utf8');
            expect(spec).to.include('variant: toggle');
            expect(spec).to.include('action: state.set');
            expect(widget).to.include('extends StatefulWidget');
            expect(widget).to.include("_setStateVariant('selected-variant')");
        });

        it('generates declarative controlled input updates without logic stubs', async function () {
            const data = {
                base: 'container',
                modifier: {
                    props: {
                        control: 'input', value: 'states.value', type: 'text',
                        onChange: {action: 'state.set', target: 'value', value: 'event.value'}
                    },
                    states: {value: ''},
                    frame: {base: 'column.start'}
                }
            };
            const reactPath = join(root, 'src', 'blueprints', 'modules', 'controlled_input.yml');
            await mkdir(join(root, 'src', 'blueprints', 'modules'), {recursive: true});
            process.env.FASTUI_TEMPLATE = 'reactjs';
            await composeComponent({data, path: reactPath, projectPath: root});
            const react = await readFile(join(root, 'src', 'modules', 'controlled_input.jsx'), 'utf8');
            expect(react).to.include("setValue((event?.target?.value ?? event))");
            expect(react).not.to.include('logics/controlled_input');

            const flutterPath = join(root, 'lib', 'blueprints', 'modules', 'controlled_input.yml');
            process.env.FASTUI_TEMPLATE = 'flutter';
            await composeComponent({data, path: flutterPath, projectPath: root});
            const flutter = await readFile(join(root, 'lib', 'modules', 'controlled_input.dart'), 'utf8');
            expect(flutter).to.include("TextFormField(initialValue: (stateValue ?? '').toString()");
            expect(flutter).to.include('onChanged: (value) { _setStateValue(value); }');
        });

        it('groups typed state by module and preserves user-owned services', async function () {
            const reactSpec = join(root, 'src', 'blueprints', 'modules', 'account', 'profile.yml');
            const reactService = join(root, 'src', 'services', 'account', 'profile.mjs');
            await mkdir(join(root, 'src', 'blueprints', 'modules', 'account'), {recursive: true});
            await mkdir(join(root, 'src', 'services', 'account'), {recursive: true});
            await writeFile(reactSpec, `component:
  base: container
  modifier:
    states:
      signedIn: false
    props:
      onClick: services.validateProfile
`);
            await writeFile(reactService, 'export function validateProfile() { return "implemented"; }\n');
            process.env.FASTUI_TEMPLATE = 'reactjs';
            await generateCodeFromSpecs({root: join(root, 'src', 'blueprints'), projectPath: root});
            const reactWidget = await readFile(join(root, 'src', 'modules', 'account', 'profile.jsx'), 'utf8');
            const reactStorePath = join(root, 'src', 'stores', 'account', 'store.mjs');
            const reactStore = await readFile(reactStorePath, 'utf8');
            const reactModels = await readFile(join(root, 'src', 'stores', 'account', 'models.generated.mjs'), 'utf8');
            expect(reactWidget).to.include("from '../../services/account/profile.mjs'");
            expect(reactWidget).to.include("useModuleState(\"Profile\"");
            expect(reactStore).to.include('export function useModuleState');
            expect(reactModels).to.include('@typedef {Object} ProfileStateModel');
            expect(reactModels).to.include('@property {boolean} signedIn');
            expect(await readFile(reactService, 'utf8')).to.equal('export function validateProfile() { return "implemented"; }\n');
            await writeFile(reactStorePath, `${reactStore}\nexport const userControlled = true;\n`);
            await generateCodeFromSpecs({root: join(root, 'src', 'blueprints'), projectPath: root});
            expect(await readFile(reactStorePath, 'utf8')).to.include('export const userControlled = true;');

            const flutterSpec = join(root, 'lib', 'blueprints', 'modules', 'account', 'profile.yml');
            await mkdir(join(root, 'lib', 'blueprints', 'modules', 'account'), {recursive: true});
            await writeFile(flutterSpec, `component:
  base: container
  modifier:
    states:
      signedIn: false
    props:
      onClick: services.validateProfile
`);
            process.env.FASTUI_TEMPLATE = 'flutter';
            await generateCodeFromSpecs({root: join(root, 'lib', 'blueprints'), projectPath: root});
            const flutterWidget = await readFile(join(root, 'lib', 'modules', 'account', 'profile.dart'), 'utf8');
            const flutterStorePath = join(root, 'lib', 'stores', 'account', 'store.dart');
            const flutterStore = await readFile(flutterStorePath, 'utf8');
            const flutterModels = await readFile(join(root, 'lib', 'stores', 'account', 'models.generated.dart'), 'utf8');
            expect(flutterWidget).to.include("import '../../services/account/profile.dart';");
            expect(flutterWidget).to.include('moduleStore.set<FastUIProfileStateModel>');
            expect(flutterStore).to.include('class FastUIModuleStore');
            expect(flutterModels).to.include('class FastUIProfileStateModel');
            expect(flutterModels).to.include('final bool signedIn');
            await writeFile(flutterStorePath, `${flutterStore}\nconst userControlled = true;\n`);
            await generateCodeFromSpecs({root: join(root, 'lib', 'blueprints'), projectPath: root});
            expect(await readFile(flutterStorePath, 'utf8')).to.include('const userControlled = true;');
        });

        it('removes only stale files recorded by the generated manifest', async function () {
            const moduleRoot = join(root, 'lib', 'blueprints', 'modules');
            const specPath = join(moduleRoot, 'temporary.yml');
            const logicRoot = join(moduleRoot, 'logics');
            await mkdir(logicRoot, {recursive: true});
            const unusedStub = join(logicRoot, 'unused.dart');
            const authoredStub = join(logicRoot, 'authored.dart');
            await writeFile(unusedStub, '/// Receives {states, inputs, args}.\ndynamic unused(Map<String, dynamic> data) {\n  // TODO: Implement the logic.\n}\n');
            await writeFile(authoredStub, '/// Receives {states, inputs, args}.\ndynamic authored(Map<String, dynamic> data) {\n  // TODO: Implement the logic.\n  return 1;\n}\n');
            await writeFile(specPath, 'component:\n  base: container\n  modifier: {}\n');
            await generateCodeFromSpecs({root: join(root, 'lib', 'blueprints'), projectPath: root});
            const outputPath = join(root, 'lib', 'modules', 'temporary.dart');
            expect((await stat(outputPath)).isFile()).to.equal(true);
            const manifest = JSON.parse(await readFile(join(root, '.fastui', 'generated-manifest.json'), 'utf8'));
            expect(manifest.files).to.include(outputPath);
            expect((await stat(unusedStub)).isFile()).to.equal(true);
            expect((await stat(authoredStub)).isFile()).to.equal(true);
            expect(await readFile(join(root, 'lib', 'services', 'authored.dart'), 'utf8')).to.include('return 1;');
            await writeFile(join(root, '.fastui', 'generated-manifest.json'), JSON.stringify({
                ...manifest,
                files: manifest.files.map(file => file.replace('temporary.dart', 'Temporary.dart')),
            }));
            await generateCodeFromSpecs({root: join(root, 'lib', 'blueprints'), projectPath: root});
            expect((await stat(outputPath)).isFile()).to.equal(true);
            await rm(specPath);
            await generateCodeFromSpecs({root: join(root, 'lib', 'blueprints'), projectPath: root});
            try {
                await stat(outputPath);
                expect.fail('stale generated file should be removed');
            } catch (error) {
                expect(error.code).to.equal('ENOENT');
            }
        });

        it('inherits a referenced primitive before applying local overrides', async function () {
            const sharedRoot = join(root, 'lib', 'blueprints', 'shared', 'common');
            const moduleRoot = join(root, 'lib', 'blueprints', 'modules', 'example');
            await mkdir(sharedRoot, {recursive: true});
            await mkdir(moduleRoot, {recursive: true});
            await writeFile(join(sharedRoot, 'text.yml'), `component:
  base: text
  modifier:
    styles:
      color: '#000000'
      fontSize: 14
    props:
      children: states.value
    states:
      value: Shared
`);
            await writeFile(join(moduleRoot, 'leading.yml'), 'component:\n  base: image\n  modifier: {}\n');
            const labelPath = join(moduleRoot, 'label.yml');
            await writeFile(labelPath, `component:
  modifier:
    ref: ../../shared/common/text.yml
    extend: ./leading.yml
    styles:
      color: '#0000FF'
    states:
      value: Label
`);
            const resolved = await specToJSON(labelPath);
            expect(resolved.component.base).to.equal('text');
            expect(resolved.component.modifier.styles).to.deep.equal({color: '#0000FF', fontSize: 14});
            expect(resolved.component.modifier.states.value).to.equal('Label');
            expect(resolved.component.modifier.extend).to.equal('./leading.yml');
            expect(resolved.component.modifier).not.to.have.property('ref');
            await composeComponent({data: resolved.component, path: labelPath, projectPath: root});
            const generated = await readFile(join(root, 'lib', 'modules', 'example', 'label.dart'), 'utf8');
            expect(generated).to.include('fontSize: 14');
            expect(generated).to.include('Color(0xFF0000FF)');
        });

        it('translates neutral Figma navigation and generates Flutter overlays', async function () {
            const document = {children: [
                {
                    id: 'home', name: 'home_page', type: 'FRAME', visible: true, layoutMode: 'VERTICAL', children: [{
                        id: 'open', name: 'Open_button', type: 'FRAME', layoutMode: 'HORIZONTAL',
                        layoutAlign: 'STRETCH', layoutSizingHorizontal: 'FILL', children: [],
                        interactions: [{actions: [{
                            type: 'NODE', navigation: 'OVERLAY', destinationId: 'choices',
                            transition: {type: 'MOVE_IN', direction: 'BOTTOM', duration: 0.25}
                        }]}]
                    }, {
                        id: 'label', componentId: 'shared-text', name: 'Primary_label', type: 'INSTANCE',
                        layoutMode: 'HORIZONTAL', children: [{id: 'label-copy', name: 'Copy_text', type: 'TEXT', characters: 'Instance'}]
                    }]
                },
                {
                    id: 'choices', name: 'choices_sheet', type: 'FRAME', visible: true, layoutMode: 'VERTICAL',
                    overlayBackgroundInteraction: 'CLOSE_ON_CLICK_OUTSIDE', children: []
                },
                {
                    id: 'shared-text', name: 'Label', type: 'COMPONENT', layoutMode: 'HORIZONTAL',
                    children: [{id: 'shared-copy', name: 'Copy_text', type: 'TEXT', characters: 'Shared'}]
                }
            ]};
            const srcPath = join(root, 'lib', 'blueprints');
            const children = await getPagesAndTraverseChildren({document, srcPath});
            await walkFrameChildren({children, srcPath});
            await ensureAppRouteFileExist({
                template: 'flutter',
                initialId: 'home',
                pages: children.map(page => ({name: page.name, module: page.module, id: page.id}))
            });
            await generateCodeFromSpecs({root: srcPath, projectPath: root});

            const openSpec = await readFile(join(srcPath, 'modules', 'home_page', 'iopen_Open_button.yml'), 'utf8');
            const openWidget = await readFile(join(root, 'lib', 'modules', 'home_page', 'iopen_open_button.dart'), 'utf8');
            const appRoute = await readFile(join(root, 'lib', 'app_route.dart'), 'utf8');
            const runtime = await readFile(join(root, 'lib', 'fastui_runtime.dart'), 'utf8');
            const guard = await readFile(join(root, 'lib', 'routing_guard.dart'), 'utf8');
            const instanceSpec = await readFile(join(srcPath, 'modules', 'home_page', 'ilabel_Primary_label.yml'), 'utf8');
            const sharedSpec = await readFile(join(srcPath, 'modules', 'shared', 'common', 'ishared_text_Label.yml'), 'utf8');
            expect(openSpec).to.include('action: navigation.open');
            expect(openSpec).to.include('type: sheet');
            expect(openSpec).not.to.include('onStart');
            expect(openWidget).to.include("FastUINavigation.navigate(context, name: 'choices', type: 'sheet'");
            expect(openWidget).to.include("transition: 'MOVE_IN'");
            expect(openWidget).to.include("direction: 'BOTTOM'");
            expect(openWidget).to.include('durationMs: 250');
            expect(openWidget).to.include('barrierDismissible: true');
            expect(openWidget).to.include('extends StatelessWidget');
            expect(openSpec).to.match(/width:\s+100%/);
            expect(appRoute).to.include("'choices': FastUISurfaceDefinition(type: 'sheet', builder: () => FastUIChoicesSheet())");
            expect(appRoute).to.include('MaterialApp.router');
            expect(appRoute).to.include('guard: beforeNavigate');
            expect(runtime).to.include('showModalBottomSheet<T>');
            expect(runtime).to.include('showGeneralDialog<T>');
            expect(runtime).to.include('FastUINavigationDecisionType');
            expect(runtime).to.include('Future<bool> popRoute()');
            expect(runtime).to.include('ValueNotifier<FastUIRouteRef?> currentRoute');
            expect(runtime).to.include('Material(type: MaterialType.transparency');
            expect(runtime).to.include('FastUIScrollableSurface(child: FastUINavigation.surface(name))');
            expect(runtime).to.include('SvgPicture.asset');
            expect(guard).to.include('Future<FastUINavigationDecision> beforeNavigate');
            expect(instanceSpec).to.include('ref: ../shared/common/ishared_text_Label.yml');
            expect(instanceSpec).to.include('compose: ./iopen_Open_button.yml');
            expect(sharedSpec).to.include('condition:');
            expect(sharedSpec).not.to.include('onStart');
            const resolvedInstance = await specToJSON(join(srcPath, 'modules', 'home_page', 'ilabel_Primary_label.yml'));
            expect(resolvedInstance.condition.modifier).not.to.have.property('ref');
            expect(resolvedInstance.condition.modifier.left).to.equal('./ilabel_copy_Copy_text.yml');
        });
    });
});
