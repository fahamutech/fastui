import {ensurePathExist, firstUpperCase, removeWhiteSpaces, snakeToCamel} from '../../../helpers/index.mjs';
import {writeFile} from 'node:fs/promises';
import {getEffects, getExtend, getFeed, getFrame, getStates, getStyles, getProps} from '../modifier.mjs';
import {getFileName, getFilenameFromBlueprintPath, getFlutterLogicsImportStatement, getFlutterSrcPathFromBlueprintPath} from '../index.mjs';
import {buildEdgeInsets, buildBoxDecoration, isDynamicValue, resolveFlutterValue, toFlutterSize, buildFrameWidget} from './styles.mjs';

function getItemComponentName(feed) {
    return firstUpperCase(snakeToCamel(getFilenameFromBlueprintPath(feed)));
}

function buildListView({feed, styles, props, isStateful}) {
    const itemName = feed ? getItemComponentName(feed) : null;
    const parts = [];

    const padding = buildEdgeInsets(styles ?? {}, 'padding', isStateful);
    if (padding) parts.push(`padding: ${padding}`);

    const h = styles?.height;
    const w = styles?.width;
    if (h != null) parts.push(`itemExtent: ${isDynamicValue(h) ? resolveFlutterValue(h, isStateful) : toFlutterSize(h)}`);

    const ref = isStateful ? 'widget.' : '';
    const dataRef = 'data';

    if (itemName) {
        parts.push(`itemCount: ${dataRef}.length`);
        parts.push(`itemBuilder: (context, index) => ${itemName}(loopIndex: index, loopElement: ${dataRef}[index])`);
    }

    return `ListView.builder(${parts.join(', ')})`;
}

function buildStatesDeclaration() {
    return `  List<dynamic> data = [];`;
}

function buildComponentGetter() {
    return `  Map<String, dynamic> get _component => {
    'states': {
      'data': data,
      'setData': (dynamic v) => setState(() { data = List.from(v ?? []); }),
    },
    'inputs': {
      'view': widget.view,
      'loopElement': widget.loopElement,
      'loopIndex': widget.loopIndex,
    },
  };`;
}

function buildInitState(effects) {
    const lines = Object.keys(effects ?? {}).map(k => {
        const body = `${effects[k]?.body}`.trim();
        if (body.toLowerCase().startsWith('logics.')) {
            const fn = body.replace(/^logics\.|\(\)$/ig, '');
            return `    /*${k}*/ ${fn}(data: _component);`;
        }
        return '';
    }).filter(Boolean).join('\n');
    return `  @override
  void initState() {
    super.initState();
${lines}
  }`;
}

function buildDidUpdateWidget(effects, className) {
    const watched = Object.keys(effects ?? {}).filter(k => {
        const watch = effects[k]?.watch ?? [];
        const list = Array.isArray(watch) ? watch : [watch];
        return list.some(w => `${w}`.trim().toLowerCase().startsWith('inputs.'));
    });
    if (watched.length === 0) return '';
    const checks = watched.map(k => {
        const watch = effects[k]?.watch ?? [];
        const list = Array.isArray(watch) ? watch : [watch];
        const inputDeps = list
            .filter(w => `${w}`.trim().toLowerCase().startsWith('inputs.'))
            .map(w => `${w}`.trim().replace(/^inputs\./i, ''));
        const condition = inputDeps.map(d => `oldWidget.${d} != widget.${d}`).join(' || ');
        const body = `${effects[k]?.body}`.trim();
        const fn = body.toLowerCase().startsWith('logics.')
            ? body.replace(/^logics\.|\(\)$/ig, '') : null;
        return fn ? `    if (${condition}) { /*${k}*/ ${fn}(data: _component); }` : '';
    }).filter(Boolean).join('\n');
    return `  @override\n  void didUpdateWidget(covariant ${className} oldWidget) {\n    super.didUpdateWidget(oldWidget);\n${checks}\n  }`;
}

function getComponentsImport(data) {
    const feed = getFeed(data);
    if (typeof feed === 'string' && feed.endsWith('.yml')) {
        return `import '${feed.replace('.yml', '.dart')}';`;
    }
    return '';
}

export async function composeFlutterLoop({data, path, projectPath}) {
    if (!data) return;

    const className = getFileName(path);
    const effects = getEffects(data);
    const frame = getFrame(data);
    const feed = getFeed(data);
    const styles = getStyles(data) ?? {};
    const props = getProps(data) ?? {};

    const logicsImport = await getFlutterLogicsImportStatement(data, path, projectPath);
    const componentsImport = getComponentsImport(data);

    const listWidget = buildListView({feed, styles, props, isStateful: true});
    const returnWidget = buildFrameWidget({frame, childWidget: listWidget, isStateful: true});

    const content = `import 'package:flutter/material.dart';
${logicsImport}
${componentsImport}

class ${className} extends StatefulWidget {
  const ${className}({super.key, this.view, this.loopElement, this.loopIndex});

  final Widget? view;
  final dynamic loopElement;
  final int? loopIndex;

  @override
  State<${className}> createState() => _${className}State();
}

class _${className}State extends State<${className}> {
${buildStatesDeclaration()}

${buildComponentGetter()}

${buildInitState(effects)}
${buildDidUpdateWidget(effects, className)}

  @override
  Widget build(BuildContext context) {
    return ${returnWidget};
  }
}
`;

    const srcPath = getFlutterSrcPathFromBlueprintPath(path);
    await ensurePathExist(srcPath);
    await writeFile(srcPath, removeWhiteSpaces(content));
}
