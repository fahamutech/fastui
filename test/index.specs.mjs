import {expect} from "chai";
import {mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile} from "node:fs/promises";
import {dirname, join, resolve} from "node:path"
import {tmpdir} from "node:os";
import {pathToFileURL} from 'node:url';
import {readSpecs, specToFlutterJSON, specToJSON} from "../src/specs/reader.mjs";
import {composeComponent} from "../src/generators/component.mjs";
import {composeCondition} from "../src/generators/condition.mjs";
import {composeLoop} from "../src/generators/loop.mjs";
import {ensureAppRouteFileExist} from "../src/generators/routing.mjs";
import {ensureBlueprintFolderExist, ensureWatchFileExist} from "../src/tooling/scaffold.mjs";
import {initializeProject} from "../src/tooling/project.mjs";
import {routeFromSurfaceName} from "../src/shared/routing.mjs";
import {fetchFigmaFile, getDesignDocument, getPagesAndTraverseChildren, resolvePrototypeRoute, walkFrameChildren} from "../src/translators/figma/index.mjs";
import {loopScrollDirection} from "../src/translators/figma/layout.mjs";
import {generatedNodeName} from "../src/translators/figma/naming.mjs";
import {generateCodeFromSpecs} from '../src/generators/spec-to-code.mjs';
import {createFrameComponent, createTextComponent} from '../src/translators/figma/spec-writer.mjs';
import {discoverFigmaResources, reconcileFigmaResources} from '../src/translators/figma/resources.mjs';
import {reactRuntimeSource} from '../src/generators/templates/reactjs/runtime.mjs';
import {normalizeSpecDocument} from '../src/generators/spec-normalizer.mjs';
import * as yaml from 'js-yaml';
import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {build as buildJavaScript} from 'esbuild';
import {specFile, logicFile} from './data.mjs'

const delay = milliseconds => new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));

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
            await mkdir(resolve('./test/services'), {recursive: true});
            await writeFile(resolve('./test/services/test_comp.mjs'), logicFile);
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
                modifier: {extend: './icon.yml', states: {value: 'Continue for $100'}, props: {id: 'label_id', children: 'states.value'}, styles: {fontSize: 16}, frame: {base: 'row.start', current: {flex: 1, height: '100%'}}}
            }});
            await composeCondition({path: buttonPath, projectPath: root, data: {
                modifier: {left: './label.yml', props: {onClick: 'logics.onClick'}, frame: {base: 'row.start'}}
            }});
            await composeLoop({path: listPath, projectPath: root, data: {
                modifier: {feed: './label.yml', props: {scroll: 'vertical'}, frame: {base: 'column.start'}}
            }});
            await composeComponent({path: staticPath, projectPath: root, data: {
                base: 'container', modifier: {frame: {base: 'column.start'}}
            }});

            const label = await readFile(join(root, 'lib', 'modules', 'label.dart'), 'utf8');
            const button = await readFile(join(root, 'lib', 'modules', 'button.dart'), 'utf8');
            const list = await readFile(join(root, 'lib', 'modules', 'items.dart'), 'utf8');
            const staticWidget = await readFile(join(root, 'lib', 'modules', 'static.dart'), 'utf8');
            expect(label).to.include('class Label');
            expect(label).to.include("import './icon.dart';");
            expect(label).to.include('extends ConsumerStatefulWidget');
            expect(label).to.include('initialOverrides: widget.overrideStates');
            expect(label).not.to.include("Continue for \\$100");
            expect(label).to.include('ref.watch(labelProvider(_providerInstance))');
            expect(label).to.include("widget.overrideProps['id'] ?? 'label_id'");
            expect(label).to.match(/LayoutBuilder\(\s*builder: \(context, constraints\)/);
            expect(label).to.include('constraints.hasBoundedWidth');
            expect(label).to.match(/height:\s*constraints\.hasBoundedHeight\s*\? constraints\.maxHeight/);
            expect(button).to.match(/GestureDetector\(\s*onTap:/);
            expect(button).to.include('Label(');
            expect(list).to.match(/core\.List<dynamic>\.from\(\s*state\.data/);
            expect(list).to.match(/ListView\.(?:builder|separated)\(/);
            expect(staticWidget).to.include('extends StatelessWidget');
            expect(staticWidget).not.to.include('void initState()');
            expect(await readFile(join(root, 'lib', 'services', 'button.dart'), 'utf8')).to.include('FutureOr<void> onClick');
        });

        it('distinguishes scrollable areas from loop lists in React and Flutter', async function () {
            const flutterRoot = join(root, 'lib', 'blueprints', 'modules');
            const feedPath = join(flutterRoot, 'feed.yml');
            const scrollingPath = join(flutterRoot, 'scrolling.yml');
            const horizontalPath = join(flutterRoot, 'horizontal.yml');
            const staticPath = join(flutterRoot, 'static_loop.yml');
            const areaPath = join(flutterRoot, 'scroll_area.yml');
            await writeFile(feedPath, 'component: {}');
            await writeFile(scrollingPath, 'loop: {}');
            await writeFile(horizontalPath, 'loop: {}');
            await writeFile(staticPath, 'loop: {}');
            await writeFile(areaPath, 'component: {}');
            await composeComponent({path: feedPath, projectPath: root, data: {
                base: 'container', modifier: {styles: {height: 44}}
            }});
            await composeLoop({path: scrollingPath, projectPath: root, data: {
                modifier: {feed: './feed.yml', props: {scroll: 'vertical'}, states: {data: []}, frame: {base: 'column.start'}}
            }});
            await composeLoop({path: staticPath, projectPath: root, data: {
                modifier: {feed: './feed.yml', states: {data: []}, frame: {base: 'column.start'}}
            }});
            await composeLoop({path: horizontalPath, projectPath: root, data: {
                modifier: {feed: './feed.yml', props: {scroll: 'horizontal'}, states: {data: []}, frame: {base: 'row.start'}}
            }});
            await composeComponent({path: areaPath, projectPath: root, data: {
                base: 'container', modifier: {
                    props: {scroll: 'vertical'},
                    frame: {base: {type: 'column.start', styles: {height: '100%', fallbackHeight: 480}}},
                    extend: './feed.yml'
                }
            }});
            const scrollingFlutter = await readFile(join(root, 'lib', 'modules', 'scrolling.dart'), 'utf8');
            const horizontalFlutter = await readFile(join(root, 'lib', 'modules', 'horizontal.dart'), 'utf8');
            const staticFlutter = await readFile(join(root, 'lib', 'modules', 'static_loop.dart'), 'utf8');
            const areaFlutter = await readFile(join(root, 'lib', 'modules', 'scroll_area.dart'), 'utf8');
            const feedFlutter = await readFile(join(root, 'lib', 'modules', 'feed.dart'), 'utf8');
            expect(scrollingFlutter).to.include('ListView.separated(');
            expect(horizontalFlutter).to.include('ListView.separated(');
            expect(horizontalFlutter).to.match(/scrollDirection:\s*Axis\.horizontal/);
            expect(staticFlutter).not.to.include('ListView.');
            expect(staticFlutter).to.include('Column(');
            expect(staticFlutter).not.to.include('SingleChildScrollView');
            expect(areaFlutter).to.match(/SingleChildScrollView\(\s*scrollDirection:\s*Axis\.vertical/);
            expect(areaFlutter).not.to.include('ListView.builder');
            expect(areaFlutter).to.include('constraints.minHeight > 480');
            expect(areaFlutter).not.to.include('constraints.minHeight > 0\n                    ? constraints.minHeight\n                    : 0, child:');
            expect(feedFlutter).to.include('static const double? fastUIFixedHeight = 44;');

            process.env.FASTUI_TEMPLATE = 'reactjs';
            const reactRoot = join(root, 'src', 'blueprints', 'modules');
            await mkdir(reactRoot, {recursive: true});
            const reactFeed = join(reactRoot, 'feed.yml');
            const reactScrolling = join(reactRoot, 'scrolling.yml');
            const reactStatic = join(reactRoot, 'static_loop.yml');
            const reactArea = join(reactRoot, 'scroll_area.yml');
            await writeFile(reactFeed, 'component:\n  modifier:\n    frame:\n      base:\n        styles:\n          width: 400\n');
            await writeFile(reactScrolling, 'loop: {}');
            await writeFile(reactStatic, 'loop: {}');
            await writeFile(reactArea, 'component: {}');
            await composeLoop({path: reactScrolling, projectPath: root, data: {
                modifier: {feed: './feed.yml', props: {scroll: 'horizontal'}, states: {data: []}, frame: {base: 'row.start'}}
            }});
            await composeLoop({path: reactStatic, projectPath: root, data: {
                modifier: {feed: './feed.yml', states: {data: []}, frame: {base: 'row.start'}}
            }});
            await composeComponent({path: reactArea, projectPath: root, data: {
                base: 'container', modifier: {props: {scroll: 'vertical'}, frame: {base: 'column.start'}, extend: './feed.yml'}
            }});
            const scrollingReact = await readFile(join(root, 'src', 'modules', 'scrolling.jsx'), 'utf8');
            const staticReact = await readFile(join(root, 'src', 'modules', 'static_loop.jsx'), 'utf8');
            const areaReact = await readFile(join(root, 'src', 'modules', 'scroll_area.jsx'), 'utf8');
            expect(scrollingReact).to.include('instanceId,initialState={},initialProps={}');
            expect(scrollingReact).not.to.include('overrideStates');
            expect(scrollingReact).to.include("overflowX:'auto'");
            expect(scrollingReact).to.include('minWidth:0');
            expect(scrollingReact).not.to.include('ref={listRef}');
            expect(scrollingReact).not.to.include('visibleItems.map');
            expect(scrollingReact).to.include('data?.map((item,index)');
            expect(scrollingReact).not.to.include('<div></div>');
            expect(scrollingReact).not.to.include('scroll=');
            expect(staticReact).not.to.include('overflowX');
            expect(staticReact).not.to.include('overflowY');
            expect(staticReact).not.to.include('const style = React.useMemo');
            expect(areaReact).to.include('overflowY');
            expect(areaReact).to.include('"flex":1');
            expect(areaReact).to.include('"minHeight":0');
            expect(areaReact).not.to.include('ref={listRef}');
        });

        it('emits gap from frame.baseStyles.spaceValue for both React and Flutter', async function () {
            process.env.FASTUI_TEMPLATE = 'reactjs';
            const reactRoot = join(root, 'src', 'blueprints', 'modules');
            await mkdir(reactRoot, {recursive: true});
            const childPath = join(reactRoot, 'gap_child.yml');
            const parentPath = join(reactRoot, 'gap_parent.yml');
            await writeFile(childPath, 'component: {}');
            await writeFile(parentPath, 'component: {}');
            await composeComponent({path: childPath, projectPath: root, data: {base: 'container', modifier: {}}});
            await composeComponent({path: parentPath, projectPath: root, data: {
                base: 'container',
                modifier: {
                    extend: ['./gap_child.yml'],
                    frame: {base: {type: 'column.start', styles: {spaceValue: 16, width: '100%'}}, id: 'gap-frame'}
                }
            }});
            const reactGenerated = await readFile(join(root, 'src', 'modules', 'gap_parent.jsx'), 'utf8');
            expect(reactGenerated).to.include('"gap":16');
            expect(reactGenerated).not.to.include('spaceValue');

            process.env.FASTUI_TEMPLATE = 'flutter';
            const flutterRoot = join(root, 'lib', 'blueprints', 'modules');
            const flutterChild = join(flutterRoot, 'gap_child.yml');
            const flutterChild2 = join(flutterRoot, 'gap_child2.yml');
            const flutterParent = join(flutterRoot, 'gap_parent.yml');
            await writeFile(flutterChild, 'component: {}');
            await writeFile(flutterChild2, 'component: {}');
            await writeFile(flutterParent, 'component: {}');
            await composeComponent({path: flutterChild, projectPath: root, data: {base: 'container', modifier: {}}});
            await composeComponent({path: flutterChild2, projectPath: root, data: {base: 'container', modifier: {}}});
            await composeComponent({path: flutterParent, projectPath: root, data: {
                base: 'container',
                modifier: {
                    extend: ['./gap_child.yml', './gap_child2.yml'],
                    frame: {base: {type: 'column.start', styles: {spaceValue: 16, width: '100%'}}, id: 'gap-frame'}
                }
            }});
            const flutterGenerated = await readFile(join(root, 'lib', 'modules', 'gap_parent.dart'), 'utf8');
            expect(flutterGenerated).to.match(/SizedBox\(\s*height: 16/);
            expect(flutterGenerated).not.to.include('spaceValue');
        });

        it('keeps frame styles in modifier.frame.base.styles and omits modifier.styles for frame composers', async function () {
            const specPath = join(root, 'frame_composer.yml');
            await createFrameComponent({
                filename: specPath,
                child: {
                    name: 'Hero',
                    children: [{name: 'Title'}],
                    mainFrame: {
                        base: 'column.start',
                        id: 'hero_frame',
                        styles: {paddingTop: 12, backgroundColor: '#FFFFFF'}
                    },
                    styles: {color: 'red'}
                },
                routeLookup: {}
            });
            const spec = await specToJSON(specPath);
            expect(spec.component.modifier.styles).to.equal(undefined);
            expect(spec.component.modifier.frame.base.type).to.equal('column.start');
            expect(spec.component.modifier.frame.base.styles).to.deep.include({paddingTop: 12, backgroundColor: '#FFFFFF'});
        });

        it('omits empty current and next wrappers in generated React and Flutter output', async function () {
            process.env.FASTUI_TEMPLATE = 'reactjs';
            const reactRoot = join(root, 'src', 'blueprints', 'modules');
            await mkdir(reactRoot, {recursive: true});
            const reactChildPath = join(reactRoot, 'frame_child.yml');
            const reactParentPath = join(reactRoot, 'frame_parent.yml');
            await writeFile(reactChildPath, 'component: {}');
            await writeFile(reactParentPath, 'component: {}');
            await composeComponent({path: reactChildPath, projectPath: root, data: {base: 'text', modifier: {props: {children: 'Hello'}}}});
            await composeComponent({path: reactParentPath, projectPath: root, data: {
                base: 'container',
                modifier: {
                    extend: ['./frame_child.yml'],
                    props: {id: 'parent_id'},
                    frame: {base: {type: 'column.start', styles: {paddingTop: 8}}, id: 'parent_frame', current: {}, next: {}}
                }
            }});
            const reactGenerated = await readFile(join(root, 'src', 'modules', 'frame_parent.jsx'), 'utf8');
            expect(reactGenerated).to.include("id={'parent_frame'}");
            expect(reactGenerated).to.include('"paddingTop":8');
            expect(reactGenerated).not.to.include("_next_0");
            expect(reactGenerated).not.to.include('style={style}');

            process.env.FASTUI_TEMPLATE = 'flutter';
            const flutterRoot = join(root, 'lib', 'blueprints', 'modules');
            const flutterChildPath = join(flutterRoot, 'frame_child.yml');
            const flutterParentPath = join(flutterRoot, 'frame_parent.yml');
            await writeFile(flutterChildPath, 'component: {}');
            await writeFile(flutterParentPath, 'component: {}');
            await composeComponent({path: flutterChildPath, projectPath: root, data: {base: 'text', modifier: {props: {children: 'Hello'}}}});
            await composeComponent({path: flutterParentPath, projectPath: root, data: {
                base: 'container',
                modifier: {
                    extend: ['./frame_child.yml'],
                    props: {id: 'parent_id'},
                    frame: {base: {type: 'column.start', styles: {paddingTop: 8}}, id: 'parent_frame', current: {}, next: {}}
                }
            }});
            const flutterGenerated = await readFile(join(root, 'lib', 'modules', 'frame_parent.dart'), 'utf8');
            expect(flutterGenerated).to.include('EdgeInsets.fromLTRB(0, 8, 0, 0)');
            expect(flutterGenerated).not.to.include('_buildWithOverride');
            expect(flutterGenerated).to.include('FrameChild(');
            expect(flutterGenerated).to.include("instanceId: '\${widget.instanceId ?? 'root'}/0/FrameChild'");
        });

        it('serializes Figma text with translation key plus raw fallback text', async function () {
            const specPath = join(root, 'translated_text_spec.yml');
            await createTextComponent(specPath, {
                name: 'ShopNow',
                characters: 'Shop now',
                style: {
                    fontFamily: 'Inter',
                    fontPostScriptName: 'Inter-Regular',
                    fontWeight: 400,
                    fontSize: 14,
                    textAutoResize: 'WIDTH_AND_HEIGHT',
                    textAlignHorizontal: 'LEFT',
                    textAlignVertical: 'TOP',
                    letterSpacing: 0,
                    lineHeightPx: 16.8,
                    lineHeightPercent: 100,
                    lineHeightUnit: 'INTRINSIC_%',
                },
            });
            const spec = await specToJSON(specPath);
            expect(spec.component.modifier.props.children).to.deep.equal({translation: {key: 'shop_now', fallback: 'Shop now'}});
            expect(spec.component.modifier.styles).to.deep.equal({
                fontFamily: 'Inter',
                fontWeight: 400,
                fontSize: 14,
                letterSpacing: 0,
                lineHeightPx: 16.8,
                textAlign: 'start',
            });
        });

        it('serializes Figma $ text markers as component-local state', async function () {
            const specPath = join(root, 'state_text_spec.yml');
            await createTextComponent(specPath, {
                id: 'profile-name',
                type: 'TEXT',
                name: 'ProfileName_$name',
                characters: 'Joshua',
            });
            const spec = await specToJSON(specPath);
            expect(spec.component.modifier.props.children).to.equal('states.name');
            expect(spec.component.modifier.states).to.deep.equal({name: 'Joshua'});
            expect(spec.component.modifier.effects.onInit.body).to.equal('logics.ProfileName_init');
            expect(generatedNodeName({id: '1:2', type: 'TEXT', name: 'ProfileName_$name'})).to.equal('i1_2_Profilename');
            expect(generatedNodeName({id: '1:3', type: 'TEXT', name: '$name'})).to.equal('i1_3_Name_text');
        });

        it('generates Figma state text as provider-backed Flutter UI', async function () {
            process.env.FASTUI_TEMPLATE = 'flutter';
            const specPath = join(root, 'lib', 'blueprints', 'modules', 'profile_name.yml');
            await mkdir(join(root, 'lib', 'blueprints', 'modules'), {recursive: true});
            await createTextComponent(specPath, {
                id: 'profile-name',
                type: 'TEXT',
                name: 'ProfileName_$name',
                characters: 'Joshua',
            });
            await generateCodeFromSpecs({root: join(root, 'lib', 'blueprints'), projectPath: root});
            const widget = await readFile(join(root, 'lib', 'modules', 'profile_name.dart'), 'utf8');
            const provider = await readFile(join(root, 'lib', 'stores', 'shared', 'providers.generated.dart'), 'utf8');
            expect(widget).to.include('extends ConsumerStatefulWidget');
            expect(widget).to.include('final String? instanceId');
            expect(widget).to.include('ref.watch(profileNameProvider(_providerInstance))');
            expect(widget).to.include("widget.overrideProps.containsKey('children')");
            expect(widget).to.include("(state.name ?? '')");
            expect(provider).to.include('class FastUIProfileNameNotifier extends AutoDisposeFamilyNotifier');
            expect(provider).to.include('FastUIProfileNameStateModel fastUIProfileNameInitialState');
            expect(provider).to.include('argument.initialOverrides');
            expect(provider).to.include('Joshua');
            expect(provider).to.include('void setName(String? value) => state = state.copyWith(name: value)');
            expect(provider).to.include('case "name":');
            expect(provider).to.include('Future<void> initialize(FutureOr<void> Function() callback)');
            expect(provider).not.to.include('ChangeNotifier');
            expect(widget).not.to.include('FastUIModuleStore');
            expect(widget).not.to.include('_publishState');
            expect(widget).not.to.include('Joshua');
        });

        it('generates ordinary translated text as a reactive ConsumerWidget without a service', async function () {
            process.env.FASTUI_TEMPLATE = 'flutter';
            const specPath = join(root, 'lib', 'blueprints', 'modules', 'welcome_title.yml');
            await createTextComponent(specPath, {
                id: 'welcome-title',
                type: 'TEXT',
                name: 'WelcomeTitle_text',
                characters: 'Welcome',
            });
            await generateCodeFromSpecs({root: join(root, 'lib', 'blueprints'), projectPath: root});
            const widget = await readFile(join(root, 'lib', 'modules', 'welcome_title.dart'), 'utf8');
            const runtime = await readFile(join(root, 'lib', 'fastui_runtime.dart'), 'utf8');
            const catalog = await readFile(join(root, 'lib', 'translations', 'generated.dart'), 'utf8');
            expect(widget).to.include('extends ConsumerWidget');
            expect(widget).to.include('ref.watch(fastUITranslateProvider(');
            expect(widget).to.include("key: 'welcome'");
            expect(widget).not.to.include('fallback:');
            expect(widget).not.to.include('defaultCatalog:');
            expect(widget).not.to.include("services/welcome_title.dart");
            expect(runtime).to.match(/const FastUITranslationState\(\{\s*this\.locale = 'default'/);
            expect(runtime).to.include("catalogs['default']?[key]");
            expect(catalog).to.match(/["']welcome["']:\s*["']Welcome["']/);
        });

        it('emits typed Flutter text and box styles without raw style maps', async function () {
            process.env.FASTUI_TEMPLATE = 'flutter';
            const specPath = join(root, 'lib', 'blueprints', 'modules', 'styled_text.yml');
            await composeComponent({path: specPath, projectPath: root, data: {
                base: 'text',
                modifier: {
                    styles: {
                        fontFamily: 'Inter', fontWeight: 400, fontSize: 14,
                        lineHeightPx: 16.8, color: '#ffffff', textAlign: 'start',
                        width: 120, padding: '4 8', borderRadius: 6,
                        backgroundColor: '#111111', opacity: 0.9,
                        fontPostScriptName: 'Inter-Regular', textAutoResize: 'WIDTH_AND_HEIGHT',
                    },
                    props: {children: 'Styled'},
                },
            }});
            const widget = await readFile(join(root, 'lib', 'modules', 'styled_text.dart'), 'utf8');
            expect(widget).to.include("fontFamily: 'Inter'");
            expect(widget).to.include('fontWeight: FontWeight.w400');
            expect(widget).to.include('fontSize: 14');
            expect(widget).to.include('width: 120');
            expect(widget).to.include('padding: EdgeInsets.fromLTRB(8, 4, 8, 4)');
            expect(widget).to.include('borderRadius: BorderRadius.circular(6)');
            expect(widget).to.include('Opacity(');
            expect(widget).not.to.include('_buildWithOverride');
            expect(widget).not.to.include('overrideStyles');
            expect(widget).not.to.include('fontPostScriptName');
            expect(widget).not.to.include('textAutoResize');
        });

        it('maps Flutter image, frame, input, border, radius, and CSS color styles', async function () {
            process.env.FASTUI_TEMPLATE = 'flutter';
            const moduleRoot = join(root, 'lib', 'blueprints', 'modules');
            const imagePath = join(moduleRoot, 'rounded_image.yml');
            const framePath = join(moduleRoot, 'styled_frame.yml');
            const inputPath = join(moduleRoot, 'styled_input.yml');

            await composeComponent({path: imagePath, projectPath: root, data: {
                base: 'image', modifier: {
                    styles: {
                        width: 120, height: 80, objectFit: 'contain', borderRadius: '12px',
                        borderTopWidth: 1, borderRightWidth: 2, borderBottomWidth: 3, borderLeftWidth: 4,
                        borderColor: '#1234', boxShadow: '0 2 8 0 rgba(0,0,0,0.25)',
                    },
                    props: {src: 'asset://figma/photo.png'},
                },
            }});
            await composeComponent({path: framePath, projectPath: root, data: {
                base: 'container', modifier: {
                    frame: {base: {type: 'column.start', styles: {
                        borderTopLeftRadius: 2, borderTopRightRadius: 4,
                        borderBottomRightRadius: 6, borderBottomLeftRadius: 8,
                        borderWidth: 1, borderColor: '#112233', opacity: 0.75,
                        minWidth: 40, overflow: 'hidden',
                    }}},
                },
            }});
            await composeComponent({path: inputPath, projectPath: root, data: {
                base: 'input', modifier: {
                    styles: {
                        fontFamily: 'Inter', fontWeight: 700, fontSize: '16px', color: '#112233',
                        textAlign: 'center', borderRadius: '8px 4px', backgroundColor: '#ffffff',
                        margin: '4 8', width: 240,
                    },
                    props: {placeholder: 'Search', readOnly: true},
                },
            }});

            const image = await readFile(join(root, 'lib', 'modules', 'rounded_image.dart'), 'utf8');
            const frame = await readFile(join(root, 'lib', 'modules', 'styled_frame.dart'), 'utf8');
            const input = await readFile(join(root, 'lib', 'modules', 'styled_input.dart'), 'utf8');
            expect(image).to.include('ClipRRect(borderRadius: BorderRadius.circular(12)');
            expect(image).to.include('fit: BoxFit.contain');
            expect(image).to.include('Border(top: BorderSide(');
            expect(image).to.include('Color(0x44112233)');
            expect(image).to.include('boxShadow: <BoxShadow>[');
            expect(frame).to.include('topLeft: Radius.circular(2)');
            expect(frame).to.include('bottomLeft: Radius.circular(8)');
            expect(frame).to.include('ConstrainedBox(');
            expect(frame).to.include('ClipRRect(');
            expect(frame).to.include('Opacity(');
            expect(input).to.include("fontFamily: 'Inter'");
            expect(input).to.include('fontWeight: FontWeight.w700');
            expect(input).to.include('textAlign: TextAlign.center');
            expect(input).to.include('topLeft: Radius.circular(8)');
            expect(input).to.include('topRight: Radius.circular(4)');
            expect(input).to.include('readOnly: true');
            expect(input).to.include('margin: EdgeInsets.fromLTRB(8, 4, 8, 4)');
        });

        it('retains service-computed Flutter styles without runtime override maps', async function () {
            process.env.FASTUI_TEMPLATE = 'flutter';
            const specPath = join(root, 'lib', 'blueprints', 'modules', 'dynamic_style.yml');
            await composeComponent({path: specPath, projectPath: root, data: {
                base: 'container',
                modifier: {styles: 'logics.computeStyle', props: {children: 'Dynamic'}},
            }});
            const widget = await readFile(join(root, 'lib', 'modules', 'dynamic_style.dart'), 'utf8');
            const service = await readFile(join(root, 'lib', 'services', 'dynamic_style.dart'), 'utf8');
            expect(widget).to.include('FastUIStyleHelper.buildBox(');
            expect(widget).to.include('computeStyle(');
            expect(widget).to.include('_componentContext(');
            expect(widget).not.to.include('overrideStyles');
            expect(service).to.include('Map<String, dynamic> computeStyle(');
            expect(service).to.include('return const <String, dynamic>{};');
            expect(service).not.to.include("import 'dart:async';");
        });

        it('emits translation keys and interpolation args without UI fallbacks on both targets', async function () {
            const data = {
                base: 'text',
                modifier: {
                    states: {name: 'Joshua'},
                    props: {children: {translation: {
                        key: 'welcome_name',
                        fallback: 'Welcome {name}',
                        args: {name: 'states.name'},
                    }}},
                },
            };
            process.env.FASTUI_TEMPLATE = 'flutter';
            const flutterPath = join(root, 'lib', 'blueprints', 'modules', 'interpolated.yml');
            await composeComponent({path: flutterPath, projectPath: root, data});
            const flutter = await readFile(join(root, 'lib', 'modules', 'interpolated.dart'), 'utf8');
            expect(flutter).to.include("key: 'welcome_name'");
            expect(flutter).to.include("args: {'name': state.name}");
            expect(flutter).not.to.include('Welcome {name}');
            expect(flutter).not.to.include('fallback:');

            process.env.FASTUI_TEMPLATE = 'reactjs';
            const reactPath = join(root, 'src', 'blueprints', 'modules', 'interpolated.yml');
            await composeComponent({path: reactPath, projectPath: root, data});
            const react = await readFile(join(root, 'src', 'modules', 'interpolated.jsx'), 'utf8');
            expect(react).to.include('useFastUITranslation("welcome_name",{"name":name})');
            expect(react).not.to.include('Welcome {name}');
            process.env.FASTUI_TEMPLATE = 'flutter';
        });

        it('emits translated input placeholders without fallback literals', async function () {
            process.env.FASTUI_TEMPLATE = 'flutter';
            const data = {
                base: 'input',
                modifier: {
                    states: {value: ''},
                    props: {
                        control: 'input',
                        value: 'states.value',
                        placeholder: {translation: {key: 'type_here', fallback: 'Type here'}},
                    },
                },
            };
            const path = join(root, 'lib', 'blueprints', 'modules', 'translated_input.yml');
            await composeComponent({path, projectPath: root, data});
            const widget = await readFile(join(root, 'lib', 'modules', 'translated_input.dart'), 'utf8');
            expect(widget).to.include("const FastUITranslationRequest(key: 'type_here')");
            expect(widget).not.to.include('Type here');
            expect(widget).not.to.include('fallback:');
        });

        it('rejects malformed Figma state-text markers with node context', async function () {
            let failure;
            try {
                await createTextComponent(join(root, 'invalid_state_text.yml'), {
                    id: 'bad-text',
                    type: 'TEXT',
                    name: 'ProfileName_$9name',
                    characters: 'Joshua',
                });
            } catch (error) {
                failure = error;
            }
            expect(failure?.message).to.include('ProfileName_$9name');
            expect(failure?.message).to.include('bad-text');
            expect(failure?.message).to.include('Use $name or DescriptiveName_$name');
        });

        it('renders logics.t children through generated services for React and Flutter', async function () {
            process.env.FASTUI_TEMPLATE = 'reactjs';
            const reactRoot = join(root, 'src', 'blueprints', 'modules');
            await mkdir(reactRoot, {recursive: true});
            const reactPath = join(reactRoot, 'translated_text.yml');
            await writeFile(reactPath, 'component: {}');
            await composeComponent({path: reactPath, projectPath: root, data: {
                base: 'text',
                modifier: {props: {children: "logics.t('shop_now', 'Shop now')"}}
            }});
            const reactGenerated = await readFile(join(root, 'src', 'modules', 'translated_text.jsx'), 'utf8');
            const reactService = await readFile(join(root, 'src', 'services', 'translated_text.mjs'), 'utf8');
            expect(reactGenerated).to.include("import {t} from '../services/translated_text.mjs';");
            expect(reactGenerated).to.include("{t(component.withArgs(['shop_now', 'Shop now']))}");
            expect(reactService).to.include("import {fastUITranslationStore} from '../translations/generated.mjs';");
            expect(reactService).to.include('export function t(context)');
            expect(reactService).to.include('return fastUITranslationStore.translate(key);');

            process.env.FASTUI_TEMPLATE = 'flutter';
            const flutterRoot = join(root, 'lib', 'blueprints', 'modules');
            const flutterPath = join(flutterRoot, 'translated_text.yml');
            await writeFile(flutterPath, 'component: {}');
            await composeComponent({path: flutterPath, projectPath: root, data: {
                base: 'text',
                modifier: {props: {children: "logics.t('shop_now', 'Shop now')"}}
            }});
            const flutterGenerated = await readFile(join(root, 'lib', 'modules', 'translated_text.dart'), 'utf8');
            const flutterService = await readFile(join(root, 'lib', 'services', 'translated_text.dart'), 'utf8');
            const flutterRuntime = await readFile(join(root, 'lib', 'fastui_runtime.dart'), 'utf8');
            expect(flutterGenerated).to.include("import '../services/translated_text.dart';");
            expect(flutterGenerated).to.include("t(_componentContext(context, ref, ['shop_now', 'Shop now']))");
            expect(flutterGenerated).to.include('args: argument == null ? <dynamic>[]');
            expect(flutterService).to.include("import '../fastui_runtime.dart';");
            expect(flutterService).to.include('dynamic t(FastUIComponentContext<dynamic, dynamic> context)');
            expect(flutterService).to.include('final normalized = args.length == 1 && args.first is List ? List<dynamic>.from(args.first as List) : args;');
            expect(flutterService).to.include('fastUITranslationProvider');
            expect(flutterRuntime).to.include("catalogs['default']?[key]");
            expect(flutterRuntime).to.include('?? key;');
            expect(flutterRuntime).not.to.include('humanizeKey');
        });

        it('Figma loops explicitly serialize props.scroll', async function () {
            expect(loopScrollDirection({overflowDirection: 'VERTICAL_SCROLLING'})).to.equal('vertical');
            expect(loopScrollDirection({overflowDirection: 'HORIZONTAL_SCROLLING'})).to.equal('horizontal');
            expect(loopScrollDirection({overflowDirection: 'HORIZONTAL_AND_VERTICAL_SCROLLING'})).to.equal('both');
            expect(loopScrollDirection({mainFrame: {overflowDirection: 'HORIZONTAL_SCROLLING'}})).to.equal('horizontal');
            expect(loopScrollDirection({props: {scroll: 'horizontal'}, layoutMode: 'VERTICAL'})).to.equal('horizontal');
            expect(loopScrollDirection({layoutMode: 'VERTICAL'})).to.equal('vertical');
            expect(loopScrollDirection({layoutMode: 'HORIZONTAL'})).to.equal('horizontal');
            expect(loopScrollDirection({})).to.equal(undefined);
            expect(loopScrollDirection(undefined)).to.equal(undefined);

            const document = {children: [{
                id: 'page', name: 'scroll_page', type: 'FRAME', visible: true, layoutMode: 'VERTICAL',
                children: [{
                    id: 'list', name: 'Items_repeat', type: 'FRAME', layoutMode: 'VERTICAL',
                    primaryAxisAlignItems: 'MIN', layoutSizingVertical: 'FILL',
                    children: [
                        {id: 'item', name: 'Item_row', type: 'FRAME', layoutMode: 'HORIZONTAL', children: [
                            {id: 'title', name: 'Title_text', type: 'TEXT', characters: 'First item', visible: true, style: {}},
                            {id: 'price', name: 'Price_text', type: 'TEXT', characters: '12.50', visible: true, style: {}},
                            {id: 'photo', name: 'Photo_image', type: 'RECTANGLE', fills: [{type: 'IMAGE', imageRef: 'photo-ref'}]},
                        ]},
                        {id: 'item-2', name: 'Item_row', type: 'FRAME', layoutMode: 'HORIZONTAL', children: [
                            {id: 'title-2', name: 'Title_text', type: 'TEXT', characters: 'Second item', visible: true, style: {}},
                            {id: 'price-2', name: 'Price_text', type: 'TEXT', characters: '20.00', visible: true, style: {}},
                            {id: 'photo-2', name: 'Photo_image', type: 'RECTANGLE', fills: [{type: 'IMAGE', imageRef: 'photo-ref-2'}]},
                        ]},
                    ]
                }]
            }]};
            const srcPath = join(root, 'lib', 'blueprints');
            const children = await getPagesAndTraverseChildren({document, srcPath});
            await walkFrameChildren({children, srcPath});
            const listSpec = await readFile(join(srcPath, 'modules', 'presentation', 'pages', 'ilist_Items_repeat.yml'), 'utf8');
            expect(listSpec).to.include('scroll: vertical');
            const parsedLoop = yaml.load(listSpec).loop;
            expect(parsedLoop.modifier.states.data).to.deep.equal([]);
            expect(parsedLoop.modifier.metadata.loopInitialData).to.deep.equal([
                {_key: 'item', title: 'First item', price: '12.50', photo: 'asset://figma/photo-ref.png'},
                {_key: 'item-2', title: 'Second item', price: '20.00', photo: 'asset://figma/photo-ref-2.png'},
            ]);
            const titleSpec = await readFile(join(srcPath, 'modules', 'presentation', 'pages', 'ititle_Title_text.yml'), 'utf8');
            expect(titleSpec).to.include('children: inputs.loopElement.title');
            expect(titleSpec).not.to.include('First item');

            await generateCodeFromSpecs({root: srcPath, projectPath: root});
            const loopService = await readFile(join(root, 'lib', 'services', 'presentation', 'pages', 'ilist_items_repeat.dart'), 'utf8');
            expect(loopService).to.include("context.notifier.setData(<dynamic>[<String, dynamic>{\"_key\": \"item\", \"title\": \"First item\", \"price\": \"12.50\", \"photo\": \"asset://figma/photo-ref.png\"}");
            const loopStore = await readFile(join(root, 'lib', 'stores', 'presentation', 'providers.generated.dart'), 'utf8');
            expect(loopStore).to.match(/"data": <dynamic>\[\],/);
            expect(loopStore).not.to.include('First item');

            const documentWithExplicit = {children: [{
                id: 'page2', name: 'scroll_page2', type: 'FRAME', visible: true, layoutMode: 'VERTICAL',
                children: [{
                    id: 'list2', name: 'Feed_repeat', type: 'FRAME', layoutMode: 'VERTICAL',
                    overflowDirection: 'HORIZONTAL_SCROLLING',
                    children: [{id: 'item2', name: 'Row_item', type: 'FRAME', layoutMode: 'HORIZONTAL', children: []}]
                }]
            }]};
            const children2 = await getPagesAndTraverseChildren({document: documentWithExplicit, srcPath});
            await walkFrameChildren({children: children2, srcPath});
            const scrollSpec = await readFile(join(srcPath, 'modules', 'presentation', 'pages', 'ilist2_Feed_repeat.yml'), 'utf8');
            expect(scrollSpec).to.include('scroll: horizontal');

            const documentWithScrollableArea = {children: [{
                id: 'page3', name: 'scroll_page3', type: 'FRAME', visible: true, layoutMode: 'VERTICAL',
                children: [{
                    id: 'body', name: 'Body_container', type: 'FRAME', layoutMode: 'VERTICAL',
                    overflowDirection: 'VERTICAL_SCROLLING',
                    children: [{id: 'child3', name: 'Content_text', type: 'TEXT', characters: 'Hi', visible: true, style: {}}]
                }]
            }]};
            const children3 = await getPagesAndTraverseChildren({document: documentWithScrollableArea, srcPath});
            await walkFrameChildren({children: children3, srcPath});
            const areaSpec = await readFile(join(srcPath, 'modules', 'presentation', 'pages', 'ibody_Body_container.yml'), 'utf8');
            expect(areaSpec).to.include('scroll: vertical');
        });

        it('moves authored loop samples into typed service seeds for React', async function () {
            process.env.FASTUI_TEMPLATE = 'reactjs';
            const specRoot = join(root, 'src', 'blueprints', 'modules', 'shop');
            await mkdir(specRoot, {recursive: true});
            await writeFile(join(specRoot, 'row.yml'), 'component: {}\n');
            await writeFile(join(specRoot, 'products.yml'), `loop:
  modifier:
    feed: ./row.yml
    states:
      data:
        - _key: product-1
          name: Coffee
          price: '12.50'
          photo: asset://figma/coffee.png
    effects:
      onInit:
        body: logics.products_init
`);

            await generateCodeFromSpecs({root: join(root, 'src', 'blueprints'), projectPath: root});
            const store = await readFile(join(root, 'src', 'stores', 'shop', 'stores.generated.mjs'), 'utf8');
            const models = await readFile(join(root, 'src', 'stores', 'shop', 'models.generated.mjs'), 'utf8');
            const servicePath = join(root, 'src', 'services', 'shop', 'products.mjs');
            const service = await readFile(servicePath, 'utf8');

            expect(store).to.match(/"data": \[\],/);
            expect(store).not.to.include('Coffee');
            expect(store).to.include('Array<{_key: string, name: string, price: string, photo: string}>');
            expect(models).to.include('@typedef {Object} ProductsDataItem');
            expect(models).to.include('@property {ProductsDataItem[]} data');
            expect(service).to.include('context.store.setData(context.instanceId, [');
            expect(service).to.include('"name": "Coffee"');
            expect(service).to.include('"photo": "/images/figma/coffee.png"');

            await writeFile(servicePath, 'export function products_init(context) { context.setState("data", []); }\n');
            await generateCodeFromSpecs({root: join(root, 'src', 'blueprints'), projectPath: root});
            expect(await readFile(servicePath, 'utf8')).to.equal('export function products_init(context) { context.setState("data", []); }\n');
        });

        it('initializes a Flutter project and selects lib/blueprints', async function () {
            const fakeFlutter = async () => {
                await mkdir(join(root, 'lib'), {recursive: true});
                await writeFile(join(root, 'pubspec.yaml'), 'name: generated_app\nenvironment:\n  sdk: ">=3.0.0 <4.0.0"\n');
            };
            const result = await initializeProject({template: 'flutter', runCommand: fakeFlutter});
            expect(result).to.deep.equal({template: 'flutter', blueprintRoot: 'lib/blueprints'});
            const config = JSON.parse(await readFile(join(root, 'fastui.config.json'), 'utf8'));
            expect(config.template).to.equal('flutter');
            expect(config.resources.fonts).to.deep.equal({});
            await readdir(join(root, 'lib', 'blueprints'));
            await readdir(join(root, 'assets', 'fonts', 'figma'));
            expect(await readFile(join(root, 'lib', 'main.dart'), 'utf8')).to.include('FastUIAppRoute');
            expect(await readFile(join(root, 'lib', 'main.dart'), 'utf8')).to.include('ProviderScope');
            expect(await readFile(join(root, 'lib', 'app_route.dart'), 'utf8')).to.include('FastUIStyleHelper.lightTheme()');
            expect(await readFile(join(root, 'lib', 'app_route.dart'), 'utf8')).to.include('FastUIStyleHelper.darkTheme()');
            const runtime = await readFile(join(root, 'lib', 'fastui_runtime.dart'), 'utf8');
            expect(runtime).to.include(`RegExp(r'''^['"]|['"]$''')`);
            expect(await readFile(join(root, 'lib', 'translations', 'generated.dart'), 'utf8'))
                .to.include('fastUITranslationsDefault');
            const startScript = await readFile(join(root, 'fastui_dev.sh'), 'utf8');
            expect(startScript).to.include('WATCHER_PID_FILE=".fastui/watch.pid"');
            expect(startScript).to.include('export FASTUI_FLUTTER_PID="$FLUTTER_PID"');
            expect(startScript).to.include('wait "$FLUTTER_PID"');
            expect(startScript).to.include('trap cleanup EXIT');
            expect(startScript).to.include("trap 'cleanup; exit 130' INT TERM");
            const pubspec = await readFile(join(root, 'pubspec.yaml'), 'utf8');
            expect(pubspec).to.include('flutter_riverpod: ^2.6.1');
        });

        it('builds from the configured blueprint root when no path is supplied', async function () {
            const specPath = join(root, 'lib', 'blueprints', 'modules', 'default_root.yml');
            await writeFile(specPath, 'component:\n  base: container\n  modifier: {}\n');
            const results = await generateCodeFromSpecs({projectPath: root});
            expect(results.some(result => result.specPath.endsWith('default_root.yml'))).to.equal(true);
            await stat(join(root, 'lib', 'modules', 'default_root.dart'));
        });

        it('copies root-cached Figma assets into the Flutter asset bundle', async function () {
            const cacheRoot = join(root, '.fastui', 'assets', 'figma');
            const specPath = join(root, 'lib', 'blueprints', 'modules', 'asset_root.yml');
            await mkdir(cacheRoot, {recursive: true});
            await writeFile(join(cacheRoot, 'back_icon.svg'), '<svg/>');
            await writeFile(specPath, 'component:\n  base: container\n  modifier: {}\n');
            await generateCodeFromSpecs({projectPath: root});
            const copied = await readFile(join(root, 'assets', 'images', 'figma', 'back_icon.svg'), 'utf8');
            expect(copied).to.equal('<svg/>');
        });

        it('build path creates the generated React observable runtime', async function () {
            process.env.FASTUI_TEMPLATE = 'reactjs';
            const reactRoot = join(root, 'src', 'blueprints', 'modules');
            await mkdir(reactRoot, {recursive: true});
            const specPath = join(reactRoot, 'build_support.yml');
            await writeFile(specPath, 'component:\n  base: container\n  modifier: {}\n');
            const results = await generateCodeFromSpecs({projectPath: root});
            expect(results.some(result => result.specPath.endsWith('build_support.yml'))).to.equal(true);
            const runtime = await readFile(join(root, 'src', 'fastui_runtime.mjs'), 'utf8');
            expect(runtime).to.include('export const appState = createObservableStore()');
            expect(runtime).to.include('export function useFastUISelector');
            expect(runtime).to.include('useSyncExternalStore');
        });

        it('build path emits generated translation files for the default locale and Flutter relative imports', async function () {
            process.env.FASTUI_TEMPLATE = 'reactjs';
            const reactRoot = join(root, 'src', 'blueprints', 'modules');
            await mkdir(reactRoot, {recursive: true});
            await writeFile(join(reactRoot, 'translated_build.yml'), `component:
  base: text
  modifier:
    props:
      children: "logics.t('waist_collection', 'WAIST COLLECTION')"
`);
            await generateCodeFromSpecs({projectPath: root});
            const reactTranslations = await readFile(join(root, 'src', 'translations', 'generated.mjs'), 'utf8');
            const reactService = await readFile(join(root, 'src', 'services', 'translated_build.mjs'), 'utf8');
            expect(reactTranslations).to.include('const generatedTranslations = {');
            expect(reactTranslations).to.include('"default"');
            expect(reactTranslations).to.include('"waist_collection": "WAIST COLLECTION"');
            expect(reactTranslations).to.include('fastUITranslationStore = createFastUITranslationStore(');
            expect(reactTranslations).to.include('export function useFastUITranslation');
            expect(reactTranslations).not.to.include('defaultTranslationText');
            expect(reactService).to.include("import {fastUITranslationStore} from '../translations/generated.mjs';");

            process.env.FASTUI_TEMPLATE = 'flutter';
            const flutterRoot = join(root, 'lib', 'blueprints', 'modules');
            await mkdir(flutterRoot, {recursive: true});
            await writeFile(join(flutterRoot, 'translated_build.yml'), `component:
  base: text
  modifier:
    props:
      children: "logics.t('in_stores')"
`);
            await generateCodeFromSpecs({projectPath: root});
            const flutterTranslations = await readFile(join(root, 'lib', 'translations', 'generated.dart'), 'utf8');
            const flutterService = await readFile(join(root, 'lib', 'services', 'translated_build.dart'), 'utf8');
            expect(flutterTranslations).to.include('fastUITranslationsDefault');
            expect(flutterTranslations).not.to.include('"in_stores"');
            expect(flutterService).to.include("import '../fastui_runtime.dart';");
            expect(flutterService).to.include('fastUITranslationProvider');
            process.env.FASTUI_TEMPLATE = 'reactjs';
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
            const runtime = await readFile(join(root, 'src', 'fastui_runtime.mjs'), 'utf8');
            expect(runtime).to.include('BehaviorSubject');
            expect(runtime).to.include('useSyncExternalStore');
            expect(await readFile(join(root, 'index.html'), 'utf8')).to.include('data-fastui-fonts');
            expect(await readFile(join(root, 'public', 'fonts', 'figma', 'fastui-fonts.generated.css'), 'utf8')).to.equal('');
            expect(JSON.parse(await readFile(join(root, 'fastui.config.json'), 'utf8')).resources.fonts).to.deep.equal({});
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
                    frame: {base: 'column.start', current: {backgroundImage: 'url("asset://figma/background.png")'}}
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
                    frame: {base: 'row.start', current: {backgroundImage: 'url("asset://figma/condition.png")'}}
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
            expect(appRoute).to.include('surfacePresentations');
            expect(appRoute).to.include('data-fastui-surface');
            expect(appRoute).not.to.include("overflow: 'auto'");
            expect(appRoute).not.to.include("overflowY: 'auto'");

            await writeFile(join(root, 'src', 'routing_guard.mjs'), 'export async function beforeNavigate() { return {decision: "cancel"}; }\n');
            await ensureAppRouteFileExist({template: 'reactjs', initialId: 'home', pages});
            expect(await readFile(join(root, 'src', 'routing_guard.mjs'), 'utf8')).to.include('decision: "cancel"');
            process.env.FASTUI_TEMPLATE = 'flutter';
        });

        it('creates the React runtime when generating routing only', async function () {
            process.env.FASTUI_TEMPLATE = 'reactjs';
            await ensureAppRouteFileExist({template: 'reactjs', initialId: 'home', pages: [{id: 'home', name: 'home_page', module: 'home'}]});
            const runtime = await readFile(join(root, 'src', 'fastui_runtime.mjs'), 'utf8');
            expect(runtime).to.include('export const appState = createObservableStore()');
            expect(runtime).to.include('useSyncExternalStore');
            expect(await readFile(join(root, 'src', 'routing.mjs'), 'utf8')).to.include("import {appState} from './fastui_runtime.mjs';");
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

        it('rejects superseded spec aliases and composition fields', function () {
            expect(() => normalizeSpecDocument({app: {base: 'container', modifier: {}}}))
                .to.throw('Unsupported spec root alias');
            expect(() => normalizeSpecDocument({components: {base: 'container', modifier: {}}}))
                .to.throw('Unsupported spec root alias');
            expect(() => normalizeSpecDocument({component: {base: 'container', modifier: {ref: './child.yml'}}}))
                .to.throw('Unsupported ref composition field');
            expect(() => normalizeSpecDocument({component: {base: 'container', modifier: {frame: {base: 'row.start', styles: {}}}}}))
                .to.throw('Unsupported frame.styles');
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

        it('includes Retry-After details for Figma 429 responses', async function () {
            try {
                await fetchFigmaFile({
                    token: 'token', figFile: 'file', fresh: true,
                    fetcher: async () => {
                        const error = new Error('Too Many Requests');
                        error.response = {
                            status: 429,
                            data: {message: 'Too Many Requests'},
                            headers: {'retry-after': '229687'}
                        };
                        throw error;
                    }
                });
                expect.fail('expected fetchFigmaFile to throw');
            } catch (error) {
                expect(error.message).to.include('HTTP 429');
                expect(error.message).to.include('retry after 2d 15h 48m 7s');
                expect(error.message).to.include('Too Many Requests');
            }
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
            const spec = await readFile(join(srcPath, 'modules', 'presentation', 'pages', 'itoggle_Toggle_button.yml'), 'utf8');
            const widget = await readFile(join(root, 'lib', 'modules', 'presentation', 'pages', 'itoggle_toggle_button.dart'), 'utf8');
            expect(spec).to.include('variant: toggle');
            expect(spec).to.include('action: state.set');
            expect(widget).to.include('extends ConsumerStatefulWidget');
            expect(widget).to.include("_notifier.setField('variant', 'selected-variant')");
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
            expect(react).to.include('useFastUIControlledInput(value)');
            expect(react).to.include('componentStore.setField(resolvedInstanceId,"value",(event?.target?.value ?? event)');
            expect(react).not.to.include('defaultValue=');
            expect(react).not.to.include('useState');
            expect(react).not.to.include('logics/controlled_input');

            const flutterPath = join(root, 'lib', 'blueprints', 'modules', 'controlled_input.yml');
            process.env.FASTUI_TEMPLATE = 'flutter';
            await composeComponent({data, path: flutterPath, projectPath: root});
            const flutter = await readFile(join(root, 'lib', 'modules', 'controlled_input.dart'), 'utf8');
            expect(flutter).to.include('late final TextEditingController _controller');
            expect(flutter).to.include('TextEditingController(text: (ref.read(controlledInputProvider(_providerInstance)).value');
            expect(flutter).to.include('TextFormField(');
            expect(flutter).to.include('controller: _controller');
            expect(flutter).to.include('ref.listen<String>(');
            expect(flutter).to.include('if (_controller.text == next) return;');
            expect(flutter).to.include('_controller.value = _controller.value.copyWith(');
            expect(flutter).to.include('selection: TextSelection.collapsed(offset: offset)');
            expect(flutter).to.include("_notifier.setField('value', value)");
            expect(flutter).to.include('_controller.dispose()');
            expect(flutter).not.to.include('initialValue:');
            expect(flutter).not.to.include('setState(()');
        });

        it('updates React input stores before change services and keeps submit separate', async function () {
            process.env.FASTUI_TEMPLATE = 'reactjs';
            const specPath = join(root, 'src', 'blueprints', 'modules', 'profile_input.yml');
            await mkdir(dirname(specPath), {recursive: true});
            const data = {
                base: 'container',
                modifier: {
                    states: {value: 'Joshua'},
                    props: {
                        control: 'input',
                        multiline: true,
                        value: 'states.value',
                        onChange: 'services.profile_input_change',
                        onSubmit: 'services.profile_input_submit',
                        readOnly: false,
                        autofill: 'name',
                    },
                },
            };
            await composeComponent({data, path: specPath, projectPath: root});
            const generated = await readFile(join(root, 'src', 'modules', 'profile_input.jsx'), 'utf8');
            expect(generated).to.include('<textarea');
            expect(generated).to.include('value={value}');
            expect(generated).to.include('autoComplete={\'name\'}');
            expect(generated).to.include("if(event.key==='Enter')");
            const mutation = generated.indexOf('componentStore.setField');
            const change = generated.indexOf('profile_input_change(component.withArgs');
            expect(mutation).to.be.greaterThan(-1);
            expect(change).to.be.greaterThan(mutation);
            expect(generated.match(/profile_input_change\(component\.withArgs/g)).to.have.length(1);
            expect(generated.match(/profile_input_submit\(component\.withArgs/g)).to.have.length(1);
            expect(generated).not.to.include('defaultValue=');
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
            const reactStorePath = join(root, 'src', 'stores', 'account', 'stores.generated.mjs');
            const reactStore = await readFile(reactStorePath, 'utf8');
            const reactModels = await readFile(join(root, 'src', 'stores', 'account', 'models.generated.mjs'), 'utf8');
            expect(reactWidget).to.include("from '../../services/account/profile.mjs'");
            expect(reactWidget).to.include('createFastUIComponentContext');
            expect(reactWidget).to.include('profileStore');
            expect(reactStore).to.include('export const profileStore = createFastUIComponentStore');
            expect(reactStore).to.match(/"signedIn":\s*false/);
            expect(reactStore).to.include('setSignedIn: (state, value)');
            expect(await readFile(join(root, 'src', 'fastui_runtime.mjs'), 'utf8')).to.include("const setterName = 'set' + String(key)");
            expect(reactModels).to.include('@typedef {Object} ProfileStateModel');
            expect(reactModels).to.include('@property {boolean} signedIn');
            expect(reactWidget).not.to.include('signedIn:false');
            expect(await readFile(reactService, 'utf8')).to.equal('export function validateProfile() { return "implemented"; }\n');
            await writeFile(reactStorePath, `${reactStore}\nexport const userControlled = true;\n`);
            await generateCodeFromSpecs({root: join(root, 'src', 'blueprints'), projectPath: root});
            expect(await readFile(reactStorePath, 'utf8')).not.to.include('export const userControlled = true;');

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
            const flutterStorePath = join(root, 'lib', 'stores', 'account', 'providers.generated.dart');
            const flutterStore = await readFile(flutterStorePath, 'utf8');
            const flutterModels = await readFile(join(root, 'lib', 'stores', 'account', 'models.generated.dart'), 'utf8');
            expect(flutterWidget).to.include("import '../../services/account/profile.dart';");
            expect(flutterWidget).to.include('ref.watch(profileProvider(_providerInstance))');
            expect(flutterWidget).to.include("'signedIn': (value) => notifier.setSignedIn(value as bool?)");
            expect(flutterWidget).not.to.include('setState: notifier.setField');
            expect(flutterWidget).to.match(/FastUIProviderInstance<FastUIProfileStateModel>\(\s*id: widget\.instanceId \?\? 'account\/profile'/);
            expect(flutterStore).to.include('class FastUIProfileNotifier extends AutoDisposeFamilyNotifier');
            expect(flutterStore).to.include('final profileProvider = NotifierProvider.autoDispose.family');
            expect(flutterStore).to.include('void setSignedIn(bool? value)');
            expect(flutterStore).to.include('void setField(String key, dynamic value)');
            expect(flutterModels).to.include('class FastUIProfileStateModel');
            expect(flutterModels).to.include('final bool? signedIn');
            expect(flutterWidget).not.to.include('FastUIModuleStore');
            expect(flutterWidget).not.to.include('_publishState');
            await writeFile(flutterStorePath, `${flutterStore}\nconst userControlled = true;\n`);
            await generateCodeFromSpecs({root: join(root, 'lib', 'blueprints'), projectPath: root});
            expect(await readFile(flutterStorePath, 'utf8')).not.to.include('const userControlled = true;');
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

        it('renders a React spec-file base as direct component reuse', async function () {
            process.env.FASTUI_TEMPLATE = 'reactjs';
            const sharedRoot = join(root, 'src', 'blueprints', 'shared', 'common');
            const moduleRoot = join(root, 'src', 'blueprints', 'modules', 'example');
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
            const labelPath = join(moduleRoot, 'label.yml');
            await writeFile(labelPath, `component:
  base: ../../shared/common/text.yml
  modifier:
    styles:
      color: '#0000FF'
    states:
      value: Label
`);
            const resolved = await specToJSON(labelPath);
            expect(resolved.component.base).to.equal('../../shared/common/text.yml');
            expect(resolved.component.modifier.styles).to.deep.equal({color: '#0000FF'});
            expect(resolved.component.modifier.states).to.deep.equal({value: 'Label'});
            expect(resolved.component.modifier).not.to.have.property('ref');
            await composeComponent({data: resolved.component, path: labelPath, projectPath: root});
            const generated = await readFile(join(root, 'src', 'modules', 'example', 'label.jsx'), 'utf8');
            expect(generated).to.include("import {Text} from '../../shared/common/text.jsx';");
            expect(generated).to.include('"color":"#0000FF"');
            expect(generated).not.to.include('overrideStyles');
            expect(generated).not.to.include('__specBase');
            process.env.FASTUI_TEMPLATE = 'flutter';
        });

        it('preserves manually authored React reuse references', async function () {
            const sharedRoot = join(root, 'src', 'blueprints', 'shared', 'common');
            const moduleRoot = join(root, 'src', 'blueprints', 'modules', 'feature');
            await mkdir(sharedRoot, {recursive: true});
            await mkdir(moduleRoot, {recursive: true});
            await writeFile(join(sharedRoot, 'group.yml'), `component:
  base: container
  modifier:
    extend:
      - ./leaf_one.yml
      - ./leaf_two.yml
`);
            const localPath = join(moduleRoot, 'local_group.yml');
            await writeFile(localPath, `component:
  base: ../../shared/common/group.yml
  modifier: {}
`);
            const resolved = await specToJSON(localPath);
            expect(resolved.component.base).to.equal('../../shared/common/group.yml');
            expect(resolved.component.modifier.extend).to.be.undefined;
        });

        it('passes materialized child slots into a reused React component', async function () {
            process.env.FASTUI_TEMPLATE = 'reactjs';
            const moduleRoot = join(root, 'src', 'blueprints', 'modules', 'slots');
            await mkdir(moduleRoot, {recursive: true});
            const sharedChildPath = join(moduleRoot, 'shared_child.yml');
            const localChildPath = join(moduleRoot, 'local_child.yml');
            const basePath = join(moduleRoot, 'base_header.yml');
            const instancePath = join(moduleRoot, 'header_instance.yml');
            await writeFile(sharedChildPath, 'component:\n  base: text\n  modifier:\n    props:\n      children: Shared\n');
            await writeFile(localChildPath, 'component:\n  base: text\n  modifier:\n    props:\n      children: Instance\n');
            await writeFile(basePath, 'component:\n  base: container\n  modifier:\n    extend: ./shared_child.yml\n    frame:\n      base: column.start\n');
            await writeFile(instancePath, `component:
  base: ./base_header.yml
  modifier:
    overrides:
      children:
        '0': ./local_child.yml
`);
            for (const specPath of [sharedChildPath, localChildPath, basePath, instancePath]) {
                await composeComponent({data: (await specToJSON(specPath)).component, path: specPath, projectPath: root});
            }
            const baseGenerated = await readFile(join(root, 'src', 'modules', 'slots', 'base_header.jsx'), 'utf8');
            const instanceGenerated = await readFile(join(root, 'src', 'modules', 'slots', 'header_instance.jsx'), 'utf8');
            expect(baseGenerated).to.include('componentOverrides?.children?.[0]');
            expect(instanceGenerated).to.include("import {BaseHeader} from './base_header.jsx';");
            expect(instanceGenerated).to.include("import {LocalChild} from './local_child.jsx';");
            expect(instanceGenerated).to.include('children:{...(componentOverrides.children??{}),"0":<LocalChild');
            const bundle = await buildJavaScript({
                entryPoints: [join(root, 'src', 'modules', 'slots', 'header_instance.jsx')],
                bundle: true,
                write: false,
                format: 'esm',
                platform: 'browser',
                external: ['react'],
                logLevel: 'silent',
            });
            expect(bundle.outputFiles[0].text).to.include('HeaderInstance');
            process.env.FASTUI_TEMPLATE = 'flutter';
        });

        it('keeps a cross-primitive React base as a reuse reference', async function () {
            const sharedRoot = join(root, 'src', 'blueprints', 'shared', 'common');
            const moduleRoot = join(root, 'src', 'blueprints', 'modules', 'feature');
            await mkdir(sharedRoot, {recursive: true});
            await mkdir(moduleRoot, {recursive: true});
            await writeFile(join(sharedRoot, 'remember_condition.yml'), `condition:
  modifier:
    left: ./remembered.yml
    right: ./forgotten.yml
    states:
      condition: false
`);
            const instancePath = join(moduleRoot, 'table_checkbox.yml');
            await writeFile(instancePath, `component:
  base: ../../shared/common/remember_condition.yml
  modifier:
    extend: ./selected_icon.yml
    props:
      id: table-checkbox
`);
            const resolved = await specToJSON(instancePath);
            expect(resolved.component.base).to.equal('../../shared/common/remember_condition.yml');
            expect(resolved.component.modifier.extend).to.equal('./selected_icon.yml');
            expect(resolved.component.modifier.props.id).to.equal('table-checkbox');
        });

        it('keeps nested Flutter spec-file bases as direct reuse references', async function () {
            const sharedRoot = join(root, 'flutter-inheritance', 'shared', 'common');
            const moduleRoot = join(root, 'flutter-inheritance', 'modules', 'feature');
            await mkdir(sharedRoot, {recursive: true});
            await mkdir(moduleRoot, {recursive: true});
            await writeFile(join(sharedRoot, 'base.yml'), `component:
  base: container
  modifier:
    styles:
      width: 120
      backgroundColor: '#111111'
    props:
      id: inherited-id
    states:
      inherited: true
    extend:
      - ./base_child.yml
      - ./second_child.yml
`);
            await writeFile(join(sharedRoot, 'middle.yml'), `component:
  base: ./base.yml
  modifier:
    styles:
      backgroundColor: '#222222'
    states:
      middle: true
`);
            const inheritedPath = join(moduleRoot, 'inherited.yml');
            await writeFile(inheritedPath, `component:
  base: ../../shared/common/middle.yml
  modifier:
    styles:
      height: 48
    states:
      local: true
`);
            const inherited = (await specToFlutterJSON(inheritedPath)).component;
            expect(inherited.base).to.equal('../../shared/common/middle.yml');
            expect(inherited.modifier.styles).to.deep.equal({height: 48});
            expect(inherited.modifier.states).to.deep.equal({local: true});

            await writeFile(inheritedPath, `component:
  base: ../../shared/common/middle.yml
  modifier:
    extend:
      - ./local_child.yml
`);
            const replaced = (await specToFlutterJSON(inheritedPath)).component;
            expect(replaced.modifier.extend).to.deep.equal(['./local_child.yml']);
        });

        it('does not recursively resolve Flutter reusable-base chains', async function () {
            const moduleRoot = join(root, 'flutter-inheritance-cycle');
            await mkdir(moduleRoot, {recursive: true});
            const first = join(moduleRoot, 'first.yml');
            const second = join(moduleRoot, 'second.yml');
            await writeFile(first, 'component:\n  base: ./second.yml\n  modifier: {}\n');
            await writeFile(second, 'component:\n  base: ./first.yml\n  modifier: {}\n');
            expect((await specToFlutterJSON(first)).component.base).to.equal('./second.yml');
        });

        it('does not recursively resolve React reusable-base chains', async function () {
            process.env.FASTUI_TEMPLATE = 'reactjs';
            const moduleRoot = join(root, 'react-inheritance-cycle');
            await mkdir(moduleRoot, {recursive: true});
            const first = join(moduleRoot, 'first.yml');
            const second = join(moduleRoot, 'second.yml');
            await writeFile(first, 'component:\n  base: ./second.yml\n  modifier: {}\n');
            await writeFile(second, 'component:\n  base: ./first.yml\n  modifier: {}\n');
            expect((await specToJSON(first)).component.base).to.equal('./second.yml');
            process.env.FASTUI_TEMPLATE = 'flutter';
        });

        it('merges React component styles, props, and states at generation time', async function () {
            process.env.FASTUI_TEMPLATE = 'reactjs';
            const moduleRoot = join(root, 'src', 'blueprints', 'modules', 'overrides');
            await mkdir(moduleRoot, {recursive: true});
            // Base component: has its own styles, props (id), and a state
            const basePath = join(moduleRoot, 'base_card.yml');
            await writeFile(basePath, `component:
  base: container
  modifier:
    styles:
      background: grey
      width: 200px
    props:
      id: base-card
    states:
      label: Base label
`);
            await composeComponent({data: (await specToJSON(basePath)).component, path: basePath, projectPath: root});
            const baseGenerated = await readFile(join(root, 'src', 'modules', 'overrides', 'base_card.jsx'), 'utf8');
            expect(baseGenerated).to.include('"background":"grey"');
            expect(baseGenerated).to.include('{...initialProps}');
            expect(baseGenerated).not.to.include('overrideStyles');
            expect(baseGenerated).not.to.include('Base label');
            const wrapperPath = join(moduleRoot, 'card_variant.yml');
            await writeFile(wrapperPath, `component:
  base: ./base_card.yml
  modifier:
    styles:
      background: '#f7f7f7'
    props:
      id: card-variant
    states:
      label: Variant label
`);
            await composeComponent({data: (await specToJSON(wrapperPath)).component, path: wrapperPath, projectPath: root});
            const wrapperGenerated = await readFile(join(root, 'src', 'modules', 'overrides', 'card_variant.jsx'), 'utf8');
            expect(wrapperGenerated).to.include("import {BaseCard} from './base_card.jsx';");
            expect(wrapperGenerated).to.include('"background":"#f7f7f7"');
            expect(wrapperGenerated).to.include('card-variant');
            expect(wrapperGenerated).to.include('Variant label');
            expect(wrapperGenerated).not.to.include('overrideStates');
            process.env.FASTUI_TEMPLATE = 'flutter';
        });

        it('keeps Flutter extended-component state defaults in generated providers', async function () {
            process.env.FASTUI_TEMPLATE = 'flutter';
            const moduleRoot = join(root, 'lib', 'blueprints', 'modules', 'overrides');
            await mkdir(moduleRoot, {recursive: true});
            await writeFile(join(moduleRoot, 'base_card.yml'), `component:
  base: text
  modifier:
    states:
      label: Base label
    props:
      children: states.label
`);
            await writeFile(join(moduleRoot, 'card_variant.yml'), `component:
  base: ./base_card.yml
  modifier:
    states:
      label: Variant label
`);
            await generateCodeFromSpecs({root: join(root, 'lib', 'blueprints'), projectPath: root});
            const wrapper = await readFile(join(root, 'lib', 'modules', 'overrides', 'card_variant.dart'), 'utf8');
            const providers = await readFile(join(root, 'lib', 'stores', 'overrides', 'providers.generated.dart'), 'utf8');
            expect(wrapper).to.include("import './base_card.dart';");
            expect(wrapper).to.include('BaseCard(');
            expect(wrapper).to.include('BaseCard.fastUIWidthMode');
            expect(wrapper).to.include('BaseCard.fastUIFixedWidth');
            expect(wrapper).not.to.include('overrideStyles');
            expect(wrapper).not.to.include('_buildWithOverride');
            expect(wrapper).to.include('Variant label');
            expect(providers).to.include('fastUICardVariantStateDefaults');
        });

        it('composes multiple extend children in frame.base order for React', async function () {
            process.env.FASTUI_TEMPLATE = 'reactjs';
            const moduleRoot = join(root, 'src', 'blueprints', 'modules');
            await mkdir(moduleRoot, {recursive: true});
            await composeComponent({path: join(moduleRoot, 'child_a.yml'), projectPath: root, data: {base: 'container', modifier: {}}});
            await composeComponent({path: join(moduleRoot, 'child_b.yml'), projectPath: root, data: {base: 'container', modifier: {}}});
            const startPath = join(moduleRoot, 'composer_start.yml');
            const endPath = join(moduleRoot, 'composer_end.yml');
            const stackPath = join(moduleRoot, 'composer_stack.yml');
            await composeComponent({path: startPath, projectPath: root, data: {
                base: 'text',
                modifier: {extend: ['./child_a.yml', './child_b.yml'], props: {children: 'ParentMarker'}, frame: {base: 'row.start'}}
            }});
            await composeComponent({path: endPath, projectPath: root, data: {
                base: 'text',
                modifier: {extend: ['./child_a.yml', './child_b.yml'], props: {children: 'ParentMarker'}, frame: {base: 'row.end'}}
            }});
            await composeComponent({path: stackPath, projectPath: root, data: {
                base: 'text',
                modifier: {extend: ['./child_a.yml', './child_b.yml'], props: {children: 'ParentMarker'}, frame: {base: 'row.start.stack'}}
            }});
            const start = await readFile(join(root, 'src', 'modules', 'composer_start.jsx'), 'utf8');
            const end = await readFile(join(root, 'src', 'modules', 'composer_end.jsx'), 'utf8');
            const stack = await readFile(join(root, 'src', 'modules', 'composer_stack.jsx'), 'utf8');
            expect(start).to.include("import {ChildA} from './child_a.jsx';");
            expect(start).to.include("import {ChildB} from './child_b.jsx';");
            expect(start.indexOf('ParentMarker')).to.be.lessThan(start.indexOf('<ChildA'));
            expect(start.indexOf('<ChildA')).to.be.lessThan(start.indexOf('<ChildB'));
            expect(end.indexOf('<ChildA')).to.be.lessThan(end.indexOf('<ChildB'));
            expect(end.indexOf('<ChildB')).to.be.lessThan(end.indexOf('ParentMarker'));
            expect(stack).to.include('"display":"grid"');
            expect(stack).not.to.include('"flex":1');
            expect(stack).to.include("style={{gridArea:'1 / 1'}}");
            process.env.FASTUI_TEMPLATE = 'flutter';
        });

        it('composes multiple extend children in frame.base order for Flutter', async function () {
            const moduleRoot = join(root, 'lib', 'blueprints', 'modules');
            await composeComponent({path: join(moduleRoot, 'child_a.yml'), projectPath: root, data: {base: 'container', modifier: {}}});
            await composeComponent({path: join(moduleRoot, 'child_b.yml'), projectPath: root, data: {base: 'container', modifier: {}}});
            const startPath = join(moduleRoot, 'composer_start.yml');
            const stackPath = join(moduleRoot, 'composer_stack.yml');
            await composeComponent({path: startPath, projectPath: root, data: {
                base: 'text',
                modifier: {extend: ['./child_a.yml', './child_b.yml'], props: {children: 'ParentMarker'}, frame: {base: 'column.end'}}
            }});
            await composeComponent({path: stackPath, projectPath: root, data: {
                base: 'text',
                modifier: {extend: ['./child_a.yml', './child_b.yml'], props: {children: 'ParentMarker'}, frame: {base: 'column.start.stack'}}
            }});
            const start = await readFile(join(root, 'lib', 'modules', 'composer_start.dart'), 'utf8');
            const stack = await readFile(join(root, 'lib', 'modules', 'composer_stack.dart'), 'utf8');
            expect(start).to.include("import './child_a.dart';");
            expect(start).to.include("import './child_b.dart';");
            expect(start.indexOf('ChildA(')).to.be.lessThan(start.indexOf('ChildB('));
            expect(start.indexOf('ChildB(')).to.be.lessThan(start.indexOf("'ParentMarker'"));
            expect(stack).to.match(/Stack\(\s*children:/);
        });

        it('keeps fixed-size Flutter children loose inside expanded frame wrappers', async function () {
            const moduleRoot = join(root, 'lib', 'blueprints', 'modules');
            await composeComponent({path: join(moduleRoot, 'fixed_child.yml'), projectPath: root, data: {
                base: 'text',
                modifier: {props: {children: 'Fixed'}, styles: {width: 200, height: 50}, frame: {base: 'row.start'}}
            }});
            const composerPath = join(moduleRoot, 'flex_composer.yml');
            await composeComponent({path: composerPath, projectPath: root, data: {
                base: 'container',
                modifier: {extend: ['./fixed_child.yml'], frame: {base: 'row.start', next: {flex: 1, background: '#f5f5f5'}}}
            }});
            const generated = await readFile(join(root, 'lib', 'modules', 'flex_composer.dart'), 'utf8');
            expect(generated).to.match(/Expanded\(\s*child:\s*Container\([\s\S]*Color\(0xFFF5F5F5\)[\s\S]*Alignment\.topLeft/);
        });

        it('translates a plain Figma frame into a container composer with ordered extend children', async function () {
            const document = {children: [{
                id: 'page', name: 'demo_page', type: 'FRAME', visible: true, layoutMode: 'VERTICAL',
                children: [{
                    id: 'group', name: 'Group', type: 'FRAME', layoutMode: 'VERTICAL', children: [
                        {id: 'a', name: 'A_text', type: 'TEXT', characters: 'A'},
                        {id: 'b', name: 'B_text', type: 'TEXT', characters: 'B'},
                        {id: 'c', name: 'C_text', type: 'TEXT', characters: 'C'},
                    ]
                }]
            }]};
            const srcPath = join(root, 'lib', 'blueprints');
            const children = await getPagesAndTraverseChildren({document, srcPath});
            await walkFrameChildren({children, srcPath});
            const groupSpec = await readFile(join(srcPath, 'modules', 'presentation', 'pages', 'igroup_Group.yml'), 'utf8');
            expect(groupSpec).to.include('component:');
            expect(groupSpec).not.to.include('condition:');
            expect(groupSpec).to.include('extend:');
            expect(groupSpec).to.include('./ia_A_text.yml');
            expect(groupSpec).to.include('./ib_B_text.yml');
            expect(groupSpec).to.include('./ic_C_text.yml');
            const orderA = groupSpec.indexOf('./ia_A_text.yml');
            const orderB = groupSpec.indexOf('./ib_B_text.yml');
            const orderC = groupSpec.indexOf('./ic_C_text.yml');
            expect(orderA).to.be.lessThan(orderB);
            expect(orderB).to.be.lessThan(orderC);
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
                pages: children.map(page => ({
                    name: page.name,
                    module: page.module,
                    id: page.id,
                    presentation: page.surfacePresentation,
                }))
            });
            await generateCodeFromSpecs({root: srcPath, projectPath: root});

            const openSpec = await readFile(join(srcPath, 'modules', 'presentation', 'pages', 'iopen_Open_button.yml'), 'utf8');
            const openWidget = await readFile(join(root, 'lib', 'modules', 'presentation', 'pages', 'iopen_open_button.dart'), 'utf8');
            const appRoute = await readFile(join(root, 'lib', 'app_route.dart'), 'utf8');
            const runtime = await readFile(join(root, 'lib', 'fastui_runtime.dart'), 'utf8');
            const guard = await readFile(join(root, 'lib', 'routing_guard.dart'), 'utf8');
            const instanceSpec = await readFile(join(srcPath, 'modules', 'presentation', 'pages', 'ilabel_Primary_label.yml'), 'utf8');
            const instanceWidget = await readFile(join(root, 'lib', 'modules', 'presentation', 'pages', 'ilabel_primary_label.dart'), 'utf8');
            const sharedSpec = await readFile(join(srcPath, 'modules', 'shared', 'common', 'ishared_text_Label.yml'), 'utf8');
            const sheetSpec = await readFile(join(srcPath, 'modules', 'presentation', 'pages', 'choices_sheet.yml'), 'utf8');
            expect(openSpec).to.include('action: navigation.open');
            expect(openSpec).to.include('type: sheet');
            expect(openSpec).not.to.include('onStart');
            expect(openWidget).to.match(/FastUINavigation\.navigate\(\s*context,\s*name: 'choices',\s*type: 'sheet'/);
            expect(openWidget).to.include("transition: 'MOVE_IN'");
            expect(openWidget).to.include("direction: 'BOTTOM'");
            expect(openWidget).to.include('durationMs: 250');
            expect(openWidget).to.include('barrierDismissible: true');
            expect(openWidget).to.include('extends StatelessWidget');
            expect(openSpec).to.match(/width:\s+100%/);
            expect(appRoute).to.include("'choices': FastUISurfaceDefinition(");
            expect(appRoute).to.include('builder: () => ChoicesSheet()');
            expect(appRoute).to.include("type: 'sheet'");
            expect(appRoute).to.include('presentation: FastUISurfacePresentation(');
            expect(appRoute).to.include('MaterialApp.router');
            expect(appRoute).to.include('guard: beforeNavigate');
            expect(runtime).to.include('showModalBottomSheet<T>');
            expect(runtime).to.include('showGeneralDialog<T>');
            expect(runtime).to.include('FastUINavigationDecisionType');
            expect(runtime).to.include('Future<bool> popRoute()');
            expect(runtime).to.include('ValueNotifier<FastUIRouteRef?> currentRoute');
            expect(runtime).to.include('Material(type: MaterialType.transparency');
            expect(runtime).to.include('child: FastUINavigation.surface(name)');
            expect(runtime).not.to.include('FastUIScrollableSurface');
            expect(runtime).to.include('presentation.safeArea');
            expect(runtime).to.include('presentation.barrierColor');
            expect(runtime).to.include('SvgPicture.asset');
            expect(runtime).to.include('return Icons.arrow_back');
            expect(runtime).to.include('return Icons.arrow_forward');
            expect(runtime).to.include('return Icons.info_outline');
            expect(runtime).to.include('errorBuilder: (_, __, ___) => _assetFallback()');
            expect(guard).to.include('Future<FastUINavigationDecision> beforeNavigate');
            expect(instanceSpec).to.include('base: ../../shared/common/ishared_text_Label.yml');
            expect(instanceSpec).not.to.include('extend: ./ilabel_copy_Copy_text.yml');
            expect(instanceSpec).to.include('overrides:');
            expect(instanceSpec).to.include("'0': ./ilabel_copy_Copy_text.yml");
            expect(instanceSpec).not.to.include('ref:');
            expect(instanceSpec).not.to.include('compose:');
            expect(instanceWidget).to.include('ishared_text_label.dart');
            expect(instanceWidget).to.include('IsharedTextLabel(');
            expect(instanceWidget).to.include('childOverrides: <int, Widget>');
            expect(instanceWidget).to.include('0: IlabelCopyCopyText(');
            expect(sharedSpec).to.include('component:');
            expect(sharedSpec).not.to.include('onStart');
            expect(sheetSpec).to.include('surface:');
            expect(sheetSpec).to.include('mode: overlay');
            expect(sheetSpec).to.include('scroll: none');
            const resolvedInstance = await specToJSON(join(srcPath, 'modules', 'presentation', 'pages', 'ilabel_Primary_label.yml'));
            expect(resolvedInstance.component).not.to.have.property('__specBase');
            expect(resolvedInstance.component.base).to.equal('../../shared/common/ishared_text_Label.yml');
            expect(resolvedInstance.component.modifier).not.to.have.property('ref');
            expect(resolvedInstance.component.modifier.overrides.children['0']).to.equal('./ilabel_copy_Copy_text.yml');
        });
    });
});

describe('React observable runtime', function () {
    let runtime;
    const runtimePath = resolve('test', 'fastui_runtime.behavior.generated.mjs');

    before(async function () {
        await writeFile(runtimePath, reactRuntimeSource());
        runtime = await import(`${pathToFileURL(runtimePath).href}?test=${Date.now()}`);
    });

    after(async function () {
        await rm(runtimePath, {force: true});
    });

    it('isolates instances and skips renders for unrelated selected fields', async function () {
        const store = runtime.createFastUIComponentStore({
            componentId: 'profile/name',
            fields: ['name', 'visits'],
            createInitialState: () => ({name: 'Joshua', visits: 0}),
            setters: {
                setName: (state, name) => ({...state, name}),
                setVisits: (state, visits) => ({...state, visits}),
            },
        });
        let renders = 0;
        function Name({instanceId}) {
            const name = runtime.useFastUISelector(store, instanceId, state => state.name);
            renders += 1;
            return React.createElement('span', null, name);
        }
        let view;
        await act(async () => {
            view = TestRenderer.create(React.createElement(Name, {instanceId: 'first'}));
        });
        expect(view.toJSON().children).to.deep.equal(['Joshua']);
        const initialRenders = renders;
        await act(async () => store.setVisits('first', 1));
        expect(renders).to.equal(initialRenders);
        const context = runtime.createFastUIComponentContext({store, componentId: 'profile/name', instanceId: 'first'});
        await act(async () => context.setState('name', 'Amina'));
        expect(view.toJSON().children).to.deep.equal(['Amina']);
        expect(store.get('second').name).to.equal('Joshua');
        expect(store.get('second').visits).to.equal(0);
        await act(async () => view.unmount());
        await delay(5);
        expect(store.has('first')).to.equal(false);
    });

    it('retains initialization across a Strict Mode remount and disposes afterward', async function () {
        const store = runtime.createFastUIComponentStore({
            componentId: 'profile/name',
            fields: ['name'],
            createInitialState: () => ({name: 'Joshua'}),
        });
        let initializations = 0;
        function Profile() {
            runtime.useFastUISelector(store, 'shared', state => state.name);
            React.useEffect(() => {
                store.initialize('shared', async () => {
                    initializations += 1;
                    await Promise.resolve();
                });
            }, []);
            return React.createElement('span');
        }
        const element = React.createElement(React.StrictMode, null, React.createElement(Profile));
        let first;
        await act(async () => { first = TestRenderer.create(element); });
        await act(async () => first.unmount());
        let second;
        await act(async () => { second = TestRenderer.create(element); });
        expect(initializations).to.equal(1);
        await act(async () => second.unmount());
        await delay(5);
        expect(store.has('shared')).to.equal(false);
    });

    it('uses the first mounted seed when explicit instance IDs share state', async function () {
        const store = runtime.createFastUIComponentStore({
            componentId: 'shared/name',
            fields: ['name'],
            createInitialState: () => ({name: 'Default'}),
        });
        const values = [];
        function Shared({initialState}) {
            const name = runtime.useFastUISelector(store, 'same', state => state.name, {initialState});
            values.push(name);
            return React.createElement('span', null, name);
        }
        let view;
        await act(async () => {
            view = TestRenderer.create(React.createElement(React.Fragment, null,
                React.createElement(Shared, {initialState: {name: 'First'}}),
                React.createElement(Shared, {initialState: {name: 'Second'}}),
            ));
        });
        expect(view.toJSON().map(node => node.children[0])).to.deep.equal(['First', 'First']);
        expect(store.get('same').name).to.equal('First');
        await act(async () => view.unmount());
        await delay(5);
    });

    it('reacts to locale/catalog changes and falls back to the exact key', async function () {
        const store = runtime.createFastUITranslationStore({welcome: 'Welcome {name}'});
        let renders = 0;
        function Copy() {
            const value = runtime.useFastUITranslationValue(store, 'welcome', {name: 'Joshua'});
            renders += 1;
            return React.createElement('span', null, value);
        }
        let view;
        await act(async () => { view = TestRenderer.create(React.createElement(Copy)); });
        expect(view.toJSON().children).to.deep.equal(['Welcome Joshua']);
        store.setLocale('sw');
        expect(store.translate('missing_key')).to.equal('missing_key');
        await act(async () => store.load('sw', {welcome: 'Karibu {name}'}));
        expect(view.toJSON().children).to.deep.equal(['Karibu Joshua']);
        expect(renders).to.be.greaterThan(1);
        await act(async () => view.unmount());
    });
});

describe('Figma resource reconciliation', function () {
    let root;

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), 'fastui-resources-'));
    });

    afterEach(async () => {
        await rm(root, {recursive: true, force: true});
    });

    it('discovers and deduplicates image, vector, and mixed text font variants', function () {
        const resources = discoverFigmaResources({children: [{
            id: 'frame', name: 'Frame', fills: [{type: 'IMAGE', imageRef: 'same-image'}], children: [
                {id: 'image', name: 'Image', fills: [{type: 'IMAGE', imageRef: 'same-image'}]},
                {id: 'vector', name: 'Arrow Icon', type: 'VECTOR'},
                {
                    id: 'text', name: 'Title', type: 'TEXT',
                    style: {fontFamily: 'Inter', fontWeight: 400},
                    styleOverrideTable: {
                        bold: {fontFamily: 'Inter', fontWeight: 700, fontPostScriptName: 'Inter-BoldItalic'},
                    },
                },
            ],
        }]});
        expect(resources.images).to.have.length(1);
        expect(resources.images[0].nodes).to.have.length(2);
        expect(resources.vectors).to.deep.include({kind: 'vector', nodeId: 'vector', name: 'Arrow_Icon_vector', format: 'svg', nodes: [{id: 'vector', name: 'Arrow Icon'}]});
        expect(resources.fonts.map(font => `${font.family}|${font.weight}|${font.style}`)).to.deep.equal([
            'Inter|400|normal',
            'Inter|700|italic',
        ]);
    });

    it('reconciles verified resources and merges manifest-owned Flutter fonts and assets', async function () {
        await mkdir(join(root, 'design', 'fonts'), {recursive: true});
        await writeFile(join(root, 'design', 'fonts', 'Brand-Regular.ttf'), Buffer.from('regular-font'));
        await writeFile(join(root, 'fastui.config.json'), JSON.stringify({resources: {fonts: {
            'Brand Sans': {files: [
                {path: 'design/fonts/Brand-Regular.ttf', weight: 400, style: 'normal'},
                {url: 'https://assets.test/brand-italic.woff2', weight: 400, style: 'italic'},
            ]},
        }}}));
        await writeFile(join(root, 'pubspec.yaml'), `name: resource_fixture
flutter:
  uses-material-design: true
  fonts:
    - family: User Font
      fonts:
        - asset: assets/fonts/user.ttf
          weight: 500
`);
        const document = {children: [
            {id: 'image-node', name: 'Photo', fills: [{type: 'IMAGE', imageRef: 'image-ref'}]},
            {id: '2:2', name: 'Arrow Icon', type: 'VECTOR'},
            {id: 'regular', name: 'Regular', type: 'TEXT', style: {fontFamily: 'Brand Sans', fontWeight: 400}},
            {id: 'italic', name: 'Italic', type: 'TEXT', style: {fontFamily: 'Brand Sans', fontWeight: 400, italic: true}},
        ]};
        let downloadAttempts = 0;
        const http = {get: async url => {
            if (url.includes('/files/file-key/images')) return {data: {meta: {images: {'image-ref': 'https://assets.test/photo'}}}};
            if (url.includes('/v1/images/file-key?')) return {data: {images: {'2:2': 'https://assets.test/arrow'}}};
            downloadAttempts++;
            if (url.endsWith('/photo')) return {data: Buffer.from('png-data'), headers: {'content-type': 'image/png', 'content-length': '8'}};
            if (url.endsWith('/arrow')) return {data: Buffer.from('<svg/>'), headers: {'content-type': 'image/svg+xml', 'content-length': '6'}};
            if (url.endsWith('.woff2')) return {data: Buffer.from('woff2-font'), headers: {'content-type': 'font/woff2', 'content-length': '10'}};
            throw new Error(`Unexpected URL ${url}`);
        }};
        const first = await reconcileFigmaResources({
            document, token: 'token', figFile: 'file-key', projectPath: root,
            template: 'flutter', fresh: true, http, sleepFn: async () => {},
        });
        expect(first.summary).to.include({discovered: 4, downloaded: 3, unresolved: 0});
        expect(downloadAttempts).to.equal(3);
        await stat(join(root, '.fastui', 'assets', 'figma', 'images', 'image-ref.png'));
        await stat(join(root, '.fastui', 'assets', 'figma', 'vectors', 'Arrow_Icon_2_2.svg'));
        await stat(join(root, 'assets', 'images', 'figma', 'image-ref.png'));
        await stat(join(root, 'assets', 'images', 'figma', 'Arrow_Icon_2_2.svg'));
        const pubspec = yaml.load(await readFile(join(root, 'pubspec.yaml'), 'utf8'));
        expect(pubspec.flutter.fonts.find(font => font.family === 'User Font').fonts[0]).to.deep.equal({asset: 'assets/fonts/user.ttf', weight: 500});
        expect(pubspec.flutter.fonts.find(font => font.family === 'Brand Sans').fonts).to.deep.equal([
            {asset: 'assets/fonts/figma/Brand_Sans-400-normal.ttf', weight: 400},
            {asset: 'assets/fonts/figma/Brand_Sans-400-italic.woff2', weight: 400, style: 'italic'},
        ]);
        const report = JSON.parse(await readFile(first.reportPath, 'utf8'));
        expect(report.unresolved).to.deep.equal([]);

        let unexpectedCalls = 0;
        const cached = await reconcileFigmaResources({
            document, token: 'token', figFile: 'file-key', projectPath: root,
            template: 'flutter', fresh: false,
            http: {get: async () => { unexpectedCalls++; throw new Error('cache should avoid network'); }},
        });
        expect(unexpectedCalls).to.equal(0);
        expect(cached.summary.cached).to.equal(4);

        const stale = await reconcileFigmaResources({document: {children: []}, figFile: 'file-key', projectPath: root, template: 'flutter'});
        expect(stale.summary.stale).to.equal(4);
        const cleanedPubspec = yaml.load(await readFile(join(root, 'pubspec.yaml'), 'utf8'));
        expect(cleanedPubspec.flutter.fonts.map(font => font.family)).to.deep.equal(['User Font']);
        let generatedFontExists = true;
        try { await stat(join(root, 'assets', 'fonts', 'figma', 'Brand_Sans-400-normal.ttf')); } catch (_) { generatedFontExists = false; }
        expect(generatedFontExists).to.equal(false);
    });

    it('retries transient downloads and preserves verified cache after a failed fresh refresh', async function () {
        const document = {children: [{id: 'photo', name: 'Photo', fills: [{type: 'IMAGE', imageRef: 'retry-image'}]}]};
        let attempts = 0;
        const firstHttp = {get: async url => {
            if (url.includes('/files/file/images')) return {data: {meta: {images: {'retry-image': 'https://assets.test/retry.png'}}}};
            attempts++;
            if (attempts < 3) {
                const error = new Error('temporary');
                error.response = {status: 503, headers: {'retry-after': '0'}};
                throw error;
            }
            return {data: Buffer.from('verified'), headers: {'content-type': 'image/png', 'content-length': '8'}};
        }};
        const first = await reconcileFigmaResources({
            document, token: 'token', figFile: 'file', projectPath: root, template: 'reactjs', fresh: true,
            http: firstHttp, sleepFn: async () => {},
        });
        expect(attempts).to.equal(3);
        expect(first.summary.downloaded).to.equal(1);
        const cachedFile = join(root, '.fastui', 'assets', 'figma', 'images', 'retry-image.png');
        expect(await readFile(cachedFile, 'utf8')).to.equal('verified');

        await writeFile(cachedFile, 'corrupt!');
        const repaired = await reconcileFigmaResources({
            document, token: 'token', figFile: 'file', projectPath: root, template: 'reactjs',
            http: {get: async url => url.includes('/files/file/images')
                ? {data: {meta: {images: {'retry-image': 'https://assets.test/retry.png'}}}}
                : {data: Buffer.from('repaired'), headers: {'content-type': 'image/png', 'content-length': '8'}}},
        });
        expect(repaired.summary.updated).to.equal(1);
        expect(await readFile(cachedFile, 'utf8')).to.equal('repaired');

        let failedAttempts = 0;
        const failedHttp = {get: async url => {
            if (url.includes('/files/file/images')) return {data: {meta: {images: {'retry-image': 'https://assets.test/retry.png'}}}};
            failedAttempts++;
            const error = new Error('still unavailable');
            error.response = {status: 500, headers: {}};
            throw error;
        }};
        const originalWarn = console.warn;
        console.warn = () => {};
        let refreshed;
        try {
            refreshed = await reconcileFigmaResources({
                document, token: 'token', figFile: 'file', projectPath: root, template: 'reactjs', fresh: true,
                http: failedHttp, sleepFn: async () => {},
            });
        } finally {
            console.warn = originalWarn;
        }
        expect(failedAttempts).to.equal(4);
        expect(refreshed.summary.cached).to.equal(1);
        expect(refreshed.summary.unresolved).to.equal(1);
        expect(await readFile(cachedFile, 'utf8')).to.equal('repaired');
        expect((await readdir(dirname(cachedFile))).some(file => file.includes('.tmp-'))).to.equal(false);
    });

    it('generates one React font integration and falls back to one entry import without usable HTML', async function () {
        await mkdir(join(root, 'design'), {recursive: true});
        await mkdir(join(root, 'src'), {recursive: true});
        await writeFile(join(root, 'design', 'Inter.otf'), Buffer.from('font-data'));
        await writeFile(join(root, 'fastui.config.json'), JSON.stringify({resources: {fonts: {
            Inter: {files: [{path: 'design/Inter.otf', weightRange: [300, 700], style: 'normal'}]},
        }}}));
        await writeFile(join(root, 'index.html'), '<!doctype html><html><head><meta name="kept" content="yes"></head><body></body></html>');
        await writeFile(join(root, 'src', 'main.jsx'), "import React from 'react';\n");
        const document = {children: [{id: 'copy', name: 'Copy', type: 'TEXT', style: {fontFamily: 'Inter', fontWeight: 600}}]};
        await reconcileFigmaResources({document, figFile: 'file', projectPath: root, template: 'reactjs'});
        await reconcileFigmaResources({document, figFile: 'file', projectPath: root, template: 'reactjs'});
        const html = await readFile(join(root, 'index.html'), 'utf8');
        expect(html.match(/data-fastui-fonts/g)).to.have.length(1);
        expect(html).to.include('<meta name="kept" content="yes">');
        const css = await readFile(join(root, 'public', 'fonts', 'figma', 'fastui-fonts.generated.css'), 'utf8');
        expect(css).to.include('font-family: "Inter"');
        expect(css).to.include('font-weight: 600');
        expect(css).to.include('format("opentype")');

        await writeFile(join(root, 'index.html'), 'not an html integration point');
        await reconcileFigmaResources({document, figFile: 'file', projectPath: root, template: 'reactjs'});
        await reconcileFigmaResources({document, figFile: 'file', projectPath: root, template: 'reactjs'});
        const entry = await readFile(join(root, 'src', 'main.jsx'), 'utf8');
        expect(entry.match(/fastui-fonts\.generated\.css/g)).to.have.length(1);
        await stat(join(root, 'src', 'styles', 'fastui-fonts.generated.css'));
    });

    it('resolves explicitly configured Google Fonts variants through the Web Fonts API', async function () {
        await writeFile(join(root, 'fastui.config.json'), JSON.stringify({resources: {fonts: {Inter: {source: 'google'}}}}));
        await writeFile(join(root, 'index.html'), '<html><head></head><body></body></html>');
        const document = {children: [{id: 'google-copy', name: 'Google copy', type: 'TEXT', style: {fontFamily: 'Inter', fontWeight: 700, italic: true}}]};
        const previousKey = process.env.GOOGLE_FONTS_API_KEY;
        process.env.GOOGLE_FONTS_API_KEY = 'test-key';
        let metadataRequests = 0;
        try {
            const result = await reconcileFigmaResources({
                document, figFile: 'file', projectPath: root, template: 'reactjs', fresh: true,
                http: {get: async url => {
                    if (url.includes('googleapis.com/webfonts')) {
                        metadataRequests++;
                        return {data: {items: [{family: 'Inter', files: {'700italic': 'https://fonts.test/inter-700-italic.ttf'}}]}};
                    }
                    return {data: Buffer.from('google-font'), headers: {'content-type': 'font/ttf', 'content-length': '11'}};
                }},
            });
            expect(result.summary.unresolved).to.equal(0);
            expect(metadataRequests).to.equal(1);
            expect(await readFile(join(root, 'public', 'fonts', 'figma', 'fastui-fonts.generated.css'), 'utf8')).to.include('font-style: italic');
        } finally {
            if (previousKey === undefined) delete process.env.GOOGLE_FONTS_API_KEY;
            else process.env.GOOGLE_FONTS_API_KEY = previousKey;
        }
    });

    it('warns with node context and continues when an exact font variant is unavailable', async function () {
        await writeFile(join(root, 'fastui.config.json'), JSON.stringify({resources: {fonts: {Inter: {files: []}}}}));
        const document = {children: [{id: 'missing-font-node', name: 'Price label', type: 'TEXT', style: {fontFamily: 'Inter', fontWeight: 700}}]};
        const originalWarn = console.warn;
        console.warn = () => {};
        let result;
        try {
            result = await reconcileFigmaResources({document, figFile: 'file', projectPath: root, template: 'reactjs'});
        } finally {
            console.warn = originalWarn;
        }
        expect(result.summary.unresolved).to.equal(1);
        expect(result.unresolved[0].nodes).to.deep.equal([{id: 'missing-font-node', name: 'Price label'}]);
        expect(result.unresolved[0].reason).to.equal('No exact configured font variant');
        expect(await readFile(join(root, 'src', 'styles', 'fastui-fonts.generated.css'), 'utf8')).to.equal('');
    });
});
