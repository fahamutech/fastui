import {expect} from "chai";
import {mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path"
import {tmpdir} from "node:os";
import {readSpecs, specToJSON} from "../src/specs/reader.mjs";
import {composeComponent} from "../src/generators/component.mjs";
import {composeCondition} from "../src/generators/condition.mjs";
import {composeLoop} from "../src/generators/loop.mjs";
import {ensureAppRouteFileExist} from "../src/generators/routing.mjs";
import {ensureBlueprintFolderExist, ensureWatchFileExist} from "../src/tooling/scaffold.mjs";
import {initializeProject} from "../src/tooling/project.mjs";
import {routeFromSurfaceName} from "../src/shared/routing.mjs";
import {fetchFigmaFile, getDesignDocument, getPagesAndTraverseChildren, resolvePrototypeRoute, walkFrameChildren} from "../src/translators/figma/index.mjs";
import {repeatScrollDirection} from "../src/translators/figma/layout.mjs";
import {generateCodeFromSpecs} from '../src/generators/spec-to-code.mjs';
import {createFrameComponent, createTextComponent} from '../src/translators/figma/spec-writer.mjs';
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
                modifier: {extend: './icon.yml', states: {value: 'Continue for $100'}, props: {id: 'label_id', children: 'states.value'}, styles: {fontSize: 16}, frame: {base: 'row.start', styles: {flex: 1, height: '100%'}}}
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
            // widget.overrideStates is required inside a StatefulWidget's State class
            expect(label).to.include("stateValue = (widget.overrideStates['value'] ?? 'Continue for \\$100') as dynamic;");
            expect(label).to.include("FastUIStyleHelper.applyMeta(child, id: widget.overrideProps['id'] ?? 'label_id')");
            expect(label).to.include('LayoutBuilder(builder: (context, constraints)');
            expect(label).to.include('constraints.hasBoundedWidth');
            expect(label).to.include('height: constraints.hasBoundedHeight ? constraints.maxHeight');
            expect(button).to.include('GestureDetector(onTap:');
            expect(button).to.include('Label(');
            expect(list).to.include('List<dynamic>.from(stateData');
            expect(list).to.include('ListView.builder(scrollDirection: Axis.vertical');
            expect(staticWidget).to.include('extends StatelessWidget');
            expect(staticWidget).not.to.include('void initState()');
            expect(await readFile(join(root, 'lib', 'services', 'button.dart'), 'utf8')).to.include('dynamic onClick');
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
                base: 'container', modifier: {props: {scroll: 'vertical'}, frame: {base: 'column.start'}, extend: './feed.yml'}
            }});
            const scrollingFlutter = await readFile(join(root, 'lib', 'modules', 'scrolling.dart'), 'utf8');
            const horizontalFlutter = await readFile(join(root, 'lib', 'modules', 'horizontal.dart'), 'utf8');
            const staticFlutter = await readFile(join(root, 'lib', 'modules', 'static_loop.dart'), 'utf8');
            const areaFlutter = await readFile(join(root, 'lib', 'modules', 'scroll_area.dart'), 'utf8');
            expect(scrollingFlutter).to.include('ListView.builder(scrollDirection: Axis.vertical');
            expect(horizontalFlutter).to.include('ListView.builder(scrollDirection: Axis.horizontal');
            expect(horizontalFlutter).to.include('SizedBox(height: listHeight, child: ListView.builder');
            expect(staticFlutter).to.include('ListView.builder(scrollDirection: Axis.vertical');
            expect(staticFlutter).not.to.include('SingleChildScrollView');
            expect(areaFlutter).to.include('SingleChildScrollView(scrollDirection: Axis.vertical');
            expect(areaFlutter).not.to.include('ListView.builder');

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
            expect(scrollingReact).to.include('overrideStates={}');
            expect(scrollingReact).to.include("overflowX:'auto'");
            expect(scrollingReact).to.include('minWidth:0');
            expect(scrollingReact).not.to.include('ref={listRef}');
            expect(scrollingReact).not.to.include('visibleItems.map');
            expect(scrollingReact).to.include('data?.map((item,index)');
            expect(scrollingReact).not.to.include('<div></div>');
            expect(scrollingReact).not.to.include('scroll=');
            expect(staticReact).not.to.include('overflowX');
            expect(staticReact).not.to.include('overflowY');
            expect(staticReact).not.to.include('style={style}');
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
            expect(flutterGenerated).to.include('SizedBox(height: 16)');
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
            expect(flutterGenerated).not.to.include('_buildWithOverride({})');
            expect(flutterGenerated).to.include('FrameChild(loopIndex: widget.loopIndex, loopElement: widget.loopElement)');
        });

        it('serializes Figma text with translation key plus raw fallback text', async function () {
            const specPath = join(root, 'translated_text_spec.yml');
            await createTextComponent(specPath, {name: 'ShopNow', characters: 'Shop now'});
            const spec = await specToJSON(specPath);
            expect(spec.component.modifier.props.children).to.equal("logics.t('shop_now', \"Shop now\")");
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
            expect(reactGenerated).to.include("{t({component,args:['shop_now', 'Shop now']})}");
            expect(reactService).to.include("import {fastUITranslations} from '../translations/generated.mjs';");
            expect(reactService).to.include('export function t(data)');
            expect(reactService).to.include('return fastUITranslations.t(key, fallback);');

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
            expect(flutterGenerated).to.include("Text(t(_componentContext(context, ['shop_now', 'Shop now'])).toString()");
            expect(flutterGenerated).to.include("'args': argument == null ? <dynamic>[] : argument is List ? List<dynamic>.from(argument) : <dynamic>[argument]");
            expect(flutterService).to.include("import '../fastui_runtime.dart';");
            expect(flutterService).to.include("import '../translations/generated.dart';");
            expect(flutterService).to.include('dynamic t(Map<String, dynamic> data)');
            expect(flutterService).to.include('final normalized = args.length == 1 && args.first is List ? List<dynamic>.from(args.first as List) : args;');
            expect(flutterService).to.include('FastUITranslations.instance.t(key, fallback: fallback)');
            expect(flutterRuntime).to.include('static String humanizeKey(String key)');
            expect(flutterRuntime).to.include('?? fallback');
            expect(flutterRuntime).to.include('?? humanizeKey(key)');
        });

        it('Figma translator resolves scroll direction from overflowDirection only (scroll is intentional)', async function () {
            expect(repeatScrollDirection({overflowDirection: 'VERTICAL_SCROLLING'})).to.equal('vertical');
            expect(repeatScrollDirection({overflowDirection: 'HORIZONTAL_SCROLLING'})).to.equal('horizontal');
            expect(repeatScrollDirection({overflowDirection: 'HORIZONTAL_AND_VERTICAL_SCROLLING'})).to.equal('both');
            expect(repeatScrollDirection({mainFrame: {overflowDirection: 'HORIZONTAL_SCROLLING'}})).to.equal('horizontal');
            expect(repeatScrollDirection({layoutMode: 'VERTICAL'})).to.equal(undefined);
            expect(repeatScrollDirection({layoutMode: 'HORIZONTAL'})).to.equal(undefined);
            expect(repeatScrollDirection({})).to.equal(undefined);
            expect(repeatScrollDirection(undefined)).to.equal(undefined);

            const document = {children: [{
                id: 'page', name: 'scroll_page', type: 'FRAME', visible: true, layoutMode: 'VERTICAL',
                children: [{
                    id: 'list', name: 'Items_repeat', type: 'FRAME', layoutMode: 'VERTICAL',
                    primaryAxisAlignItems: 'MIN', layoutSizingVertical: 'FILL',
                    children: [{id: 'item', name: 'Item_row', type: 'FRAME', layoutMode: 'HORIZONTAL', children: []}]
                }]
            }]};
            const srcPath = join(root, 'lib', 'blueprints');
            const children = await getPagesAndTraverseChildren({document, srcPath});
            await walkFrameChildren({children, srcPath});
            const listSpec = await readFile(join(srcPath, 'modules', 'presentation', 'pages', 'ilist_Items_repeat.yml'), 'utf8');
            expect(listSpec).not.to.include('scroll:');

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
            expect(await readFile(join(root, 'lib', 'app_route.dart'), 'utf8')).to.include('FastUIStyleHelper.lightTheme()');
            expect(await readFile(join(root, 'lib', 'app_route.dart'), 'utf8')).to.include('FastUIStyleHelper.darkTheme()');
            const runtime = await readFile(join(root, 'lib', 'fastui_runtime.dart'), 'utf8');
            expect(runtime).to.include(`RegExp(r'''^['"]|['"]$''')`);
            const startScript = await readFile(join(root, 'fastui_dev.sh'), 'utf8');
            expect(startScript).to.include('WATCHER_PID_FILE=".fastui/watch.pid"');
            expect(startScript).to.include('export FASTUI_FLUTTER_PID="$FLUTTER_PID"');
            expect(startScript).to.include('wait "$FLUTTER_PID"');
            expect(startScript).to.include('trap cleanup EXIT');
            expect(startScript).to.include("trap 'cleanup; exit 130' INT TERM");
            expect(await readFile(join(root, 'lib', 'stores', 'observable_store.dart'), 'utf8')).to.include('extends ChangeNotifier');
        });

        it('builds from the configured blueprint root when no path is supplied', async function () {
            const specPath = join(root, 'lib', 'blueprints', 'modules', 'default_root.yml');
            await writeFile(specPath, 'component:\n  base: container\n  modifier: {}\n');
            const results = await generateCodeFromSpecs({projectPath: root});
            expect(results.some(result => result.specPath.endsWith('default_root.yml'))).to.equal(true);
            await stat(join(root, 'lib', 'modules', 'default_root.dart'));
        });

        it('build path creates missing root React store support files', async function () {
            process.env.FASTUI_TEMPLATE = 'reactjs';
            const reactRoot = join(root, 'src', 'blueprints', 'modules');
            await mkdir(reactRoot, {recursive: true});
            const specPath = join(reactRoot, 'build_support.yml');
            await writeFile(specPath, 'component:\n  base: container\n  modifier: {}\n');
            const results = await generateCodeFromSpecs({projectPath: root});
            expect(results.some(result => result.specPath.endsWith('build_support.yml'))).to.equal(true);
            expect(await readFile(join(root, 'src', 'stores', 'observable_store.mjs'), 'utf8')).to.include('export const appState = createObservableStore()');
            expect(await readFile(join(root, 'src', 'stores', 'use_observable.mjs'), 'utf8')).to.include('useSyncExternalStore');
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
            expect(reactTranslations).to.include("locale: 'default'");
            expect(reactTranslations).to.include("store.load('default', generatedTranslations.default ?? {});");
            expect(reactTranslations).to.include('replace(/\\s+/g,');
            expect(reactTranslations).to.include('replace(/\\b\\w/g,');
            expect(reactService).to.include("import {fastUITranslations} from '../translations/generated.mjs';");

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
            expect(flutterTranslations).to.include("load('default', fastUITranslationsDefault)");
            expect(flutterTranslations).to.include('"in_stores": "In Stores"');
            expect(flutterService).to.include("import '../fastui_runtime.dart';");
            expect(flutterService).to.include("import '../translations/generated.dart';");
            expect(flutterService).to.include('installFastUITranslations();');
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
            expect(await readFile(join(root, 'src', 'stores', 'observable_store.mjs'), 'utf8')).to.include('BehaviorSubject');
            expect(await readFile(join(root, 'src', 'stores', 'use_observable.mjs'), 'utf8')).to.include('useSyncExternalStore');
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
            expect(appRoute).to.include('surfacePresentations');
            expect(appRoute).to.include('data-fastui-surface');
            expect(appRoute).not.to.include("overflow: 'auto'");
            expect(appRoute).not.to.include("overflowY: 'auto'");

            await writeFile(join(root, 'src', 'routing_guard.mjs'), 'export async function beforeNavigate() { return {decision: "cancel"}; }\n');
            await ensureAppRouteFileExist({template: 'reactjs', initialId: 'home', pages});
            expect(await readFile(join(root, 'src', 'routing_guard.mjs'), 'utf8')).to.include('decision: "cancel"');
            process.env.FASTUI_TEMPLATE = 'flutter';
        });

        it('creates missing React observable store support files when generating routing only', async function () {
            process.env.FASTUI_TEMPLATE = 'reactjs';
            await ensureAppRouteFileExist({template: 'reactjs', initialId: 'home', pages: [{id: 'home', name: 'home_page', module: 'home'}]});
            expect(await readFile(join(root, 'src', 'stores', 'observable_store.mjs'), 'utf8')).to.include('export const appState = createObservableStore()');
            expect(await readFile(join(root, 'src', 'stores', 'use_observable.mjs'), 'utf8')).to.include('useSyncExternalStore');
            expect(await readFile(join(root, 'src', 'routing.mjs'), 'utf8')).to.include("import {appState} from './stores/observable_store.mjs';");
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

        it('tags a spec-file base as __specBase and generates a wrapper that forwards overrides', async function () {
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
            // base is deleted; __specBase points to the absolute path of the shared spec
            expect(resolved.component.base).to.equal(undefined);
            expect(resolved.component.__specBase).to.include('text.yml');
            expect(resolved.component.__specBaseRelative).to.equal('../../shared/common/text.yml');
            // local modifier overrides are preserved as-is
            expect(resolved.component.modifier.styles.color).to.equal('#0000FF');
            expect(resolved.component.modifier).not.to.have.property('ref');
            // generator emits a wrapper that imports the base and passes overrides
            await composeComponent({data: resolved.component, path: labelPath, projectPath: root});
            const generated = await readFile(join(root, 'src', 'modules', 'example', 'label.jsx'), 'utf8');
            expect(generated).to.include('import {Text} from');
            expect(generated).to.include('overrideStyles=');
            expect(generated).to.include('overrideProps=');
            expect(generated).to.include('overrideStates=');
            process.env.FASTUI_TEMPLATE = 'flutter';
        });

        it('preserves local modifier override paths for spec-file base references', async function () {
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
            // base tagged, not merged — local modifier is empty, no extend here
            expect(resolved.component.__specBaseRelative).to.equal('../../shared/common/group.yml');
            expect(resolved.component.modifier).to.deep.equal({});
        });

        it('base component merges overrideStyles, overrideProps, and overrideStates at render time', async function () {
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
            // styles: _baseStyle is the base styles; style merges overrideStyles on top
            expect(baseGenerated).to.include('_baseStyle');
            expect(baseGenerated).to.include('...overrideStyles');
            // props: static id prop followed by {...overrideProps} spread so overrides win
            expect(baseGenerated).to.include('{...overrideProps}');
            // states: initial value spreads overrideStates so wrapper can seed different initial state
            expect(baseGenerated).to.include('...overrideStates');
            // wrapper component: passes all three as overrides to the base
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
            expect(wrapperGenerated).to.include('import {BaseCard} from');
            expect(wrapperGenerated).to.include('"background":"#f7f7f7"');
            expect(wrapperGenerated).to.include('"id":"card-variant"');
            expect(wrapperGenerated).to.include('"label":"Variant label"');
            process.env.FASTUI_TEMPLATE = 'flutter';
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
            expect(start.indexOf('ChildB(')).to.be.lessThan(start.indexOf("Text('ParentMarker'"));
            expect(stack).to.include('Stack(children:');
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
            expect(generated).to.include('Expanded(child: Container(decoration: BoxDecoration(color: Color(0xFFF5F5F5)), child: Align(alignment: Alignment.topLeft, heightFactor: 1');
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
            const sharedSpec = await readFile(join(srcPath, 'modules', 'shared', 'common', 'ishared_text_Label.yml'), 'utf8');
            const sheetSpec = await readFile(join(srcPath, 'modules', 'presentation', 'pages', 'choices_sheet.yml'), 'utf8');
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
            expect(guard).to.include('Future<FastUINavigationDecision> beforeNavigate');
            expect(instanceSpec).to.include('base: ../../shared/common/ishared_text_Label.yml');
            expect(instanceSpec).to.include('extend: ./ilabel_copy_Copy_text.yml');
            expect(instanceSpec).not.to.include('ref:');
            expect(instanceSpec).not.to.include('compose:');
            expect(sharedSpec).to.include('component:');
            expect(sharedSpec).not.to.include('onStart');
            expect(sheetSpec).to.include('surface:');
            expect(sheetSpec).to.include('mode: overlay');
            expect(sheetSpec).to.include('scroll: none');
            const resolvedInstance = await specToJSON(join(srcPath, 'modules', 'presentation', 'pages', 'ilabel_Primary_label.yml'));
            expect(resolvedInstance.component.__specBase).to.include('ishared_text_Label.yml');
            expect(resolvedInstance.component.modifier).not.to.have.property('ref');
            expect(resolvedInstance.component.modifier.extend).to.equal('./ilabel_copy_Copy_text.yml');
        });
    });
});
