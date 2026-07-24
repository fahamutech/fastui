import {ensurePathExist, firstUpperCase, removeWhiteSpaces, snakeToCamel} from '../../../helpers/index.mjs';
import {writeFile} from 'node:fs/promises';
import {getEffects, getExtend, getFrame, getLeft, getRight, getStates} from '../modifier.mjs';
import {getFileName, getFilenameFromBlueprintPath, getFlutterLogicsImportStatement, getFlutterSrcPathFromBlueprintPath} from '../index.mjs';
import {buildFrameWidget} from './styles.mjs';

function getComponentName(ymlPath) {
    return firstUpperCase(snakeToCamel(getFilenameFromBlueprintPath(ymlPath)));
}

function buildConditionWidget({left, right, isStateful}) {
    const ref = isStateful ? 'widget.' : '';
    const leftName = left ? getComponentName(left) : null;
    const rightName = right ? getComponentName(right) : null;
    const trueWidget = rightName
        ? `${rightName}(loopIndex: ${ref}loopIndex, loopElement: ${ref}loopElement)`
        : 'const SizedBox.shrink()';
    const falseWidget = leftName
        ? `${leftName}(loopIndex: ${ref}loopIndex, loopElement: ${ref}loopElement)`
        : 'const SizedBox.shrink()';
    return `condition ? ${trueWidget} : ${falseWidget}`;
}

function buildStatesDeclaration() {
    return `  bool condition = false;`;
}

function buildComponentGetter() {
    return `  Map<String, dynamic> get _component => {
    'states': {
      'condition': condition,
      'setCondition': (dynamic v) => setState(() { condition = v == true; }),
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
    const left = getLeft(data);
    const right = getRight(data);
    return [left, right]
        .filter(x => typeof x === 'string' && x.endsWith('.yml'))
        .map(x => `import '${x.replace('.yml', '.dart')}';`)
        .join('\n');
}

export async function composeFlutterCondition({data, path, projectPath}) {
    if (!data) return;

    const className = getFileName(path);
    const effects = getEffects(data);
    const frame = getFrame(data);
    const left = getLeft(data);
    const right = getRight(data);

    const logicsImport = await getFlutterLogicsImportStatement(data, path, projectPath);
    const componentsImport = getComponentsImport(data);

    const conditionWidget = buildConditionWidget({left, right, isStateful: true});
    const returnWidget = buildFrameWidget({frame, childWidget: conditionWidget, isStateful: true});

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
