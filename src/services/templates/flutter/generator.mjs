import {readFile, writeFile} from 'node:fs/promises';
import {dirname, relative, resolve, sep} from 'node:path';
import {ensureFileExist, ensurePathExist, firstUpperCase} from '../../../utils/index.mjs';
import {
    getEffects,
    getExtend,
    getFeed,
    getFrame,
    getLeft,
    getProps,
    getRight,
    getStates,
    getStyles
} from '../../modifier.mjs';
import {analyzeBehavior} from '../../../compiler/behavior.mjs';
import {flutterRuntimeSourceV2} from './runtime.mjs';
import {ensureServiceFile, relativeImport, specStructure} from '../../../generators/project-structure.mjs';
import {specToJSON} from '../../specs.mjs';

const dartIdentifier = value => `${value ?? ''}`
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/^[^a-zA-Z_]/, '_$&');

const stateIdentifier = value => `state${firstUpperCase(dartIdentifier(value))}`;

const dartFileStem = value => `${value}`.split(sep).pop().replace(/\.ya?ml$/i, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();

const dartClassStem = value => `${value}`.split(sep).pop().replace(/\.ya?ml$/i, '')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map(part => `${part[0]}`.toUpperCase() + part.slice(1))
    .join('');

const classNameFromPath = value => `FastUI${dartClassStem(value)}`;

function generatedPath(specPath) {
    const parts = resolve(specPath).split(sep).filter(part => part !== 'blueprints');
    const filename = `${parts.pop()}`;
    return resolve(parts.join(sep), `${dartFileStem(filename)}.dart`);
}

function flutterLibRoot(specPath) {
    const parts = resolve(specPath).split(sep);
    const blueprintIndex = parts.lastIndexOf('blueprints');
    return blueprintIndex >= 0 ? parts.slice(0, blueprintIndex).join(sep) || sep : resolve('lib');
}

function dartString(value) {
    return `'${`${value ?? ''}`.replaceAll('\\', '\\\\').replaceAll("'", "\\'").replaceAll('$', '\\$').replaceAll('\n', '\\n')}'`;
}

function dartLiteral(value) {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'boolean' || typeof value === 'number') return `${value}`;
    if (Array.isArray(value)) return `[${value.map(dartLiteral).join(', ')}]`;
    if (typeof value === 'object') {
        return `{${Object.entries(value).map(([key, item]) => `${dartString(key)}: ${dartLiteral(item)}`).join(', ')}}`;
    }
    return dartString(value);
}

function valueExpression(value) {
    const text = `${value ?? ''}`.trim();
    if (/^asset:\/\/figma\//i.test(text)) {
        return dartString(text.replace(/^asset:\/\/figma\//i, 'assets/images/figma/'));
    }
    if (/^states\./i.test(text)) return stateIdentifier(text.replace(/^states\./i, ''));
    if (/^inputs\.loopElement\./i.test(text)) {
        const key = text.replace(/^inputs\.loopElement\./i, '').split('??')[0].trim();
        const fallback = text.includes('??') ? valueExpression(text.split('??').slice(1).join('??').trim()) : 'null';
        return `(widget.loopElement is Map ? widget.loopElement[${dartString(key)}] : null) ?? ${fallback}`;
    }
    if (/^inputs\./i.test(text)) return `widget.${dartIdentifier(text.replace(/^inputs\./i, ''))}`;
    return dartLiteral(value);
}

function collectInputs(data = {}) {
    const found = new Set(['view', 'loopElement', 'loopIndex']);
    const visit = value => {
        if (typeof value === 'string') {
            const matches = value.matchAll(/inputs\.([a-zA-Z_][a-zA-Z0-9_]*)/g);
            for (const match of matches) found.add(match[1]);
        } else if (value && typeof value === 'object') {
            Object.values(value).forEach(visit);
        }
    };
    visit(data);
    return [...found].map(dartIdentifier);
}

function collectLogicNames(data = {}) {
    const found = new Set();
    const visit = value => {
        if (typeof value === 'string' && /^(?:logics|services)\./i.test(value.trim())) {
            found.add(dartIdentifier(value.trim().replace(/^(?:logics|services)\./i, '').replace(/\(\)$/g, '')));
        } else if (value && typeof value === 'object') {
            Object.values(value).forEach(visit);
        }
    };
    visit(data);
    return [...found];
}

function referenceImport(specPath, reference) {
    if (typeof reference !== 'string' || !reference.endsWith('.yml')) return null;
    const targetSpec = resolve(dirname(specPath), reference);
    const targetOutput = generatedPath(targetSpec);
    let importPath = relative(dirname(generatedPath(specPath)), targetOutput).split(sep).join('/');
    if (!importPath.startsWith('.')) importPath = `./${importPath}`;
    return {className: classNameFromPath(reference), importPath, targetSpec};
}

async function addReferenceLayout(reference) {
    if (!reference) return reference;
    const document = await specToJSON(reference.targetSpec);
    const data = document?.component ?? document?.condition ?? document?.loop;
    const frame = getFrame(data);
    const raw = typeof frame === 'string' ? frame : frame?.base;
    const styles = typeof frame === 'object' ? frame?.styles ?? {} : {};
    const isRow = `${raw ?? ''}`.toLowerCase().startsWith('row');
    return {
        ...reference,
        flexible: Number(styles.flex ?? 0) > 0
            || fillsAxis(styles[isRow ? 'width' : 'height'], isRow ? 'width' : 'height'),
    };
}

function colorExpression(value) {
    if (typeof value !== 'string') return null;
    const rgba = value.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
    if (rgba) {
        const red = Math.max(0, Math.min(255, Math.round(Number(rgba[1]))));
        const green = Math.max(0, Math.min(255, Math.round(Number(rgba[2]))));
        const blue = Math.max(0, Math.min(255, Math.round(Number(rgba[3]))));
        const opacity = Number.isFinite(Number(rgba[4])) ? Math.max(0, Math.min(1, Number(rgba[4]))) : 1;
        return `Color.fromRGBO(${red}, ${green}, ${blue}, ${opacity})`;
    }
    const hex = value.match(/^#([0-9a-f]{6}|[0-9a-f]{8})$/i);
    if (hex) {
        const raw = hex[1].length === 6 ? `FF${hex[1]}` : hex[1];
        return `Color(0x${raw.toUpperCase()})`;
    }
    return null;
}

function edgeInsets(styles, prefix = 'padding') {
    const shorthand = `${styles[prefix] ?? ''}`.trim().split(/\s+/).filter(Boolean)
        .map(value => Number(`${value}`.replace(/px$/i, '')));
    const valid = shorthand.length > 0 && shorthand.every(Number.isFinite) ? shorthand : [];
    const [shorthandTop, shorthandRight, shorthandBottom, shorthandLeft] = valid.length === 1
        ? [valid[0], valid[0], valid[0], valid[0]]
        : valid.length === 2
            ? [valid[0], valid[1], valid[0], valid[1]]
            : valid.length === 3
                ? [valid[0], valid[1], valid[2], valid[1]]
                : valid.length >= 4 ? valid : [0, 0, 0, 0];
    const left = Number(styles[`${prefix}Left`] ?? shorthandLeft ?? 0);
    const top = Number(styles[`${prefix}Top`] ?? shorthandTop ?? 0);
    const right = Number(styles[`${prefix}Right`] ?? shorthandRight ?? 0);
    const bottom = Number(styles[`${prefix}Bottom`] ?? shorthandBottom ?? 0);
    if (![left, top, right, bottom].some(Boolean)) return null;
    return `EdgeInsets.fromLTRB(${left}, ${top}, ${right}, ${bottom})`;
}

function borderRadius(styles) {
    if (Number.isFinite(Number(styles.borderRadius))) {
        return `BorderRadius.circular(${Number(styles.borderRadius)})`;
    }
    const values = [styles.borderTopLeftRadius, styles.borderTopRightRadius, styles.borderBottomRightRadius, styles.borderBottomLeftRadius];
    if (!values.some(value => Number.isFinite(Number(value)))) return null;
    return `BorderRadius.only(topLeft: Radius.circular(${Number(values[0] ?? 0)}), topRight: Radius.circular(${Number(values[1] ?? 0)}), bottomRight: Radius.circular(${Number(values[2] ?? 0)}), bottomLeft: Radius.circular(${Number(values[3] ?? 0)}))`;
}

function backgroundImage(styles) {
    const match = `${styles.backgroundImage ?? ''}`.match(/^url\(["']?(.*?)["']?\)$/i);
    if (!match) return null;
    const source = match[1].replace(/^asset:\/\/figma\//, 'assets/images/figma/');
    if (source.toLowerCase().endsWith('.svg')) return null;
    const provider = /^https?:\/\//i.test(source)
        ? `NetworkImage(${dartString(source)})`
        : `AssetImage(${dartString(source.replace(/^\//, ''))})`;
    const fit = `${styles.backgroundSize ?? ''}`.toLowerCase() === 'contain' ? 'contain' : 'cover';
    return `DecorationImage(image: ${provider}, fit: BoxFit.${fit})`;
}

function dimensionExpression(value, axis) {
    if (Number.isFinite(Number(value))) return `${Number(value)}`;
    return null;
}

function backdropBlur(styles) {
    const match = `${styles.backdropFilter ?? styles.WebkitBackdropFilter ?? ''}`.match(/blur\(\s*([\d.]+)px\s*\)/i);
    return match && Number.isFinite(Number(match[1])) ? Number(match[1]) : null;
}

function applyBackdropBlur(styles, child) {
    const radius = backdropBlur(styles);
    return radius === null
        ? child
        : `ClipRect(child: BackdropFilter(filter: ui.ImageFilter.blur(sigmaX: ${radius}, sigmaY: ${radius}), child: ${child}))`;
}

function fillsAxis(value, axis) {
    const normalized = `${value ?? ''}`.trim().toLowerCase();
    return normalized === '100%'
        || (axis === 'width' && normalized === '100vw')
        || (axis === 'height' && normalized === '100vh');
}

function containerExpression(styles = {}, child = 'null') {
    const args = [];
    const width = dimensionExpression(styles.width, 'width');
    const height = dimensionExpression(styles.height, 'height');
    if (width) args.push(`width: ${width}`);
    if (height) args.push(`height: ${height}`);
    const padding = edgeInsets(styles, 'padding');
    const margin = edgeInsets(styles, 'margin');
    if (padding) args.push(`padding: ${padding}`);
    if (margin) args.push(`margin: ${margin}`);
    const decoration = [];
    const color = colorExpression(styles.backgroundColor);
    if (color) decoration.push(`color: ${color}`);
    const image = backgroundImage(styles);
    if (image) decoration.push(`image: ${image}`);
    const radius = borderRadius(styles);
    if (radius) decoration.push(`borderRadius: ${radius}`);
    const borderColor = colorExpression(styles.borderColor);
    const borderWidth = Number(styles.borderTopWidth ?? styles.borderWidth ?? 0);
    if (borderColor && borderWidth > 0) decoration.push(`border: Border.all(color: ${borderColor}, width: ${borderWidth})`);
    if (decoration.length) args.push(`decoration: BoxDecoration(${decoration.join(', ')})`);
    if (child !== 'null') args.push(`child: ${child}`);
    const fillWidth = fillsAxis(styles.width, 'width');
    const fillHeight = fillsAxis(styles.height, 'height');
    if (args.length === 0) return 'const SizedBox.shrink()';
    if (!fillWidth && !fillHeight && backdropBlur(styles) === null && args.length === 1 && child !== 'null' && args[0] === `child: ${child}`) return child;
    const container = applyBackdropBlur(styles, `Container(${args.join(', ')})`);
    if (!fillWidth && !fillHeight) return container;
    const fallbackWidth = Number.isFinite(Number(styles.fallbackWidth)) ? Number(styles.fallbackWidth) : 0;
    const fallbackHeight = Number.isFinite(Number(styles.fallbackHeight)) ? Number(styles.fallbackHeight) : 0;
    const sizes = [
        fillWidth ? `width: constraints.hasBoundedWidth ? constraints.maxWidth : constraints.minWidth > ${fallbackWidth} ? constraints.minWidth : ${fallbackWidth}` : '',
        fillHeight ? `height: constraints.hasBoundedHeight ? constraints.maxHeight : constraints.minHeight > ${fallbackHeight} ? constraints.minHeight : ${fallbackHeight}` : '',
        `child: ${container}`,
    ].filter(Boolean).join(', ');
    return `LayoutBuilder(builder: (context, constraints) => SizedBox(${sizes}))`;
}

function textExpression(data) {
    const styles = getStyles(data);
    const children = data?.modifier?.props?.children ?? '';
    const style = [];
    const color = colorExpression(styles.color);
    if (color) style.push(`color: ${color}`);
    if (Number.isFinite(Number(styles.fontSize))) style.push(`fontSize: ${Number(styles.fontSize)}`);
    if (Number.isFinite(Number(styles.fontWeight))) {
        const weight = Math.max(100, Math.min(900, Math.round(Number(styles.fontWeight) / 100) * 100));
        style.push(`fontWeight: FontWeight.w${weight}`);
    }
    if (styles.fontFamily) style.push(`fontFamily: ${dartString(styles.fontFamily)}`);
    if (`${styles.fontStyle}`.toLowerCase() === 'italic') style.push('fontStyle: FontStyle.italic');
    if (Number.isFinite(Number(styles.letterSpacing))) style.push(`letterSpacing: ${Number(styles.letterSpacing)}`);
    if (Number.isFinite(Number(styles.lineHeightPx)) && Number(styles.fontSize) > 0) {
        style.push(`height: ${Number(styles.lineHeightPx) / Number(styles.fontSize)}`);
    }
    const textStyle = style.length ? `, style: TextStyle(${style.join(', ')})` : '';
    const expression = valueExpression(children);
    const nullable = typeof children === 'string' && /^(states|inputs)\./i.test(children.trim());
    const alignment = {start: 'start', left: 'left', center: 'center', end: 'end', right: 'right'}[`${styles.textAlign ?? ''}`.toLowerCase()];
    return `Text(${nullable ? `(${expression} ?? '')` : expression}.toString()${alignment ? `, textAlign: TextAlign.${alignment}` : ''}${textStyle})`;
}

function imageExpression(data) {
    const rawSrc = data?.modifier?.props?.src ?? getStates(data).srcUrl ?? '';
    const src = typeof rawSrc === 'string' ? rawSrc.replace(/^asset:\/\/figma\//, 'assets/images/figma/') : rawSrc;
    const expression = valueExpression(src);
    const styles = getStyles(data);
    const args = [];
    if (Number.isFinite(Number(styles.width))) args.push(`width: ${Number(styles.width)}`);
    if (Number.isFinite(Number(styles.height))) args.push(`height: ${Number(styles.height)}`);
    const fit = `${styles.objectFit ?? ''}`.toLowerCase();
    if (fit) args.push(`fit: BoxFit.${fit === 'none' ? 'none' : fit === 'contain' ? 'contain' : 'cover'}`);
    const nullable = typeof src === 'string' && /^(states|inputs)\./i.test(src.trim());
    return `FastUIImage(source: ${nullable ? `(${expression} ?? '')` : expression}.toString()${args.length ? `, ${args.join(', ')}` : ''})`;
}

function logicCall(value, argument = 'null') {
    const name = dartIdentifier(`${value ?? ''}`.replace(/^(?:logics|services)\./i, '').replace(/\(\)$/g, ''));
    return `${name}(_componentContext(context, ${argument}))`;
}

function navigationCall(action) {
    const transition = action?.transition ?? {};
    const rawDuration = Number(transition?.duration ?? action?.durationMs);
    const durationMs = Number.isFinite(rawDuration)
        ? Math.round(rawDuration <= 10 ? rawDuration * 1000 : rawDuration)
        : 300;
    const args = [
        action?.name ? `name: ${dartString(`${action.name}`.replace(/^\/+|\/+$/g, ''))}` : '',
        `type: ${dartString(action?.type ?? 'page')}`,
        action?.replace ? 'replace: true' : '',
        transition?.type ? `transition: ${dartString(transition.type)}` : '',
        transition?.direction ? `direction: ${dartString(transition.direction)}` : '',
        `durationMs: ${durationMs}`,
        action?.barrierDismissible ? 'barrierDismissible: true' : ''
    ].filter(Boolean).join(', ');
    return `FastUINavigation.navigate(context, ${args})`;
}

function interactionStatement(action, argument = 'null') {
    if (`${action?.action ?? ''}`.startsWith('navigation.')) return navigationCall(action);
    if (action?.action === 'state.set' && action.target) {
        const value = action.value === 'event.value' ? argument : dartLiteral(action.value);
        return `_set${firstUpperCase(stateIdentifier(action.target))}(${value})`;
    }
    return '';
}

function interactionHandler(action, argumentName) {
    const actions = action?.action === 'sequence' ? action.actions ?? [] : [action];
    const statements = actions.map(value => interactionStatement(value, argumentName ?? 'null')).filter(Boolean);
    return `(${argumentName ?? ''}) { ${statements.map(statement => `${statement};`).join(' ')} }`;
}

function applyInteractions(data, body) {
    const onClick = data?.modifier?.props?.onClick;
    if (onClick && typeof onClick === 'object') {
        return `GestureDetector(onTap: ${interactionHandler(onClick)}, child: ${body})`;
    }
    return typeof onClick === 'string' && /^(?:logics|services)\./i.test(onClick)
        ? `GestureDetector(onTap: () => ${logicCall(onClick)}, child: ${body})`
        : body;
}

function inputExpression(data) {
    const props = data?.modifier?.props ?? {};
    const styles = getStyles(data);
    const args = [];
    if (props.value !== undefined && props.value !== null) args.push(`initialValue: (${valueExpression(props.value)} ?? '').toString()`);
    if (/^(?:logics|services)\./i.test(`${props.onChange ?? ''}`)) args.push(`onChanged: (value) => ${logicCall(props.onChange, 'value')}`);
    else if (props.onChange && typeof props.onChange === 'object') args.push(`onChanged: ${interactionHandler(props.onChange, 'value')}`);
    const decoration = [];
    if (props.placeholder) decoration.push(`hintText: ${valueExpression(props.placeholder)}`);
    const padding = edgeInsets(styles, 'padding');
    if (padding) decoration.push(`contentPadding: ${padding}`);
    const configuredBorder = typeof styles.borderColor === 'string' && /^states\./i.test(styles.borderColor)
        ? getStates(data)[styles.borderColor.replace(/^states\./i, '')]
        : styles.borderColor;
    const inputBorderColor = colorExpression(configuredBorder);
    const inputBorderWidth = Number(styles.borderTopWidth ?? styles.borderWidth ?? (inputBorderColor ? 1 : 0));
    const inputRadius = Number.isFinite(Number(styles.borderRadius)) ? Number(styles.borderRadius) : 0;
    if (inputBorderColor && inputBorderWidth > 0) {
        const border = `OutlineInputBorder(borderRadius: BorderRadius.circular(${inputRadius}), borderSide: BorderSide(color: ${inputBorderColor}, width: ${inputBorderWidth}))`;
        decoration.push(`border: ${border}`, `enabledBorder: ${border}`);
    }
    const fillColor = colorExpression(styles.backgroundColor);
    if (fillColor) decoration.push('filled: true', `fillColor: ${fillColor}`);
    if (decoration.length) args.push(`decoration: InputDecoration(${decoration.join(', ')})`);
    if (`${getStates(data).inputType ?? props.type}`.toLowerCase() === 'password') args.push('obscureText: true');
    const field = `TextFormField(${args.join(', ')})`;
    const width = dimensionExpression(styles.width, 'width');
    const height = dimensionExpression(styles.height, 'height');
    return width || height ? `SizedBox(${width ? `width: ${width}, ` : ''}${height ? `height: ${height}, ` : ''}child: ${field})` : field;
}

function componentBody(data, nestedChild = null) {
    const base = `${data?.base ?? 'container'}`.toLowerCase();
    if (base === 'text') return textExpression(data);
    if (base === 'image') return imageExpression(data);
    if (base === 'input' || (base === 'container' && data?.modifier?.props?.control === 'input')) return inputExpression(data);
    const body = containerExpression(getStyles(data), nestedChild ?? 'null');
    return applyInteractions(data, body);
}

function mainAxis(value) {
    const map = {center: 'center', 'flex-end': 'end', 'space-between': 'spaceBetween', 'space-around': 'spaceAround', 'space-evenly': 'spaceEvenly'};
    return `MainAxisAlignment.${map[value] ?? 'start'}`;
}

function crossAxis(value) {
    const map = {center: 'center', 'flex-end': 'end', stretch: 'stretch', baseline: 'baseline'};
    return `CrossAxisAlignment.${map[value] ?? 'start'}`;
}

function alignedContent(styles, isRow, content) {
    const position = value => value === 'center' ? 0 : value === 'flex-end' ? 1 : -1;
    const horizontal = position(isRow ? styles.justifyContent : styles.alignItems);
    const vertical = position(isRow ? styles.alignItems : styles.justifyContent);
    if (horizontal === -1 && vertical === -1) return content;
    return `Align(alignment: Alignment(${horizontal}, ${vertical}), child: ${content})`;
}

function frameExpression(frame, content, previous = null, previousFlexible = false) {
    const raw = typeof frame === 'string' ? frame : frame?.base;
    const styles = typeof frame === 'object' ? frame?.styles ?? {} : {};
    const isRow = `${raw ?? ''}`.toLowerCase().startsWith('row');
    const isEnd = `${raw ?? ''}`.toLowerCase().includes('.end');
    const gap = Number(styles.spaceValue ?? 0);
    const fillsViewport = isRow
        ? ['100vw', '100%'].includes(`${styles.width ?? ''}`.toLowerCase())
        : ['100vh', '100%'].includes(`${styles.height ?? ''}`.toLowerCase());
    const useFlexibleLayout = Number(styles.flex ?? 0) > 0 || fillsViewport;
    const bounded = isRow ? 'constraints.hasBoundedWidth' : 'constraints.hasBoundedHeight';
    const currentNode = containerExpression(styles, alignedContent(styles, isRow, content));
    const own = useFlexibleLayout
        ? `if (${bounded}) Expanded(child: ${currentNode}) else ${currentNode}`
        : currentNode;
    const previousNode = previous && previousFlexible
        ? `if (${bounded}) Expanded(child: ${previous}) else ${previous}`
        : previous;
    const spacing = gap > 0 && previousNode
        ? `SizedBox(${isRow ? `width: ${gap}` : `height: ${gap}`})`
        : null;
    const ordered = isEnd
        ? ['if (widget.view != null) widget.view!', own, spacing, previousNode]
        : [previousNode, spacing, own, 'if (widget.view != null) widget.view!'];
    const children = ordered.filter(Boolean).join(', ');
    return `LayoutBuilder(builder: (context, constraints) => ${isRow ? 'Row' : 'Column'}(mainAxisSize: ${bounded} ? MainAxisSize.max : MainAxisSize.min, mainAxisAlignment: ${mainAxis(styles.justifyContent)}, crossAxisAlignment: ${crossAxis(styles.alignItems)}, children: [${children}]))`;
}

async function serviceImportAndStubs(data, specPath) {
    const names = collectLogicNames(data);
    if (!names.length) return '';
    const structure = specStructure(specPath, 'flutter');
    const servicePath = await ensureServiceFile({
        servicePath: structure.servicePath,
        legacyPath: structure.legacyServicePath,
        functions: names,
        template: 'flutter'
    });
    return `import '${relativeImport(generatedPath(specPath), servicePath)}';`;
}

function referencedWidgets(data, specPath) {
    const refs = {
        extend: referenceImport(specPath, getExtend(data)),
        left: referenceImport(specPath, getLeft(data)),
        right: referenceImport(specPath, getRight(data)),
        feed: referenceImport(specPath, getFeed(data))
    };
    const imports = [...new Map(Object.values(refs).filter(Boolean).map(item => [item.importPath, item])).values()]
        .map(item => `import '${item.importPath}';`)
        .join('\n');
    return {refs, imports};
}

function widgetInvocation(ref, extra = '') {
    if (!ref) return 'const SizedBox.shrink()';
    return `${ref.className}(loopIndex: widget.loopIndex, loopElement: widget.loopElement${extra})`;
}

function composeWithExtend(data, refs, ownBuilder) {
    const frame = getFrame(data);
    const stack = `${typeof frame === 'string' ? frame : frame?.base ?? ''}`.toLowerCase().includes('.stack');
    if (!refs.extend) return {content: ownBuilder(null), previous: null};
    if (stack) return {content: ownBuilder(widgetInvocation(refs.extend)), previous: null};
    const previous = widgetInvocation(refs.extend);
    const raw = typeof frame === 'string' ? frame : frame?.base;
    const bounded = `${raw ?? ''}`.toLowerCase().startsWith('row')
        ? 'constraints.hasBoundedWidth'
        : 'constraints.hasBoundedHeight';
    return {
        content: ownBuilder(null),
        previous: refs.extend.flexible
            ? `if (${bounded}) Expanded(child: ${previous}) else ${previous}`
            : previous,
    };
}

function stateMembers(data) {
    return Object.keys(getStates(data)).map(key => `late dynamic ${stateIdentifier(key)};`).join('\n  ');
}

function stateInitializers(data) {
    return Object.entries(getStates(data)).map(([key, value]) => `${stateIdentifier(key)} = ${valueExpression(value)};`).join('\n    ');
}

function stateModelName(specPath) {
    return `FastUI${specStructure(specPath, 'flutter').componentName}StateModel`;
}

function stateModelExpression(data, specPath) {
    const fields = Object.keys(getStates(data)).map(key => `${dartIdentifier(key)}: ${stateIdentifier(key)}`).join(', ');
    return `${stateModelName(specPath)}(${fields})`;
}

function stateStoreMembers(data, specPath) {
    if (Object.keys(getStates(data)).length === 0) return '';
    const mutationTargets = new Set();
    const collectTargets = value => {
        if (Array.isArray(value)) return value.forEach(collectTargets);
        if (!value || typeof value !== 'object') return;
        if (value.action === 'state.set' && value.target) mutationTargets.add(value.target);
        Object.values(value).forEach(collectTargets);
    };
    collectTargets(data);
    if (collectLogicNames(data).length > 0) Object.keys(getStates(data)).forEach(key => mutationTargets.add(key));
    const setters = [...mutationTargets].filter(key => key in getStates(data)).map(key => {
        const field = stateIdentifier(key);
        return `void _set${firstUpperCase(field)}(dynamic value) {\n    setState(() => ${field} = value);\n    _publishState();\n  }`;
    }).join('\n\n  ');
    return `late final String _storeId;\n\n  void _publishState() => moduleStore.set<${stateModelName(specPath)}>(_storeId, ${stateModelExpression(data, specPath)});\n\n  ${setters}`;
}

function contextMembers(data, inputs) {
    const stateEntries = Object.keys(getStates(data)).flatMap(key => [
        `${dartString(key)}: ${stateIdentifier(key)}`,
        `${dartString(`set${firstUpperCase(key)}`)}: (dynamic value) => _set${firstUpperCase(stateIdentifier(key))}(value)`
    ]);
    const inputEntries = inputs.filter(input => input !== 'view').map(input => `${dartString(input)}: widget.${input}`);
    return `Map<String, dynamic> _componentContext(BuildContext context, [dynamic argument]) => {\n    'context': context,\n    'states': {${stateEntries.join(', ')}},\n    'inputs': {${inputEntries.join(', ')}},\n    'args': argument == null ? <dynamic>[] : <dynamic>[argument],\n  };`;
}

function effectsInit(data) {
    return Object.values(getEffects(data)).map(effect => {
        const body = effect?.body;
        return typeof body === 'string' && /^(?:logics|services)\./i.test(body) ? `${logicCall(body)};` : '';
    }).filter(Boolean).join('\n    ');
}

async function writeWidget({data, specPath, buildExpression}) {
    const outputPath = generatedPath(specPath);
    const name = classNameFromPath(specPath);
    const inputs = collectInputs(data);
    const hasLogic = collectLogicNames(data).length > 0;
    const behavior = analyzeBehavior(data);
    const {refs, imports} = referencedWidgets(data, specPath);
    refs.extend = await addReferenceLayout(refs.extend);
    const serviceImport = await serviceImportAndStubs(data, specPath);
    const runtimePath = resolve(flutterLibRoot(specPath), 'fastui_runtime.dart');
    await ensureFileExist(runtimePath);
    if ((await readFile(runtimePath)).toString().trim() === '') await writeFile(runtimePath, flutterRuntimeSource());
    let runtimeImportPath = relative(dirname(outputPath), runtimePath).split(sep).join('/');
    if (!runtimeImportPath.startsWith('.')) runtimeImportPath = `./${runtimeImportPath}`;
    const constructorFields = inputs.map(input => `this.${input}`).join(', ');
    const fieldDeclarations = inputs.map(input => `final dynamic ${input};`).join('\n  ');
    const stateFields = stateMembers(data);
    const hasState = Object.keys(getStates(data)).length > 0;
    const structure = specStructure(specPath, 'flutter');
    const storeImport = hasState
        ? `import '${relativeImport(outputPath, structure.storePath)}';\nimport '${relativeImport(outputPath, structure.storeModelsPath)}';`
        : '';
    const storeMembers = stateStoreMembers(data, specPath);
    const init = stateInitializers(data);
    const effects = effectsInit(data);
    const composition = buildExpression(refs);
    const runtimeImport = (`${data?.base}`.toLowerCase() === 'image' || behavior.hasNavigation) ? `import '${runtimeImportPath}';` : '';
    const contextSource = hasLogic ? contextMembers(data, inputs) : '';
    const storeComponentName = structure.componentName;
    const stateful = `class ${name} extends StatefulWidget {\n  const ${name}({super.key, ${constructorFields}});\n\n  ${fieldDeclarations}\n\n  @override\n  State<${name}> createState() => _${name}State();\n}\n\nclass _${name}State extends State<${name}> {\n  ${stateFields}\n  ${storeMembers}\n\n  @override\n  void initState() {\n    super.initState();\n    ${hasState ? `_storeId = '${storeComponentName}:\${identityHashCode(this)}';` : ''}\n    ${init}\n    ${hasState ? '_publishState();' : ''}\n    ${effects}\n  }\n\n  ${hasState ? `@override\n  void dispose() {\n    moduleStore.remove<${stateModelName(specPath)}>(_storeId);\n    super.dispose();\n  }` : ''}\n\n  ${contextSource}\n\n  @override\n  Widget build(BuildContext context) {\n    final content = ${composition.content};\n    return ${frameExpression(getFrame(data), 'content', composition.previous)};\n  }\n}`;
    const stateless = `class ${name} extends StatelessWidget {\n  const ${name}({super.key, ${constructorFields}});\n\n  ${fieldDeclarations}\n  ${name} get widget => this;\n\n  ${contextSource}\n\n  @override\n  Widget build(BuildContext context) {\n    final content = ${composition.content};\n    return ${frameExpression(getFrame(data), 'content', composition.previous)};\n  }\n}`;
    const blurImport = JSON.stringify(data).includes('backdropFilter') ? "import 'dart:ui' as ui;" : '';
    const content = `import 'package:flutter/material.dart';\n${blurImport}\n${runtimeImport}\n${imports}\n${storeImport}\n${serviceImport}\n\n${behavior.requiresFlutterStatefulWidget ? stateful : stateless}\n`;
    await ensurePathExist(dirname(outputPath));
    await writeFile(outputPath, content.replace(/^\s+$/gm, ''));
}

export async function composeFlutterComponent({data, path: specPath}) {
    if (!data) return;
    await writeWidget({
        data,
        specPath,
        buildExpression: refs => composeWithExtend(data, refs, nested => componentBody(data, nested))
    });
}

export async function composeFlutterCondition({data, path: specPath}) {
    if (!data) return;
    await writeWidget({
        data,
        specPath,
        buildExpression: refs => composeWithExtend(data, refs, nested => {
            const left = widgetInvocation(refs.left);
            const right = widgetInvocation(refs.right);
            const branch = refs.right ? `(${stateIdentifier('condition')} == true ? ${right} : ${left})` : left;
            return applyInteractions(data, containerExpression(getStyles(data), nested ? `Stack(children: [${branch}, ${nested}])` : branch));
        })
    });
}

export async function composeFlutterLoop({data, path: specPath}) {
    if (!data) return;
    data = {...data, modifier: {...data.modifier, states: {data: [], ...data.modifier?.states}}};
    await writeWidget({
        data,
        specPath,
        buildExpression: refs => composeWithExtend(data, refs, nested => {
            const feed = refs.feed
                ? `${refs.feed.className}(loopIndex: index, loopElement: item)`
                : 'const SizedBox.shrink()';
            const list = `Column(mainAxisSize: MainAxisSize.min, children: List<dynamic>.from(${stateIdentifier('data')} ?? const []).asMap().entries.map((entry) { final index = entry.key; final item = entry.value; return ${feed}; }).toList())`;
            return applyInteractions(data, containerExpression(getStyles(data), nested ? `Stack(children: [${list}, ${nested}])` : list));
        })
    });
}

export function flutterRuntimeSource() {
    return flutterRuntimeSourceV2();

    /* c8 ignore start -- legacy runtime retained for generated-project compatibility */
    return `import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

typedef FastUISurfaceBuilder = Widget Function();

class FastUINavigation {
  FastUINavigation._();

  static Map<String, FastUISurfaceBuilder> _surfaces = const {};

  static void configure(Map<String, FastUISurfaceBuilder> surfaces) {
    _surfaces = surfaces;
  }

  static Widget surface(String name, {bool expand = false}) {
    final child = _surfaces[name]?.call() ?? const SizedBox.shrink();
    final material = Material(type: MaterialType.transparency, child: child);
    return expand ? SizedBox.expand(child: material) : material;
  }

  static Future<T?> navigate<T>(
    BuildContext context, {
    String? name,
    String type = 'page',
    bool replace = false,
    String? transition,
    String? direction,
    int durationMs = 300,
    bool barrierDismissible = false,
  }) async {
    final navigator = Navigator.of(context, rootNavigator: true);
    final normalizedType = type == 'bottom_sheet' ? 'sheet' : type;
    if (normalizedType == 'close' || normalizedType == 'back') {
      if (navigator.canPop()) navigator.pop<T>();
      return null;
    }
    if (name == null || !_surfaces.containsKey(name)) return null;

    final currentIsOverlay = ModalRoute.of(context) is PopupRoute;
    if (currentIsOverlay && (replace || normalizedType == 'page' || normalizedType == 'dialog' || normalizedType == 'sheet')) {
      navigator.pop();
      await Future<void>.delayed(Duration.zero);
      if (!navigator.mounted) return null;
    }

    if (normalizedType == 'sheet') {
      return showModalBottomSheet<T>(
        context: navigator.context,
        useRootNavigator: true,
        isScrollControlled: true,
        useSafeArea: true,
        isDismissible: barrierDismissible,
        enableDrag: barrierDismissible,
        backgroundColor: Colors.transparent,
        builder: (_) => surface(name),
      );
    }

    final duration = Duration(milliseconds: durationMs);
    if (normalizedType == 'dialog') {
      return showGeneralDialog<T>(
        context: navigator.context,
        useRootNavigator: true,
        barrierDismissible: barrierDismissible,
        barrierLabel: barrierDismissible ? 'Dismiss' : null,
        barrierColor: Colors.transparent,
        transitionDuration: duration,
        pageBuilder: (context, animation, secondaryAnimation) => surface(name),
        transitionBuilder: (context, animation, secondaryAnimation, child) => _transition(animation, child, transition, direction),
      );
    }

    final route = PageRouteBuilder<T>(
      settings: RouteSettings(name: '/$name'),
      transitionDuration: duration,
      pageBuilder: (context, animation, secondaryAnimation) => surface(name, expand: true),
      transitionsBuilder: (context, animation, secondaryAnimation, child) => _transition(animation, child, transition, direction),
    );
    return replace
        ? navigator.pushReplacement<T, dynamic>(route)
        : navigator.push<T>(route);
  }

  static Widget _transition(Animation<double> animation, Widget child, String? transition, String? direction) {
    final kind = (transition ?? '').toUpperCase();
    if (kind.contains('MOVE') || kind.contains('SLIDE') || kind.contains('PUSH')) {
      final begin = switch ((direction ?? '').toUpperCase()) {
        'RIGHT' => const Offset(-1, 0),
        'TOP' => const Offset(0, 1),
        'BOTTOM' => const Offset(0, -1),
        _ => const Offset(1, 0),
      };
      return SlideTransition(position: Tween<Offset>(begin: begin, end: Offset.zero).animate(animation), child: child);
    }
    return FadeTransition(opacity: animation, child: child);
  }
}

class FastUIImage extends StatelessWidget {
  const FastUIImage({super.key, required this.source, this.width, this.height, this.fit});

  final String source;
  final double? width;
  final double? height;
  final BoxFit? fit;

  @override
  Widget build(BuildContext context) {
    final normalizedSource = source.replaceFirst(RegExp(r'^asset://figma/'), 'assets/images/figma/');
    final isSvg = Uri.tryParse(normalizedSource)?.path.toLowerCase().endsWith('.svg') == true;
    if (normalizedSource.startsWith('http://') || normalizedSource.startsWith('https://')) {
      if (isSvg) return SvgPicture.network(normalizedSource, width: width, height: height, fit: fit ?? BoxFit.contain);
      return Image.network(normalizedSource, width: width, height: height, fit: fit);
    }
    if (isSvg) return SvgPicture.asset(normalizedSource.replaceFirst(RegExp(r'^/'), ''), width: width, height: height, fit: fit ?? BoxFit.contain);
    return Image.asset(normalizedSource.replaceFirst(RegExp(r'^/'), ''), width: width, height: height, fit: fit);
  }
}
`;
    /* c8 ignore stop */
}
