import {readFile, writeFile} from 'node:fs/promises';
import {dirname, relative, resolve, sep} from 'node:path';
import {ensureFileExist, ensurePathExist} from '../../../shared/fs.mjs';
import {firstUpperCase} from '../../../shared/fn.mjs';
import {
    getChildren,
    getEffects,
    getExtendList,
    getFeed,
    getFrame,
    getLeft,
    getProps,
    getRight,
    getStates,
    getStyles,
    parseLogicReference,
} from '../../modifier.mjs';
import {analyzeBehavior} from '../../behavior.mjs';
import {flutterRuntimeSource} from './runtime.mjs';
import {ensureServiceFile, relativeImport, specStructure} from '../../project-structure.mjs';

export {flutterRuntimeSource};

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

const classNameFromPath = value => dartClassStem(value);

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

function flutterLogicCallExpression(value, contextRef = 'context') {
    const logic = parseLogicReference(value);
    if (!logic?.isCall) return null;
    const args = `${logic.argsSource ?? ''}`.trim() === '' ? 'const []' : `[${logic.argsSource}]`;
    return `${logic.name}(_componentContext(${contextRef}, ${args}))`;
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
    const found = new Set(['loopElement', 'loopIndex']);
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
        const logic = parseLogicReference(value);
        if (logic) {
            found.add(dartIdentifier(logic.name));
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

// Named CSS colors mapped to hex equivalents for Flutter Color conversion
const CSS_NAMED_COLORS = {
    red: '#FF0000', blue: '#0000FF', green: '#008000', lime: '#00FF00',
    yellow: '#FFFF00', orange: '#FFA500', purple: '#800080', pink: '#FFC0CB',
    white: '#FFFFFF', black: '#000000', grey: '#808080', gray: '#808080',
    cyan: '#00FFFF', magenta: '#FF00FF', brown: '#A52A2A', teal: '#008080',
    navy: '#000080', maroon: '#800000', olive: '#808000', silver: '#C0C0C0',
    coral: '#FF7F50', salmon: '#FA8072', khaki: '#F0E68C', indigo: '#4B0082',
    violet: '#EE82EE', turquoise: '#40E0D0', beige: '#F5F5DC', gold: '#FFD700',
};

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
    if (value.trim().toLowerCase() === 'transparent') return 'const Color(0x00000000)';
    // Resolve named CSS colors to their hex equivalents
    const namedHex = CSS_NAMED_COLORS[value.trim().toLowerCase()];
    if (namedHex) return colorExpression(namedHex);
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
    const left = parsePxValue(styles[`${prefix}Left`] ?? shorthandLeft ?? 0);
    const top = parsePxValue(styles[`${prefix}Top`] ?? shorthandTop ?? 0);
    const right = parsePxValue(styles[`${prefix}Right`] ?? shorthandRight ?? 0);
    const bottom = parsePxValue(styles[`${prefix}Bottom`] ?? shorthandBottom ?? 0);
    if (![left, top, right, bottom].some(v => Number.isFinite(v) && v !== 0)) return null;
    return `EdgeInsets.fromLTRB(${left || 0}, ${top || 0}, ${right || 0}, ${bottom || 0})`;
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

/** Parses a CSS length value, stripping optional 'px' suffix, to a finite number or NaN. */
function parsePxValue(value) {
    if (Number.isFinite(Number(value))) return Number(value);
    if (typeof value === 'string') {
        const n = Number(value.replace(/px$/i, ''));
        return Number.isFinite(n) ? n : NaN;
    }
    return NaN;
}

function dimensionExpression(value, axis) {
    if (Number.isFinite(Number(value))) return `${Number(value)}`;
    if (typeof value === 'string') {
        const num = Number(value.replace(/px$/i, ''));
        if (Number.isFinite(num)) return `${num}`;
    }
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

/** Parses a CSS box-shadow string "x y blur? spread? color?" into a BoxShadow expression. */
function boxShadowExpression(styles) {
    const raw = `${styles.boxShadow ?? ''}`.trim();
    if (!raw || raw === 'none') return null;
    const colorMatch = raw.match(/rgba?\([^)]+\)|#[0-9a-f]{3,8}/i);
    const color = colorMatch ? colorExpression(colorMatch[0]) : null;
    const cleaned = raw
        .replace(/rgba?\([^)]+\)/i, '')
        .replace(/#[0-9a-f]{3,8}/i, '')
        .trim();
    const nums = cleaned.split(/\s+/).map(v => parsePxValue(v)).filter(Number.isFinite);
    if (nums.length < 2) return null;
    const [dx, dy, blur = 0, spread = 0] = nums;
    const colorArg = color ? `, color: ${color}` : '';
    return `BoxShadow(offset: Offset(${dx}, ${dy}), blurRadius: ${blur}, spreadRadius: ${spread}${colorArg})`;
}

/** Wraps a widget expression in Opacity when opacity < 1. */
function applyOpacityWrap(styles, child) {
    const opacity = parsePxValue(styles.opacity);
    if (!Number.isFinite(opacity) || opacity >= 1) return child;
    return `Opacity(opacity: ${Math.max(0, Math.min(1, opacity)).toFixed(4)}, child: ${child})`;
}

/** Wraps a widget expression in ClipRRect/ClipRect when overflow is hidden/clip. */
function applyOverflowClip(styles, child) {
    const overflow = `${styles.overflow ?? styles.overflowX ?? ''}`.toLowerCase();
    if (overflow !== 'hidden' && overflow !== 'clip') return child;
    const radius = borderRadius(styles);
    return radius
        ? `ClipRRect(borderRadius: ${radius}, child: ${child})`
        : `ClipRect(child: ${child})`;
}

/** Wraps a widget expression in ConstrainedBox when min/max dimensions are set. */
function applyConstraintBox(styles, child) {
    const minW = parsePxValue(styles.minWidth);
    const maxW = parsePxValue(styles.maxWidth);
    const minH = parsePxValue(styles.minHeight);
    const maxH = parsePxValue(styles.maxHeight);
    if (!Number.isFinite(minW) && !Number.isFinite(maxW) && !Number.isFinite(minH) && !Number.isFinite(maxH)) return child;
    const parts = [
        Number.isFinite(minW) ? `minWidth: ${minW}` : '',
        Number.isFinite(maxW) ? `maxWidth: ${maxW}` : '',
        Number.isFinite(minH) ? `minHeight: ${minH}` : '',
        Number.isFinite(maxH) ? `maxHeight: ${maxH}` : '',
    ].filter(Boolean).join(', ');
    return `ConstrainedBox(constraints: BoxConstraints(${parts}), child: ${child})`;
}

function containerExpression(styles = {}, child = 'null', {loosenChildAxis = null} = {}) {
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
    // Accept 'background' as a CSS shorthand alias for 'backgroundColor'
    const color = colorExpression(styles.backgroundColor ?? styles.background);
    if (color) decoration.push(`color: ${color}`);
    const image = backgroundImage(styles);
    if (image) decoration.push(`image: ${image}`);
    const radius = borderRadius(styles);
    if (radius) decoration.push(`borderRadius: ${radius}`);
    const borderColor = colorExpression(styles.borderColor);
    const borderWidth = Number(styles.borderTopWidth ?? styles.borderWidth ?? 0);
    if (borderColor && borderWidth > 0) decoration.push(`border: Border.all(color: ${borderColor}, width: ${borderWidth})`);
    if (decoration.length) args.push(`decoration: BoxDecoration(${decoration.join(', ')})`);
    // Expanded supplies a tight constraint on its main axis. Align loosens that
    // constraint for a fixed-size child, while the cross-axis factor keeps the
    // wrapper at the child's height (Row) or width (Column), matching CSS flex.
    const resolvedChild = loosenChildAxis === 'horizontal'
        ? `Align(alignment: Alignment.topLeft, heightFactor: 1, child: ${child})`
        : loosenChildAxis === 'vertical'
            ? `Align(alignment: Alignment.topLeft, widthFactor: 1, child: ${child})`
            : child;
    if (child !== 'null') args.push(`child: ${resolvedChild}`);
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
    const children = getChildren(data);
    const rawChildren = data?.modifier?.props?.children ?? '';
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
    const expression = children?.type === 'logic'
        ? flutterLogicCallExpression(children?.value)
        : valueExpression(rawChildren);
    const nullable = children?.type === 'state' || children?.type === 'input';
    const alignment = {
        start: 'start',
        left: 'left',
        center: 'center',
        end: 'end',
        right: 'right'
    }[`${styles.textAlign ?? ''}`.toLowerCase()];
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
        : undefined;
    const args = [
        action?.name ? `name: ${dartString(`${action.name}`.replace(/^\/+|\/+$/g, ''))}` : '',
        `type: ${dartString(action?.type ?? 'page')}`,
        action?.replace ? 'replace: true' : '',
        transition?.type ? `transition: ${dartString(transition.type)}` : '',
        transition?.direction ? `direction: ${dartString(transition.direction)}` : '',
        durationMs === undefined ? '' : `durationMs: ${durationMs}`,
        action?.barrierDismissible === undefined ? '' : `barrierDismissible: ${action.barrierDismissible === true}`
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

function hasMeaningfulStyles(styles = {}) {
    return Object.entries(styles).some(([, value]) => value !== undefined && value !== null);
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

function widgetIdExpression(data, isStateClass = false) {
    const props = getProps(data);
    const overridePropsRef = isStateClass ? 'widget.overrideProps' : 'overrideProps';
    if (props.id === undefined || props.id === null || props.id === '') {
        return `${overridePropsRef}['id']`;
    }
    return `${overridePropsRef}['id'] ?? ${valueExpression(props.id)}`;
}

function componentHasPlaceholderOwnView(data) {
    const base = `${data?.base ?? 'container'}`.toLowerCase();
    const children = getChildren(data);
    const props = getProps(data);
    const ownProps = Object.fromEntries(Object.entries(props).filter(([key, value]) => value !== undefined && value !== null && !['id', 'onClick', 'children', 'control', 'scroll'].includes(key)));
    return (base === 'container' || base === 'div')
        && !hasMeaningfulStyles(getStyles(data))
        && !`${children?.value ?? ''}`.trim()
        && Object.keys(ownProps).length === 0;
}

function componentBody(data) {
    const base = `${data?.base ?? 'container'}`.toLowerCase();
    if (base === 'text') {
        const styles = getStyles(data);
        const baseStyleLiteral = dartLiteral(styles);
        return `_buildWithOverride(${baseStyleLiteral}, child: ${textExpression(data)})`;
    }
    if (base === 'image') return imageExpression(data);
    if (base === 'input' || (base === 'container' && data?.modifier?.props?.control === 'input')) return inputExpression(data);
    if (componentHasPlaceholderOwnView(data)) return 'const SizedBox.shrink()';

    const styles = getStyles(data);
    const baseStyleLiteral = dartLiteral(styles);
    const children = getChildren(data);
    let childArg = '';
    if (children?.value !== undefined && children.value !== '' && children.value !== null) {
        let childExpr;
        if (children.type === 'state') {
            childExpr = `Text((${stateIdentifier(children.value)} ?? '').toString())`;
        } else if (children.type === 'input') {
            childExpr = `Text((widget.${dartIdentifier(children.value)} ?? '').toString())`;
        } else if (children.type === 'logic') {
            childExpr = `Text((${flutterLogicCallExpression(children.value)}).toString())`;
        } else {
            childExpr = `Text(${dartString(children.value)})`;
        }
        childArg = `, child: ${childExpr}`;
    }
    const body = `_buildWithOverride(${baseStyleLiteral}${childArg})`;
    return applyInteractions(data, body);
}

function mainAxis(value) {
    const map = {
        center: 'center',
        'flex-end': 'end',
        'space-between': 'spaceBetween',
        'space-around': 'spaceAround',
        'space-evenly': 'spaceEvenly'
    };
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

function isFlexibleFrame(styles = {}, isRow) {
    return Number(styles.flex ?? 0) > 0 || fillsAxis(styles[isRow ? 'width' : 'height'], isRow ? 'width' : 'height');
}

/**
 * Renders the top-down composition for one primitive: this node's own view
 * (wrapped by `frame.current`) plus one wrapper per `modifier.extend` child
 * (wrapped uniformly by `frame.next`), ordered and arranged per `frame.base`
 * (row.start/row.end/column.start/column.end/*.stack). Without extend
 * children, `frame.base` has nothing to arrange, so only the current view is
 * returned.
 * @param frame {{base,current,next}}
 * @param ownContentExpr {string} Dart expression for this node's own content
 * @param extendRefs {{className:string}[]} ordered extend widget references
 * @return {string}
 */
const LAYOUT_ONLY_KEYS = new Set(['spaceValue', 'justifyContent', 'alignItems', 'flexDirection', 'flex', 'fallbackWidth', 'fallbackHeight', 'childDirection']);

function stripLayoutKeys(styles) {
    return Object.fromEntries(Object.entries(styles).filter(([k]) => !LAYOUT_ONLY_KEYS.has(k)));
}

function ownExpressionIsEmpty(value) {
    return `${value ?? ''}`.trim() === 'const SizedBox.shrink()';
}

function applyScrollableArea(scroll, child) {
    if (scroll === 'both') {
        return `SingleChildScrollView(scrollDirection: Axis.horizontal, child: SingleChildScrollView(scrollDirection: Axis.vertical, child: ${child}))`;
    }
    if (scroll === 'horizontal') {
        return `SingleChildScrollView(scrollDirection: Axis.horizontal, child: ${child})`;
    }
    if (scroll === 'vertical') {
        return `SingleChildScrollView(scrollDirection: Axis.vertical, child: ${child})`;
    }
    return child;
}

function transformSize(width){
    if(Number.isNaN(Number(width))){
        if(width.endsWith('vw')){
            return 'MediaQuery.of(context).size.width';
        } if(width.endsWith('vh')){
            return 'MediaQuery.of(context).size.height';
        }else if(`${width}`.toLowerCase().endsWith('px')){
            return `${width}`.toLowerCase().replaceAll('px');
        }else {
            return null;
        }
    }else {
        return width;
    }
}

function composeFrame(data, frame, ownContentExpr, extendRefs = [], applyScroll = true) {
    const current = frame?.current ?? {};
    const base = frame?.base;
    const baseStyles = frame?.baseStyles ?? {};
    const isRow = `${base ?? ''}`.toLowerCase().startsWith('row');
    const next = frame?.next ?? {};
    const hasCurrentWrapper = hasMeaningfulStyles(current);
    const hasNextWrapper = hasMeaningfulStyles(next);
    const currentFlexible = hasCurrentWrapper && isFlexibleFrame(current, isRow);
    const nextFlexible = hasNextWrapper && isFlexibleFrame(next, isRow);
    const loosenChildAxis = isRow ? 'horizontal' : 'vertical';
    const currentWidget = hasCurrentWrapper
        ? containerExpression(current, alignedContent(current, isRow, ownContentExpr), {loosenChildAxis: currentFlexible ? loosenChildAxis : null})
        : ownContentExpr;
    const ownHasContent = hasCurrentWrapper || !ownExpressionIsEmpty(ownContentExpr);
    const nextWidgets = extendRefs.map(ref => {
        const child = widgetInvocation(ref);
        return hasNextWrapper
            ? containerExpression(next, child, {loosenChildAxis: nextFlexible ? loosenChildAxis : null})
            : child;
    });

    const hasBaseWrapper = Boolean(base)
        || hasMeaningfulStyles(baseStyles)
        || extendRefs.length > 0
        || hasCurrentWrapper;
    if (!hasBaseWrapper) return currentWidget;

    const baseContainerStyles = stripLayoutKeys(baseStyles);
    // console.log(baseStyles)
    // console.log(baseContainerStyles)
    const fillWidth = fillsAxis(baseStyles.width, 'width');
    const fillHeight = fillsAxis(baseStyles.height, 'height');
    const fallbackWidth = Number.isFinite(Number(baseStyles.fallbackWidth)) ? Number(baseStyles.fallbackWidth) : 0;
    const fallbackHeight = Number.isFinite(Number(baseStyles.fallbackHeight)) ? Number(baseStyles.fallbackHeight) : 0;

    const scroll = applyScroll ? data?.modifier?.props?.scroll : undefined;

    if (`${base ?? ''}`.toLowerCase().includes('.stack')) {
        const stackChildren = ownHasContent ? [currentWidget, ...nextWidgets] : nextWidgets;
        const stack = `Stack(children: [${stackChildren.join(', ')}])`;
        const wrapped = Object.keys(baseContainerStyles).length > 0 ? containerExpression(baseContainerStyles, stack) : stack;
        return applyScrollableArea(scroll, wrapped);
    }

    const isEnd = `${base ?? ''}`.toLowerCase().includes('.end');
    const bounded = isRow ? 'constraints.hasBoundedWidth' : 'constraints.hasBoundedHeight';
    const currentItem = ownHasContent
        ? (currentFlexible ? `if (${bounded}) Expanded(child: ${currentWidget}) else ${currentWidget}` : currentWidget)
        : null;
    const nextItems = nextWidgets.map(widget => nextFlexible ? `if (${bounded}) Expanded(child: ${widget}) else ${widget}` : widget);
    const orderedBase = isEnd
        ? [...nextItems, ...(currentItem ? [currentItem] : [])]
        : [...(currentItem ? [currentItem] : []), ...nextItems];

    if (orderedBase.length === 0) {
        const wrapped = Object.keys(baseContainerStyles).length > 0 ? containerExpression(baseContainerStyles) : 'const SizedBox.shrink()';
        return applyScrollableArea(scroll, wrapped);
    }

    const gap = Number(baseStyles.spaceValue);
    const spacer = gap > 0 ? `SizedBox(${isRow ? `width: ${gap}` : `height: ${gap}`})` : null;
    const ordered = spacer
        ? orderedBase.flatMap((item, index) => index === 0 ? [item] : [spacer, item])
        : orderedBase;

    const justifyContent = baseStyles.justifyContent;
    const alignItems = baseStyles.alignItems;
    // const {width: _w, height: _h, ...decorationStyles} = baseContainerStyles;
    const hasBaseContainerStyles = Object.keys(baseContainerStyles).length > 0;
    const buildRowCol = (boundedExpr) => {
        const ms = boundedExpr ?? bounded;
        return `${isRow ? 'Row' : 'Column'}(mainAxisSize: ${ms} ? MainAxisSize.max : MainAxisSize.min, mainAxisAlignment: ${mainAxis(justifyContent)}, crossAxisAlignment: ${crossAxis(alignItems)}, children: [${ordered.join(', ')}])`;
    };

    let rowCol;
    if (fillWidth || fillHeight) {
        const sizes = [
            fillWidth ? `width: constraints.hasBoundedWidth ? constraints.maxWidth : constraints.minWidth > ${fallbackWidth} ? constraints.minWidth : ${fallbackWidth}` : '',
            fillHeight ? `height: constraints.hasBoundedHeight ? constraints.maxHeight : constraints.minHeight > ${fallbackHeight} ? constraints.minHeight : ${fallbackHeight}` : '',
            `child: ${buildRowCol(isRow ? 'constraints.hasBoundedWidth' : 'constraints.hasBoundedHeight')}`,
        ].filter(Boolean).join(', ');
        rowCol = `LayoutBuilder(builder: (context, constraints) => SizedBox(${sizes}))`;
    } else {
        rowCol = `LayoutBuilder(builder: (context, constraints) => ${buildRowCol()})`;
    }

    if (hasBaseContainerStyles) {
        const contArgs = [];
        const decorArgs = [];
        const width = transformSize(baseContainerStyles?.width ?? null);
        const height = transformSize(baseContainerStyles?.height ?? null);
        // console.log(width, height);
        if(width)contArgs.push(`width: ${width}`);
        if(height)contArgs.push(`height: ${height}`);
        const padding = edgeInsets(baseContainerStyles, 'padding');
        const margin = edgeInsets(baseContainerStyles, 'margin');
        if (padding) decorArgs.push(`padding: ${padding}`);
        if (margin) decorArgs.push(`margin: ${margin}`);
        const decoList = [];
        const color = colorExpression(baseContainerStyles.backgroundColor ?? baseContainerStyles.background);
        if (color) decoList.push(`color: ${color}`);
        const radius = borderRadius(baseContainerStyles);
        if (radius) decoList.push(`borderRadius: ${radius}`);
        if (decoList.length) decorArgs.push(`decoration: BoxDecoration(${decoList.join(', ')})`);
        if(contArgs.length>0){decorArgs.push([contArgs.join(','),`child: ${rowCol}`]);}
        else {decorArgs.push(`child: ${rowCol}`);}
        // console.log(decorArgs);
        return applyScrollableArea(scroll, `Container(${decorArgs.join(', ')})`);
    }
    return applyScrollableArea(scroll, rowCol);
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
        extendList: getExtendList(data).map(path => referenceImport(specPath, path)).filter(Boolean),
        left: referenceImport(specPath, getLeft(data)),
        right: referenceImport(specPath, getRight(data)),
        feed: referenceImport(specPath, getFeed(data))
    };
    const allRefs = [...refs.extendList, refs.left, refs.right, refs.feed].filter(Boolean);
    const imports = [...new Map(allRefs.map(item => [item.importPath, item])).values()]
        .map(item => `import '${item.importPath}';`)
        .join('\n');
    return {refs, imports};
}

function widgetInvocation(ref, extra = '') {
    if (!ref) return 'const SizedBox.shrink()';
    return `${ref.className}(loopIndex: widget.loopIndex, loopElement: widget.loopElement${extra})`;
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
    return `Map<String, dynamic> _componentContext(BuildContext context, [dynamic argument]) => {\n    'context': context,\n    'states': {${stateEntries.join(', ')}},\n    'inputs': {${inputEntries.join(', ')}},\n    'args': argument == null ? <dynamic>[] : argument is List ? List<dynamic>.from(argument) : <dynamic>[argument],\n  };`;
}

function effectsInit(data) {
    return Object.values(getEffects(data)).map(effect => {
        const body = effect?.body;
        return typeof body === 'string' && /^(?:logics|services)\./i.test(body) ? `${logicCall(body)};` : '';
    }).filter(Boolean).join('\n    ');
}

function buildWithOverrideMethod(isStateClass = false) {
    const overrideRef = isStateClass ? 'widget.overrideStyles' : 'overrideStyles';
    // Delegate all CSS parsing to the shared FastUIStyleHelper in fastui_runtime.dart
    // so the generated widget stays clean and free of inline parser logic.
    return `Widget _buildWithOverride(Map<String, dynamic> baseStyles, {Widget? child}) =>
      FastUIStyleHelper.buildBox(baseStyles, ${overrideRef}, child: child);`;
}

function buildMetaMethod(data, isStateClass = false) {
    return `Widget _applyMeta(Widget child) =>
      FastUIStyleHelper.applyMeta(child, id: ${widgetIdExpression(data, isStateClass)});`;
}

async function writeWidget({data, specPath, buildExpression}) {
    const outputPath = generatedPath(specPath);
    const name = classNameFromPath(specPath);
    const inputs = collectInputs(data);
    const hasLogic = collectLogicNames(data).length > 0;
    const behavior = analyzeBehavior(data);
    const {refs, imports} = referencedWidgets(data, specPath);
    const serviceImport = await serviceImportAndStubs(data, specPath);
    const runtimePath = resolve(flutterLibRoot(specPath), 'fastui_runtime.dart');
    await ensureFileExist(runtimePath);
    if ((await readFile(runtimePath)).toString().trim() === '') await writeFile(runtimePath, flutterRuntimeSource());
    let runtimeImportPath = relative(dirname(outputPath), runtimePath).split(sep).join('/');
    if (!runtimeImportPath.startsWith('.')) runtimeImportPath = `./${runtimeImportPath}`;
    const overrideParams = `this.overrideStyles = const {}, this.overrideProps = const {}, this.overrideStates = const {}`;
    const constructorFields = [...inputs.map(input => `this.${input}`), overrideParams].join(', ');
    const fieldDeclarations = [
        ...inputs.map(input => `final dynamic ${input};`),
        `final Map<String, dynamic> overrideStyles;`,
        `final Map<String, dynamic> overrideProps;`,
        `final Map<String, dynamic> overrideStates;`,
    ].join('\n  ');
    const stateFields = stateMembers(data);
    const hasState = Object.keys(getStates(data)).length > 0;
    const structure = specStructure(specPath, 'flutter');
    const storeImport = hasState
        ? `import '${relativeImport(outputPath, structure.storePath)}';
import '${relativeImport(outputPath, structure.storeModelsPath)}';`
        : '';
    const storeMembers = stateStoreMembers(data, specPath);
    const stateInit = hasState
        ? Object.entries(getStates(data)).map(([key, value]) =>
            // Must use widget.overrideStates inside a StatefulWidget's State class.
            `${stateIdentifier(key)} = (widget.overrideStates[${dartString(key)}] ?? ${valueExpression(value)}) as dynamic;`
        ).join('\n    ')
        : stateInitializers(data);
    const effects = effectsInit(data);
    const ownContent = buildExpression(refs);
    const composedFrame = composeFrame(data, getFrame(data), ownContent, refs.extendList, !refs.feed);
    const composedContent = ownExpressionIsEmpty(ownContent) ? applyInteractions(data, composedFrame) : composedFrame;
    const usesOverrideContainer = composedContent.includes('_buildWithOverride(');
    const usesMeta = getProps(data).id !== undefined && getProps(data).id !== null && getProps(data).id !== '';
    // Import the runtime for style helpers, identity/meta helpers, images, or navigation.
    const runtimeImport = (usesOverrideContainer || usesMeta || `${data?.base}`.toLowerCase() === 'image' || behavior.hasNavigation) ? `import '${runtimeImportPath}';` : '';
    const contextSource = hasLogic ? contextMembers(data, inputs) : '';
    const storeComponentName = structure.componentName;
    const overrideHelperStateful = usesOverrideContainer ? `\n\n  ${buildWithOverrideMethod(true)}` : '';
    const overrideHelperStateless = usesOverrideContainer ? `\n\n  ${buildWithOverrideMethod(false)}` : '';
    const metaHelperStateful = usesMeta ? `\n\n  ${buildMetaMethod(data, true)}` : '';
    const metaHelperStateless = usesMeta ? `\n\n  ${buildMetaMethod(data, false)}` : '';
    const buildReturnStateful = usesMeta ? `_applyMeta(${composedContent})` : composedContent;
    const buildReturnStateless = usesMeta ? `_applyMeta(${composedContent})` : composedContent;
    const stateful = `class ${name} extends StatefulWidget {\n  const ${name}({super.key, ${constructorFields}});\n\n  ${fieldDeclarations}\n\n  @override\n  State<${name}> createState() => _${name}State();\n}\n\nclass _${name}State extends State<${name}> {\n  ${stateFields}\n  ${storeMembers}\n\n  @override\n  void initState() {\n    super.initState();\n    ${hasState ? `_storeId = '${storeComponentName}:\${identityHashCode(this)}';` : ''}\n    ${stateInit}\n    ${hasState ? '_publishState();' : ''}\n    ${effects}\n  }\n\n  ${hasState ? `@override\n  void dispose() {\n    moduleStore.remove<${stateModelName(specPath)}>(_storeId);\n    super.dispose();\n  }` : ''}\n\n  ${contextSource}${overrideHelperStateful}${metaHelperStateful}\n\n  @override\n  Widget build(BuildContext context) {\n    return ${buildReturnStateful};\n  }\n}`;
    const stateless = `class ${name} extends StatelessWidget {\n  const ${name}({super.key, ${constructorFields}});\n\n  ${fieldDeclarations}\n  ${name} get widget => this;\n\n  ${contextSource}${overrideHelperStateless}${metaHelperStateless}\n\n  @override\n  Widget build(BuildContext context) {\n    return ${buildReturnStateless};\n  }\n}`;
    const blurImport = JSON.stringify(data).includes('backdropFilter') ? "import 'dart:ui' as ui;" : '';
    const content = `import 'package:flutter/material.dart';\n${blurImport}\n${runtimeImport}\n${imports}\n${storeImport}\n${serviceImport}\n\n${behavior.requiresFlutterStatefulWidget ? stateful : stateless}\n`;
    await ensurePathExist(dirname(outputPath));
    await writeFile(outputPath, content.replace(/^\s+$/gm, ''));
}

/**
 * Generates a thin Dart widget that wraps the base component referenced by
 * `data.__specBase`, forwarding local modifier overrides as named parameters
 * `overrideStyles`, `overrideProps`, and `overrideStates`. The base widget
 * is responsible for accepting and merging those overrides.
 */
async function composeFlutterSpecBaseWrapper({data, specPath}) {
    const outputPath = generatedPath(specPath);
    const name = classNameFromPath(specPath);
    const baseClass = classNameFromPath(data.__specBase);
    let baseImportPath = relative(dirname(outputPath), generatedPath(data.__specBase)).split(sep).join('/');
    if (!baseImportPath.startsWith('.')) baseImportPath = `./${baseImportPath}`;
    const overrideStyles = dartLiteral(getStyles(data));
    const overrideProps = dartLiteral(
        Object.fromEntries(Object.entries(getProps(data)).filter(([, v]) => v !== undefined && v !== null))
    );
    const overrideStates = dartLiteral(getStates(data));
    const inputs = collectInputs(data);
    const constructorFields = inputs.map(input => `this.${input}`).join(', ');
    const fieldDeclarations = inputs.map(input => `final dynamic ${input};`).join('\n  ');
    const content = `import 'package:flutter/material.dart';
    import '${baseImportPath}';
    
    class ${name} extends StatelessWidget {
      const ${name}({super.key, ${constructorFields}});
        
      ${fieldDeclarations}
          
      @override
        Widget build(BuildContext context) {
            return ${baseClass}(
                  loopIndex: loopIndex,
                  loopElement: loopElement,
                  overrideStyles: ${overrideStyles},
                  overrideProps: ${overrideProps},
                  overrideStates: ${overrideStates},
            );
      }
    }`;
    await ensurePathExist(dirname(outputPath));
    await writeFile(outputPath, content);
}

export async function composeFlutterComponent({data, path: specPath}) {
    if (!data) return;
    if (data.__specBase) {
        return composeFlutterSpecBaseWrapper({data, specPath});
    }
    await writeWidget({
        data,
        specPath,
        buildExpression: () => componentBody(data)
    });
}

export async function composeFlutterCondition({data, path: specPath}) {
    if (!data) return;
    await writeWidget({
        data,
        specPath,
        buildExpression: refs => {
            if (!refs.left && !refs.right && !hasMeaningfulStyles(getStyles(data))) return 'const SizedBox.shrink()';
            const left = widgetInvocation(refs.left);
            const right = widgetInvocation(refs.right);
            const branch = refs.right ? `(${stateIdentifier('condition')} == true ? ${right} : ${left})` : left;
            return applyInteractions(data, containerExpression(getStyles(data), branch));
        }
    });
}

export async function composeFlutterLoop({data, path: specPath}) {
    if (!data) return;
    data = {...data, modifier: {...data.modifier, states: {data: [], ...data.modifier?.states}}};
    await writeWidget({
        data,
        specPath,
        buildExpression: refs => {
            if (!refs.feed && !hasMeaningfulStyles(getStyles(data))) return 'const SizedBox.shrink()';
            const feed = refs.feed
                ? `${refs.feed.className}(loopIndex: index, loopElement: item)`
                : 'const SizedBox.shrink()';
            const items = `List<dynamic>.from(${stateIdentifier('data')} ?? const [])`;
            const frame = getFrame(data);
            // Derive axis from frame.base so the list direction matches the layout.
            const frameBase = `${frame?.base ?? ''}`.toLowerCase();
            const isRow = frameBase.startsWith('row');
            const scroll = data?.modifier?.props?.scroll;
            const fallbackHeight = Number(frame?.baseStyles?.fallbackHeight ?? getStyles(data)?.fallbackHeight ?? getStyles(data)?.height ?? 240) || 240;
            const horizontalList = `LayoutBuilder(builder: (context, constraints) { final double listHeight = constraints.hasBoundedHeight ? constraints.maxHeight.toDouble() : ${Number(fallbackHeight).toFixed(1)}; return SizedBox(height: listHeight, child: ListView.builder(scrollDirection: Axis.horizontal, shrinkWrap: true, primary: false, itemCount: ${items}.length, itemBuilder: (context, index) { final item = ${items}[index]; return ${feed}; })); })`;
            const verticalList = `ListView.builder(scrollDirection: Axis.vertical, shrinkWrap: true, primary: false, itemCount: ${items}.length, itemBuilder: (context, index) { final item = ${items}[index]; return ${feed}; })`;
            const list = scroll === 'vertical'
                ? verticalList
                : scroll === 'horizontal'
                    ? horizontalList
                    : scroll === 'both'
                        ? `SingleChildScrollView(scrollDirection: Axis.horizontal, child: ${verticalList})`
                        : isRow
                            ? horizontalList
                            : verticalList;
            return applyInteractions(data, containerExpression(getStyles(data), list));
        }
    });
}
