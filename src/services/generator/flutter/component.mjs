import {ensurePathExist, firstUpperCase, removeWhiteSpaces, snakeToCamel} from '../../../helpers/index.mjs';
import {writeFile} from 'node:fs/promises';
import {getChildren, getEffects, getExtend, getFeed, getFrame, getLeft, getProps, getRight, getStates, getStyles} from '../modifier.mjs';
import {getFileName, getFilenameFromBlueprintPath, getFlutterLogicsImportStatement, getFlutterSrcPathFromBlueprintPath} from '../index.mjs';
import {buildContainerWidget, buildFrameWidget} from './styles.mjs';

const SYSTEM_INPUTS = ['view', 'loopElement', 'loopIndex'];

function getCustomInputs(data) {
    const filter = x => `${x}`.trim().toLowerCase().startsWith('inputs.');
    const map = x => `${x}`.trim().replace(/^inputs\./i, '');
    const styles = getStyles(data);
    const styleInputs = typeof styles === 'string'
        ? (filter(styles) ? [map(styles)] : [])
        : Object.values(styles ?? {}).filter(filter).map(map);
    const effects = getEffects(data);
    const effectInputs = Object.keys(effects).reduce((a, k) => {
        const watch = effects[k]?.watch ?? [];
        return [...a, ...(Array.isArray(watch) ? watch : [watch]).filter(filter).map(map)];
    }, []);
    return [...new Set([
        ...Object.values(getProps(data)).filter(filter).map(map),
        ...Object.values(getStates(data)).filter(filter).map(map),
        ...effectInputs,
        ...styleInputs,
    ])].filter(x => !SYSTEM_INPUTS.includes(x) && !`${x}`.startsWith('loopElement.'));
}

function getIsStateful(data) {
    const hasLogicsProps = Object.values(getProps(data) ?? {}).some(
        v => `${v}`.trim().toLowerCase().startsWith('logics.')
    );
    return Object.keys(getStates(data) ?? {}).length > 0
        || Object.keys(getEffects(data) ?? {}).length > 0
        || hasLogicsProps;
}

function getFlutterComponentsImport(data) {
    const extend = getExtend(data);
    const left = getLeft(data);
    const right = getRight(data);
    const feed = getFeed(data);
    return [extend, left, right, feed]
        .filter(x => typeof x === 'string' && x.endsWith('.yml'))
        .map(x => `import '${x.replace('.yml', '.dart')}';`)
        .join('\n');
}

function buildStatesDeclaration(states) {
    return Object.keys(states ?? {}).map(k => {
        const v = states[k];
        if (v === null || v === undefined) return `  dynamic ${k};`;
        if (typeof v === 'boolean') return `  bool ${k} = ${v};`;
        if (typeof v === 'number') return `  num ${k} = ${v};`;
        return `  dynamic ${k} = ${JSON.stringify(v)};`;
    }).join('\n');
}

function buildComponentGetter(states, customInputs) {
    const stateEntries = Object.keys(states ?? {}).map(k =>
        `      '${k}': ${k},\n      'set${firstUpperCase(k)}': (dynamic v) => setState(() { ${k} = v; }),`
    ).join('\n');
    const extraInputEntries = (customInputs ?? []).map(x => `      '${x}': widget.${x},`).join('\n');
    return `  Map<String, dynamic> get _component => {
    'states': {
${stateEntries}
    },
    'inputs': {
      'view': widget.view,
      'loopElement': widget.loopElement,
      'loopIndex': widget.loopIndex,
${extraInputEntries}
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
    const watchedEffects = Object.keys(effects ?? {}).filter(k => {
        const watch = effects[k]?.watch ?? [];
        const list = Array.isArray(watch) ? watch : [watch];
        return list.some(w => `${w}`.trim().toLowerCase().startsWith('inputs.'));
    });
    if (watchedEffects.length === 0) return '';
    const checks = watchedEffects.map(k => {
        const watch = effects[k]?.watch ?? [];
        const list = Array.isArray(watch) ? watch : [watch];
        const inputDeps = list
            .filter(w => `${w}`.trim().toLowerCase().startsWith('inputs.'))
            .map(w => `${w}`.trim().replace(/^inputs\./i, ''));
        const condition = inputDeps.map(d => `oldWidget.${d} != widget.${d}`).join(' || ');
        const body = `${effects[k]?.body}`.trim();
        const fn = body.toLowerCase().startsWith('logics.')
            ? body.replace(/^logics\.|\(\)$/ig, '')
            : null;
        return fn ? `    if (${condition}) { /*${k}*/ ${fn}(data: _component); }` : '';
    }).filter(Boolean).join('\n');
    return `  @override
  void didUpdateWidget(covariant ${className} oldWidget) {
    super.didUpdateWidget(oldWidget);
${checks}
  }`;
}

function buildExtendWidget(data, isStateful) {
    const extend = getExtend(data);
    if (!extend) return null;
    const name = firstUpperCase(snakeToCamel(getFilenameFromBlueprintPath(extend)));
    const ref = isStateful ? 'widget' : '';
    const viewArg = isStateful ? 'widget.view' : 'view';
    return `${name}(loopIndex: ${ref ? ref + '.loopIndex' : 'loopIndex'}, loopElement: ${ref ? ref + '.loopElement' : 'loopElement'}, view: ${viewArg})`;
}

export async function composeFlutterComponent({data, path, projectPath}) {
    if (!data) return;

    const className = getFileName(path);
    const states = getStates(data);
    const effects = getEffects(data);
    const isStateful = getIsStateful(data);
    const customInputs = getCustomInputs(data);
    const frame = getFrame(data);
    const styles = getStyles(data) ?? {};
    const props = getProps(data) ?? {};
    const children = getChildren(data);
    const base = data?.base ?? 'rectangle';

    const logicsImport = await getFlutterLogicsImportStatement(data, path, projectPath);
    const componentsImport = getFlutterComponentsImport(data);

    const extendWidget = buildExtendWidget(data, isStateful);
    const childWidget = extendWidget ?? buildContainerWidget({base, styles, children, props, isStateful});
    const returnWidget = buildFrameWidget({frame, childWidget, isStateful});

    const customInputParams = customInputs.map(x => `this.${x}`).join(', ');
    const customInputFields = customInputs.map(x => `  final dynamic ${x};`).join('\n');
    const systemParams = `super.key, this.view, this.loopElement, this.loopIndex${customInputParams ? ', ' + customInputParams : ''}`;

    let content;
    if (isStateful) {
        const didUpdate = buildDidUpdateWidget(effects, className);
        content = `import 'package:flutter/material.dart';
${logicsImport}
${componentsImport}

class ${className} extends StatefulWidget {
  const ${className}({${systemParams}});

  final Widget? view;
  final dynamic loopElement;
  final int? loopIndex;
${customInputFields}

  @override
  State<${className}> createState() => _${className}State();
}

class _${className}State extends State<${className}> {
${buildStatesDeclaration(states)}

${buildComponentGetter(states, customInputs)}

${buildInitState(effects)}
${didUpdate}

  @override
  Widget build(BuildContext context) {
    return ${returnWidget};
  }
}
`;
    } else {
        content = `import 'package:flutter/material.dart';
${logicsImport}
${componentsImport}

class ${className} extends StatelessWidget {
  const ${className}({${systemParams}});

  final Widget? view;
  final dynamic loopElement;
  final int? loopIndex;
${customInputFields}

  @override
  Widget build(BuildContext context) {
    return ${returnWidget};
  }
}
`;
    }

    const srcPath = getFlutterSrcPathFromBlueprintPath(path);
    await ensurePathExist(srcPath);
    await writeFile(srcPath, removeWhiteSpaces(content));
}
