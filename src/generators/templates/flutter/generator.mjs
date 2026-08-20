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
import {referencedInputKeys} from '../../bindings.mjs';
import {flutterRuntimeSource} from './runtime.mjs';
import {ensureServiceFile, relativeImport, specStructure} from '../../project-structure.mjs';

export {flutterRuntimeSource};

const dartIdentifier = value => `${value ?? ''}`
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/^[^a-zA-Z_]/, '_$&');

const stateIdentifier = value => `state.${dartIdentifier(value)}`;

const providerIdentifier = specPath => {
    const name = specStructure(specPath, 'flutter').componentName;
    return `${name[0].toLowerCase()}${name.slice(1)}Provider`;
};

const notifierName = specPath => `FastUI${specStructure(specPath, 'flutter').componentName}Notifier`;

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

    return blueprintIndex >= 0
        ? parts.slice(0, blueprintIndex).join(sep) || sep
        : resolve('lib');
}

function dartString(value) {
    return `'${`${value ?? ''}`
        .replaceAll('\\', '\\\\')
        .replaceAll("'", "\\'")
        .replaceAll('$', '\\$')
        .replaceAll('\n', '\\n')}'`;
}

function dartLiteral(value) {
    if (value === null || value === undefined) {
        return 'null';
    }

    if (
        typeof value === 'boolean' ||
        typeof value === 'number'
    ) {
        return `${value}`;
    }

    if (Array.isArray(value)) {
        return `[${value.map(dartLiteral).join(', ')}]`;
    }

    if (typeof value === 'object') {
        return `{${Object.entries(value)
            .map(
                ([key, item]) =>
                    `${dartString(key)}: ${dartLiteral(item)}`
            )
            .join(', ')}}`;
    }

    return dartString(value);
}

function flutterLogicCallExpression(
    value,
    contextRef = 'context'
) {
    const logic = parseLogicReference(value);

    if (!logic) {
        return null;
    }

    const args =
        `${logic.argsSource ?? ''}`.trim() === ''
            ? 'const []'
            : `[${logic.argsSource}]`.replaceAll('$', '\\$');
    return `${logic.name}(_componentContext(${contextRef}, ref, ${args}))`;
}

function valueExpression(value) {
    const text = `${value ?? ''}`.trim();

    if (/^asset:\/\/figma\//i.test(text)) {
        return dartString(
            text.replace(
                /^asset:\/\/figma\//i,
                'assets/images/figma/'
            )
        );
    }

    if (/^states\./i.test(text)) {
        return stateIdentifier(
            text.replace(/^states\./i, '')
        );
    }

    if (/^inputs\.loopElement\./i.test(text)) {
        const key = text
            .replace(/^inputs\.loopElement\./i, '')
            .split('??')[0]
            .trim();

        const fallback = text.includes('??')
            ? valueExpression(
                text
                    .split('??')
                    .slice(1)
                    .join('??')
                    .trim()
            )
            : 'null';

        return `(widget.loopElement is Map ? widget.loopElement[${dartString(key)}] : null) ?? ${fallback}`;
    }

    if (/^inputs\./i.test(text)) {
        return `widget.${dartIdentifier(
            text.replace(/^inputs\./i, '')
        )}`;
    }

    return dartLiteral(value);
}

function collectInputs(data = {}) {
    const found = new Set([
        'loopElement',
        'loopIndex',
        ...referencedInputKeys(data),
    ]);
    return [...found].map(dartIdentifier);
}

function collectLogicNames(data = {}) {
    const found = new Set();

    const visit = value => {
        const logic = parseLogicReference(value);

        if (logic) {
            found.add(
                dartIdentifier(logic.name)
            );
        } else if (
            value &&
            typeof value === 'object'
        ) {
            Object.values(value).forEach(visit);
        }
    };

    visit(data);

    return [...found];
}

function referenceImport(
    specPath,
    reference
) {
    if (
        typeof reference !== 'string' ||
        !reference.endsWith('.yml')
    ) {
        return null;
    }

    const targetSpec = resolve(
        dirname(specPath),
        reference
    );

    const targetOutput =
        generatedPath(targetSpec);

    let importPath = relative(
        dirname(generatedPath(specPath)),
        targetOutput
    )
        .split(sep)
        .join('/');

    if (!importPath.startsWith('.')) {
        importPath = `./${importPath}`;
    }

    return {
        className: classNameFromPath(reference),
        importPath,
        targetSpec
    };
}


// -----------------------------------------------------------------------------
// COLORS
// -----------------------------------------------------------------------------

const CSS_NAMED_COLORS = {
    red: '#FF0000',
    blue: '#0000FF',
    green: '#008000',
    lime: '#00FF00',
    yellow: '#FFFF00',
    orange: '#FFA500',
    purple: '#800080',
    pink: '#FFC0CB',
    white: '#FFFFFF',
    black: '#000000',
    grey: '#808080',
    gray: '#808080',
    cyan: '#00FFFF',
    magenta: '#FF00FF',
    brown: '#A52A2A',
    teal: '#008080',
    navy: '#000080',
    maroon: '#800000',
    olive: '#808000',
    silver: '#C0C0C0',
    coral: '#FF7F50',
    salmon: '#FA8072',
    khaki: '#F0E68C',
    indigo: '#4B0082',
    violet: '#EE82EE',
    turquoise: '#40E0D0',
    beige: '#F5F5DC',
    gold: '#FFD700',
};

function colorExpression(value) {
    if (typeof value !== 'string') {
        return null;
    }

    const rgba = value.match(
        /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i
    );

    if (rgba) {
        const red = Math.max(
            0,
            Math.min(
                255,
                Math.round(Number(rgba[1]))
            )
        );

        const green = Math.max(
            0,
            Math.min(
                255,
                Math.round(Number(rgba[2]))
            )
        );

        const blue = Math.max(
            0,
            Math.min(
                255,
                Math.round(Number(rgba[3]))
            )
        );

        const opacity =
            Number.isFinite(Number(rgba[4]))
                ? Math.max(
                    0,
                    Math.min(
                        1,
                        Number(rgba[4])
                    )
                )
                : 1;

        return `Color.fromRGBO(${red}, ${green}, ${blue}, ${opacity})`;
    }

    const hex = value.match(
        /^#([0-9a-f]{6}|[0-9a-f]{8})$/i
    );

    if (hex) {
        const raw =
            hex[1].length === 6
                ? `FF${hex[1]}`
                : hex[1];

        return `Color(0x${raw.toUpperCase()})`;
    }

    if (
        value.trim().toLowerCase() ===
        'transparent'
    ) {
        return 'const Color(0x00000000)';
    }

    const namedHex =
        CSS_NAMED_COLORS[
            value.trim().toLowerCase()
            ];

    if (namedHex) {
        return colorExpression(namedHex);
    }

    return null;
}


// -----------------------------------------------------------------------------
// DIMENSIONS / CSS HELPERS
// -----------------------------------------------------------------------------

function parsePxValue(value) {
    if (
        Number.isFinite(Number(value))
    ) {
        return Number(value);
    }

    if (
        typeof value === 'string'
    ) {
        const n = Number(
            value.replace(
                /px$/i,
                ''
            )
        );

        return Number.isFinite(n)
            ? n
            : NaN;
    }

    return NaN;
}

function fillsAxis(
    value,
    axis
) {
    const normalized =
        `${value ?? ''}`
            .trim()
            .toLowerCase();

    return (
        normalized === '100%' ||
        (
            axis === 'width' &&
            normalized === '100vw'
        ) ||
        (
            axis === 'height' &&
            normalized === '100vh'
        )
    );
}

function transformSize(value) {
    if (
        value === null ||
        value === undefined
    ) {
        return null;
    }

    if (
        !Number.isNaN(
            Number(value)
        )
    ) {
        return `${Number(value)}`;
    }

    const normalized =
        `${value}`
            .trim()
            .toLowerCase();

    if (
        normalized.endsWith('vw')
    ) {
        const amount =
            Number(
                normalized.slice(
                    0,
                    -2
                )
            );

        if (
            !Number.isFinite(amount)
        ) {
            return null;
        }

        if (amount === 100) {
            return 'MediaQuery.of(context).size.width';
        }

        return `MediaQuery.of(context).size.width * ${Number(
            (amount / 100).toFixed(6)
        )}`;
    }

    if (
        normalized.endsWith('vh')
    ) {
        const amount =
            Number(
                normalized.slice(
                    0,
                    -2
                )
            );

        if (
            !Number.isFinite(amount)
        ) {
            return null;
        }

        if (amount === 100) {
            return 'MediaQuery.of(context).size.height';
        }

        return `MediaQuery.of(context).size.height * ${Number(
            (amount / 100).toFixed(6)
        )}`;
    }

    if (
        normalized.endsWith('px')
    ) {
        const amount =
            Number(
                normalized.slice(
                    0,
                    -2
                )
            );

        return Number.isFinite(amount)
            ? `${amount}`
            : null;
    }

    return null;
}

function dimensionExpression(
    value,
    axis
) {
    if (
        fillsAxis(
            value,
            axis
        )
    ) {
        return null;
    }

    return transformSize(value);
}

function edgeInsets(
    styles,
    prefix = 'padding'
) {
    const shorthand =
        `${styles[prefix] ?? ''}`
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .map(value =>
                Number(
                    `${value}`.replace(
                        /px$/i,
                        ''
                    )
                )
            );

    const valid =
        shorthand.length > 0 &&
        shorthand.every(Number.isFinite)
            ? shorthand
            : [];

    const [
        shorthandTop,
        shorthandRight,
        shorthandBottom,
        shorthandLeft
    ] =
        valid.length === 1
            ? [
                valid[0],
                valid[0],
                valid[0],
                valid[0]
            ]
            : valid.length === 2
                ? [
                    valid[0],
                    valid[1],
                    valid[0],
                    valid[1]
                ]
                : valid.length === 3
                    ? [
                        valid[0],
                        valid[1],
                        valid[2],
                        valid[1]
                    ]
                    : valid.length >= 4
                        ? valid
                        : [
                            0,
                            0,
                            0,
                            0
                        ];

    const left =
        parsePxValue(
            styles[`${prefix}Left`] ??
            shorthandLeft ??
            0
        );

    const top =
        parsePxValue(
            styles[`${prefix}Top`] ??
            shorthandTop ??
            0
        );

    const right =
        parsePxValue(
            styles[`${prefix}Right`] ??
            shorthandRight ??
            0
        );

    const bottom =
        parsePxValue(
            styles[`${prefix}Bottom`] ??
            shorthandBottom ??
            0
        );

    if (
        ![
            left,
            top,
            right,
            bottom
        ].some(
            value =>
                Number.isFinite(value) &&
                value !== 0
        )
    ) {
        return null;
    }

    return `EdgeInsets.fromLTRB(${left || 0}, ${top || 0}, ${right || 0}, ${bottom || 0})`;
}

function borderRadius(styles) {
    if (
        Number.isFinite(
            Number(
                styles.borderRadius
            )
        )
    ) {
        return `BorderRadius.circular(${Number(styles.borderRadius)})`;
    }

    const values = [
        styles.borderTopLeftRadius,
        styles.borderTopRightRadius,
        styles.borderBottomRightRadius,
        styles.borderBottomLeftRadius
    ];

    if (
        !values.some(
            value =>
                Number.isFinite(
                    Number(value)
                )
        )
    ) {
        return null;
    }

    return `BorderRadius.only(
        topLeft: Radius.circular(${Number(values[0] ?? 0)}),
        topRight: Radius.circular(${Number(values[1] ?? 0)}),
        bottomRight: Radius.circular(${Number(values[2] ?? 0)}),
        bottomLeft: Radius.circular(${Number(values[3] ?? 0)})
    )`;
}

function backgroundImage(styles) {
    const match =
        `${styles.backgroundImage ?? ''}`
            .match(
                /^url\(["']?(.*?)["']?\)$/i
            );

    if (!match) {
        return null;
    }

    const source =
        match[1].replace(
            /^asset:\/\/figma\//,
            'assets/images/figma/'
        );

    if (
        source
            .toLowerCase()
            .endsWith('.svg')
    ) {
        return null;
    }

    const provider =
        /^https?:\/\//i.test(source)
            ? `NetworkImage(${dartString(source)})`
            : `AssetImage(${dartString(source.replace(/^\//, ''))})`;

    const fit =
        `${styles.backgroundSize ?? ''}`
            .toLowerCase() === 'contain'
            ? 'contain'
            : 'cover';

    return `DecorationImage(image: ${provider}, fit: BoxFit.${fit})`;
}

function backdropBlur(styles) {
    const match =
        `${styles.backdropFilter ?? styles.WebkitBackdropFilter ?? ''}`
            .match(
                /blur\(\s*([\d.]+)px\s*\)/i
            );

    return (
        match &&
        Number.isFinite(
            Number(match[1])
        )
    )
        ? Number(match[1])
        : null;
}

function applyBackdropBlur(
    styles,
    child
) {
    const radius =
        backdropBlur(styles);

    return radius === null
        ? child
        : `ClipRect(
            child: BackdropFilter(
              filter: ui.ImageFilter.blur(
                sigmaX: ${radius},
                sigmaY: ${radius}
              ),
              child: ${child}
            )
          )`;
}

function boxShadowExpression(styles) {
    const raw =
        `${styles.boxShadow ?? ''}`
            .trim();

    if (
        !raw ||
        raw === 'none'
    ) {
        return null;
    }

    const colorMatch =
        raw.match(
            /rgba?\([^)]+\)|#[0-9a-f]{3,8}/i
        );

    const color =
        colorMatch
            ? colorExpression(
                colorMatch[0]
            )
            : null;

    const cleaned =
        raw
            .replace(
                /rgba?\([^)]+\)/i,
                ''
            )
            .replace(
                /#[0-9a-f]{3,8}/i,
                ''
            )
            .trim();

    const nums =
        cleaned
            .split(/\s+/)
            .map(
                value =>
                    parsePxValue(value)
            )
            .filter(Number.isFinite);

    if (nums.length < 2) {
        return null;
    }

    const [
        dx,
        dy,
        blur = 0,
        spread = 0
    ] = nums;

    const colorArg =
        color
            ? `, color: ${color}`
            : '';

    return `BoxShadow(
        offset: Offset(${dx}, ${dy}),
        blurRadius: ${blur},
        spreadRadius: ${spread}${colorArg}
    )`;
}

function applyOpacityWrap(
    styles,
    child
) {
    const opacity =
        parsePxValue(
            styles.opacity
        );

    if (
        !Number.isFinite(opacity) ||
        opacity >= 1
    ) {
        return child;
    }

    return `Opacity(
        opacity: ${Math.max(
        0,
        Math.min(
            1,
            opacity
        )
    ).toFixed(4)},
        child: ${child}
    )`;
}

function applyOverflowClip(
    styles,
    child
) {
    const overflow =
        `${styles.overflow ?? styles.overflowX ?? ''}`
            .toLowerCase();

    if (
        overflow !== 'hidden' &&
        overflow !== 'clip'
    ) {
        return child;
    }

    const radius =
        borderRadius(styles);

    return radius
        ? `ClipRRect(
            borderRadius: ${radius},
            child: ${child}
          )`
        : `ClipRect(
            child: ${child}
          )`;
}

function applyConstraintBox(
    styles,
    child
) {
    const minW =
        parsePxValue(
            styles.minWidth
        );

    const maxW =
        parsePxValue(
            styles.maxWidth
        );

    const minH =
        parsePxValue(
            styles.minHeight
        );

    const maxH =
        parsePxValue(
            styles.maxHeight
        );

    if (
        !Number.isFinite(minW) &&
        !Number.isFinite(maxW) &&
        !Number.isFinite(minH) &&
        !Number.isFinite(maxH)
    ) {
        return child;
    }

    const parts = [
        Number.isFinite(minW)
            ? `minWidth: ${minW}`
            : '',
        Number.isFinite(maxW)
            ? `maxWidth: ${maxW}`
            : '',
        Number.isFinite(minH)
            ? `minHeight: ${minH}`
            : '',
        Number.isFinite(maxH)
            ? `maxHeight: ${maxH}`
            : '',
    ]
        .filter(Boolean)
        .join(', ');

    return `ConstrainedBox(
        constraints: BoxConstraints(${parts}),
        child: ${child}
    )`;
}


// -----------------------------------------------------------------------------
// CONTAINER
// -----------------------------------------------------------------------------

function containerExpression(
    styles = {},
    child = 'null',
    {
        loosenChildAxis = null
    } = {}
) {
    const args = [];

    const width =
        dimensionExpression(
            styles.width,
            'width'
        );

    const height =
        dimensionExpression(
            styles.height,
            'height'
        );

    if (width) {
        args.push(
            `width: ${width}`
        );
    }

    if (height) {
        args.push(
            `height: ${height}`
        );
    }

    const padding =
        edgeInsets(
            styles,
            'padding'
        );

    const margin =
        edgeInsets(
            styles,
            'margin'
        );

    if (padding) {
        args.push(
            `padding: ${padding}`
        );
    }

    if (margin) {
        args.push(
            `margin: ${margin}`
        );
    }

    const decoration = [];

    const color =
        colorExpression(
            styles.backgroundColor ??
            styles.background
        );

    if (color) {
        decoration.push(
            `color: ${color}`
        );
    }

    const image =
        backgroundImage(styles);

    if (image) {
        decoration.push(
            `image: ${image}`
        );
    }

    const shadow = boxShadowExpression(styles);
    if (shadow) {
        decoration.push(`boxShadow: <BoxShadow>[${shadow}]`);
    }

    const radius =
        borderRadius(styles);

    if (radius) {
        decoration.push(
            `borderRadius: ${radius}`
        );
    }

    const borderColor =
        colorExpression(
            styles.borderColor
        );

    const borderWidth =
        Number(
            styles.borderTopWidth ??
            styles.borderWidth ??
            0
        );

    if (
        borderColor &&
        borderWidth > 0
    ) {
        decoration.push(
            `border: Border.all(
                color: ${borderColor},
                width: ${borderWidth}
            )`
        );
    }

    if (decoration.length) {
        args.push(
            `decoration: BoxDecoration(
                ${decoration.join(', ')}
            )`
        );
    }

    const resolvedChild =
        loosenChildAxis ===
        'horizontal'
            ? `Align(
                alignment: Alignment.topLeft,
                heightFactor: 1,
                child: ${child}
              )`
            : loosenChildAxis ===
            'vertical'
                ? `Align(
                    alignment: Alignment.topLeft,
                    widthFactor: 1,
                    child: ${child}
                  )`
                : child;

    if (child !== 'null') {
        args.push(
            `child: ${resolvedChild}`
        );
    }

    const fillWidth =
        fillsAxis(
            styles.width,
            'width'
        );

    const fillHeight =
        fillsAxis(
            styles.height,
            'height'
        );

    if (
        args.length === 0
    ) {
        return 'const SizedBox.shrink()';
    }

    if (
        !fillWidth &&
        !fillHeight &&
        backdropBlur(styles) === null &&
        args.length === 1 &&
        child !== 'null' &&
        args[0] ===
        `child: ${child}`
    ) {
        return child;
    }

    const container =
        applyBackdropBlur(
            styles,
            `Container(
                ${args.join(', ')}
            )`
        );

    const styledContainer = applyOpacityWrap(
        styles,
        applyOverflowClip(
            styles,
            applyConstraintBox(styles, container)
        )
    );

    if (
        !fillWidth &&
        !fillHeight
    ) {
        return styledContainer;
    }

    const fallbackWidth =
        Number.isFinite(
            Number(
                styles.fallbackWidth
            )
        )
            ? Number(
                styles.fallbackWidth
            )
            : 0;

    const fallbackHeight =
        Number.isFinite(
            Number(
                styles.fallbackHeight
            )
        )
            ? Number(
                styles.fallbackHeight
            )
            : 0;

    const sizes = [
        fillWidth
            ? `width: constraints.hasBoundedWidth
                ? constraints.maxWidth
                : constraints.minWidth > ${fallbackWidth}
                    ? constraints.minWidth
                    : ${fallbackWidth}`
            : '',

        fillHeight
            ? `height: constraints.hasBoundedHeight
                ? constraints.maxHeight
                : constraints.minHeight > ${fallbackHeight}
                    ? constraints.minHeight
                    : ${fallbackHeight}`
            : '',

        `child: ${styledContainer}`,
    ]
        .filter(Boolean)
        .join(', ');

    return `LayoutBuilder(
        builder: (context, constraints) =>
            SizedBox(
              ${sizes}
            )
    )`;
}


// -----------------------------------------------------------------------------
// PRIMITIVE EXPRESSIONS
// -----------------------------------------------------------------------------

function textExpression(data) {
    const styles =
        getStyles(data);

    const children =
        getChildren(data);

    const rawChildren = data?.modifier?.props?.children ?? '';

    const style = [];

    const color =
        colorExpression(
            styles.color
        );

    if (color) {
        style.push(
            `color: ${color}`
        );
    }

    if (
        Number.isFinite(
            Number(
                styles.fontSize
            )
        )
    ) {
        style.push(
            `fontSize: ${Number(styles.fontSize)}`
        );
    }

    if (
        Number.isFinite(
            Number(
                styles.fontWeight
            )
        )
    ) {
        const weight =
            Math.max(
                100,
                Math.min(
                    900,
                    Math.round(
                        Number(
                            styles.fontWeight
                        ) / 100
                    ) * 100
                )
            );

        style.push(
            `fontWeight: FontWeight.w${weight}`
        );
    }

    if (
        styles.fontFamily
    ) {
        style.push(
            `fontFamily: ${dartString(styles.fontFamily)}`
        );
    }

    if (
        `${styles.fontStyle}`
            .toLowerCase() ===
        'italic'
    ) {
        style.push(
            'fontStyle: FontStyle.italic'
        );
    }

    if (
        Number.isFinite(
            Number(
                styles.letterSpacing
            )
        )
    ) {
        style.push(
            `letterSpacing: ${Number(styles.letterSpacing)}`
        );
    }

    if (
        Number.isFinite(
            Number(
                styles.lineHeightPx
            )
        ) &&
        Number(
            styles.fontSize
        ) > 0
    ) {
        style.push(
            `height: ${
                Number(
                    styles.lineHeightPx
                ) /
                Number(
                    styles.fontSize
                )
            }`
        );
    }

    const textStyle =
        style.length
            ? `, style: TextStyle(${style.join(', ')})`
            : '';

    const translation = children?.type === 'translation' ? children.value : null;
    const translationArgs = translation?.args && typeof translation.args === 'object'
        ? `{${Object.entries(translation.args).map(([key, value]) => `${dartString(key)}: ${valueExpression(value)}`).join(', ')}}`
        : 'const <String, dynamic>{}';
    const translationRequest = translation
        ? translation?.args && Object.keys(translation.args).length > 0
            ? `FastUITranslationRequest(key: ${dartString(translation.key)}, args: ${translationArgs})`
            : `const FastUITranslationRequest(key: ${dartString(translation.key)})`
        : null;
    const expression =
        translation
            ? `ref.watch(fastUITranslateProvider(${translationRequest}))`
            : children?.type === 'logic'
            ? flutterLogicCallExpression(
                children?.value
            )
            : valueExpression(
                typeof rawChildren === 'string' ? rawChildren.replaceAll('$', '\\$') : rawChildren
            );

    const nullable =
        children?.type === 'state' ||
        children?.type === 'input';

    const alignment = {
        start: 'start',
        left: 'left',
        center: 'center',
        end: 'end',
        right: 'right'
    }[
        `${styles.textAlign ?? ''}`
            .toLowerCase()
        ];

    return `Text(
        ${nullable ? `(${expression} ?? '')` : expression}.toString()
        ${alignment ? `, textAlign: TextAlign.${alignment}` : ''}
        ${textStyle}
    )`;
}

function imageExpression(data) {
    const rawSrc =
        data?.modifier?.props?.src ??
        getStates(data).srcUrl ??
        '';

    const src =
        typeof rawSrc === 'string'
            ? rawSrc.replace(
                /^asset:\/\/figma\//,
                'assets/images/figma/'
            )
            : rawSrc;

    const expression =
        valueExpression(src);

    const styles =
        getStyles(data);

    const args = [];

    if (
        Number.isFinite(
            Number(
                styles.width
            )
        )
    ) {
        args.push(
            `width: ${Number(styles.width)}`
        );
    }

    if (
        Number.isFinite(
            Number(
                styles.height
            )
        )
    ) {
        args.push(
            `height: ${Number(styles.height)}`
        );
    }

    const fit =
        `${styles.objectFit ?? ''}`
            .toLowerCase();

    if (fit) {
        args.push(
            `fit: BoxFit.${
                fit === 'none'
                    ? 'none'
                    : fit === 'contain'
                        ? 'contain'
                        : 'cover'
            }`
        );
    }

    const nullable =
        typeof src === 'string' &&
        /^(states|inputs)\./i.test(
            src.trim()
        );

    return `FastUIImage(
        source: ${
        nullable
            ? `(${expression} ?? '')`
            : expression
    }.toString()
        ${args.length ? `, ${args.join(', ')}` : ''}
    )`;
}

function logicCall(
    value,
    argument = 'null'
) {
    const name =
        dartIdentifier(
            `${value ?? ''}`
                .replace(
                    /^(?:logics|services)\./i,
                    ''
                )
                .replace(
                    /\(\)$/g,
                    ''
                )
        );

    return `${name}(
        _componentContext(
            context,
            ref,
            ${argument}
        )
    )`;
}

function navigationCall(action) {
    const transition =
        action?.transition ?? {};

    const rawDuration =
        Number(
            transition?.duration ??
            action?.durationMs
        );

    const durationMs =
        Number.isFinite(rawDuration)
            ? Math.round(
                rawDuration <= 10
                    ? rawDuration * 1000
                    : rawDuration
            )
            : undefined;

    const args = [
        action?.name
            ? `name: ${dartString(
                `${action.name}`.replace(
                    /^\/+|\/+$/g,
                    ''
                )
            )}`
            : '',

        `type: ${dartString(
            action?.type ??
            'page'
        )}`,

        action?.replace
            ? 'replace: true'
            : '',

        transition?.type
            ? `transition: ${dartString(transition.type)}`
            : '',

        transition?.direction
            ? `direction: ${dartString(transition.direction)}`
            : '',

        durationMs === undefined
            ? ''
            : `durationMs: ${durationMs}`,

        action?.barrierDismissible === undefined
            ? ''
            : `barrierDismissible: ${action.barrierDismissible === true}`
    ]
        .filter(Boolean)
        .join(', ');

    return `FastUINavigation.navigate(
        context,
        ${args}
    )`;
}

function interactionStatement(
    action,
    argument = 'null'
) {
    if (
        `${action?.action ?? ''}`
            .startsWith(
                'navigation.'
            )
    ) {
        return navigationCall(action);
    }

    if (
        action?.action ===
        'state.set' &&
        action.target
    ) {
        const value =
            action.value ===
            'event.value'
                ? argument
                : dartLiteral(
                    action.value
                );

        return `_notifier.setField(${dartString(action.target)}, ${value})`;
    }

    return '';
}

function interactionHandler(
    action,
    argumentName
) {
    const actions =
        action?.action === 'sequence'
            ? action.actions ?? []
            : [action];

    const statements =
        actions
            .map(
                value =>
                    interactionStatement(
                        value,
                        argumentName ??
                        'null'
                    )
            )
            .filter(Boolean);

    return `(${argumentName ?? ''}) {
        ${
        statements
            .map(
                statement =>
                    `${statement};`
            )
            .join(' ')
    }
    }`;
}

function applyInteractions(
    data,
    body
) {
    const onClick =
        data?.modifier?.props?.onClick;

    if (
        onClick &&
        typeof onClick ===
        'object'
    ) {
        return `GestureDetector(
            onTap: ${interactionHandler(onClick)},
            child: ${body}
        )`;
    }

    return (
        typeof onClick === 'string' &&
        /^(?:logics|services)\./i.test(
            onClick
        )
    )
        ? `GestureDetector(
            onTap: () =>
                ${logicCall(onClick)},
            child: ${body}
          )`
        : body;
}

function hasMeaningfulStyles(
    styles = {}
) {
    return Object.entries(styles)
        .some(
            ([, value]) =>
                value !== undefined &&
                value !== null
        );
}

function inputExpression(data) {
    const props =
        data?.modifier?.props ??
        {};

    const styles =
        getStyles(data);

    const args = [];

    if (props.value !== undefined && props.value !== null) {
        args.push('controller: _controller');
    }

    if (
        /^(?:logics|services)\./i.test(
            `${props.onChange ?? ''}`
        )
    ) {
        const stateMatch = typeof props.value === 'string'
            ? props.value.match(/^states\.([a-zA-Z_][a-zA-Z0-9_]*)$/i)
            : null;
        args.push(
            `onChanged: (value) {
                ${stateMatch ? `_notifier.setField(${dartString(stateMatch[1])}, value);` : ''}
                ${logicCall(props.onChange, 'value')};
            }`
        );
    } else if (
        props.onChange &&
        typeof props.onChange ===
        'object'
    ) {
        args.push(
            `onChanged: ${
                interactionHandler(
                    props.onChange,
                    'value'
                )
            }`
        );
    }

    const decoration = [];

    if (
        props.placeholder
    ) {
        const placeholder = props.placeholder?.translation;
        decoration.push(
            `hintText: ${placeholder
                ? `ref.watch(fastUITranslateProvider(const FastUITranslationRequest(key: ${dartString(placeholder.key)})))`
                : valueExpression(props.placeholder)}`
        );
    }

    const padding =
        edgeInsets(
            styles,
            'padding'
        );

    if (padding) {
        decoration.push(
            `contentPadding: ${padding}`
        );
    }

    const configuredBorder =
        typeof styles.borderColor ===
        'string' &&
        /^states\./i.test(
            styles.borderColor
        )
            ? getStates(data)[
                styles.borderColor
                    .replace(
                        /^states\./i,
                        ''
                    )
                ]
            : styles.borderColor;

    const inputBorderColor =
        colorExpression(
            configuredBorder
        );

    const inputBorderWidth =
        Number(
            styles.borderTopWidth ??
            styles.borderWidth ??
            (
                inputBorderColor
                    ? 1
                    : 0
            )
        );

    const inputRadius =
        Number.isFinite(
            Number(
                styles.borderRadius
            )
        )
            ? Number(
                styles.borderRadius
            )
            : 0;

    if (
        inputBorderColor &&
        inputBorderWidth > 0
    ) {
        const border =
            `OutlineInputBorder(
                borderRadius:
                    BorderRadius.circular(
                        ${inputRadius}
                    ),
                borderSide:
                    BorderSide(
                        color: ${inputBorderColor},
                        width: ${inputBorderWidth}
                    )
            )`;

        decoration.push(
            `border: ${border}`,
            `enabledBorder: ${border}`
        );
    }

    const fillColor =
        colorExpression(
            styles.backgroundColor
        );

    if (fillColor) {
        decoration.push(
            'filled: true',
            `fillColor: ${fillColor}`
        );
    }

    if (decoration.length) {
        args.push(
            `decoration: InputDecoration(
                ${decoration.join(', ')}
            )`
        );
    }

    if (
        `${getStates(data).inputType ?? props.type}`
            .toLowerCase() ===
        'password'
    ) {
        args.push(
            'obscureText: true'
        );
    }

    if (/^(?:logics|services)\./i.test(`${props.onSubmit ?? ''}`)) {
        args.push(`onFieldSubmitted: (value) => ${logicCall(props.onSubmit, 'value')}`);
    }

    const field =
        `TextFormField(
            ${args.join(', ')}
        )`;

    const width =
        dimensionExpression(
            styles.width,
            'width'
        );

    const height =
        dimensionExpression(
            styles.height,
            'height'
        );

    return (
        width ||
        height
    )
        ? `SizedBox(
            ${width ? `width: ${width},` : ''}
            ${height ? `height: ${height},` : ''}
            child: ${field}
          )`
        : field;
}


// -----------------------------------------------------------------------------
// COMPONENT
// -----------------------------------------------------------------------------

function widgetIdExpression(
    data,
    isStateClass = false
) {
    const props =
        getProps(data);

    const overridePropsRef =
        isStateClass
            ? 'widget.overrideProps'
            : 'overrideProps';

    if (
        props.id === undefined ||
        props.id === null ||
        props.id === ''
    ) {
        return `${overridePropsRef}['id']`;
    }

    return `${overridePropsRef}['id'] ?? ${valueExpression(props.id)}`;
}

function componentHasPlaceholderOwnView(
    data
) {
    const base =
        `${data?.base ?? 'container'}`
            .toLowerCase();

    const children =
        getChildren(data);

    const props =
        getProps(data);

    const ownProps =
        Object.fromEntries(
            Object.entries(props)
                .filter(
                    ([key, value]) =>
                        value !== undefined &&
                        value !== null &&
                        ![
                            'id',
                            'onClick',
                            'children',
                            'control',
                            'scroll'
                        ].includes(key)
                )
        );

    return (
        (
            base === 'container' ||
            base === 'div'
        ) &&
        !hasMeaningfulStyles(
            getStyles(data)
        ) &&
        !`${children?.value ?? ''}`
            .trim() &&
        Object.keys(ownProps)
            .length === 0
    );
}

function componentBody(data) {
    const base =
        `${data?.base ?? 'container'}`
            .toLowerCase();

    if (
        base === 'text'
    ) {
        const styles =
            getStyles(data);
        if (typeof styles === 'string') {
            return `FastUIStyleHelper.buildBox(
              ${flutterLogicCallExpression(styles)},
              child: ${textExpression(data)}
            )`;
        }
        return containerExpression(styles, textExpression(data));
    }

    if (
        base === 'image'
    ) {
        return imageExpression(data);
    }

    if (
        base === 'input' ||
        (
            base === 'container' &&
            data?.modifier?.props?.control ===
            'input'
        )
    ) {
        return inputExpression(data);
    }

    if (
        componentHasPlaceholderOwnView(
            data
        )
    ) {
        return 'const SizedBox.shrink()';
    }

    const styles =
        getStyles(data);

    const children =
        getChildren(data);

    let childArg = '';

    if (
        children?.value !== undefined &&
        children.value !== '' &&
        children.value !== null
    ) {
        let childExpr;

        if (
            children.type ===
            'state'
        ) {
            childExpr =
                `Text(
                    (${stateIdentifier(children.value)} ?? '').toString()
                )`;
        } else if (
            children.type ===
            'input'
        ) {
            childExpr =
                `Text(
                    (widget.${dartIdentifier(children.value)} ?? '').toString()
                )`;
        } else if (
            children.type ===
            'logic'
        ) {
            childExpr =
                `Text(
                    (${flutterLogicCallExpression(children.value)}).toString()
                )`;
        } else {
            childExpr =
                `Text(
                    ${dartString(children.value)}
                )`;
        }

        childArg =
            `, child: ${childExpr}`;
    }

    const child = childArg ? childArg.replace(/^, child:\s*/, '') : 'null';
    const body = typeof styles === 'string'
        ? `FastUIStyleHelper.buildBox(
            ${flutterLogicCallExpression(styles)},
            child: ${child}
          )`
        : containerExpression(styles, child);

    return applyInteractions(
        data,
        body
    );
}


// -----------------------------------------------------------------------------
// FLEX / LAYOUT METADATA
// -----------------------------------------------------------------------------

function mainAxis(value) {
    const map = {
        center: 'center',
        'flex-end': 'end',
        'space-between': 'spaceBetween',
        'space-around': 'spaceAround',
        'space-evenly': 'spaceEvenly'
    };

    return `MainAxisAlignment.${
        map[value] ??
        'start'
    }`;
}

function crossAxis(value) {
    const map = {
        center: 'center',
        'flex-end': 'end',
        stretch: 'stretch',
        baseline: 'baseline'
    };

    return `CrossAxisAlignment.${
        map[value] ??
        'start'
    }`;
}

function alignedContent(
    styles,
    isRow,
    content
) {
    const position = value =>
        value === 'center'
            ? 0
            : value === 'flex-end'
                ? 1
                : -1;

    const horizontal =
        position(
            isRow
                ? styles.justifyContent
                : styles.alignItems
        );

    const vertical =
        position(
            isRow
                ? styles.alignItems
                : styles.justifyContent
        );

    if (
        horizontal === -1 &&
        vertical === -1
    ) {
        return content;
    }

    return `Align(
        alignment: Alignment(
            ${horizontal},
            ${vertical}
        ),
        child: ${content}
    )`;
}

function isFlexibleFrame(
    styles = {},
    isRow
) {
    return (
        Number(
            styles.flex ??
            0
        ) > 0 ||
        fillsAxis(
            styles[
                isRow
                    ? 'width'
                    : 'height'
                ],
            isRow
                ? 'width'
                : 'height'
        )
    );
}

function normalizedScroll(
    data = {}
) {
    const value =
        `${getProps(data)?.scroll ?? 'none'}`
            .trim()
            .toLowerCase();

    return [
        'vertical',
        'horizontal',
        'both'
    ].includes(value)
        ? value
        : 'none';
}

function axisSizeModeFromStyles(
    styles = {},
    axis
) {
    if (
        !Object.prototype.hasOwnProperty.call(
            styles,
            axis
        )
    ) {
        return null;
    }

    const value =
        styles[axis];

    if (
        value === undefined ||
        value === null
    ) {
        return 'auto';
    }

    const normalized =
        `${value}`
            .trim()
            .toLowerCase();

    if (
        !normalized ||
        [
            'auto',
            'fit-content',
            'min-content',
            'max-content'
        ].includes(
            normalized
        )
    ) {
        return 'auto';
    }

    if (
        fillsAxis(
            value,
            axis
        )
    ) {
        return 'fill';
    }

    return 'fixed';
}

function declaredFlex(
    data = {}
) {
    const frame =
        getFrame(data);

    const frameStyles =
        frame?.baseStyles ??
        {};

    const ownStyles =
        getStyles(data);

    const raw =
        Object.prototype.hasOwnProperty.call(
            frameStyles,
            'flex'
        )
            ? frameStyles.flex
            : ownStyles.flex;

    const value =
        Number(raw);

    return (
        Number.isFinite(value) &&
        value > 0
    )
        ? Math.max(
            1,
            Math.round(value)
        )
        : 0;
}

function fixedAxisValue(
    data = {},
    axis
) {
    const frame =
        getFrame(data);

    const frameStyles =
        frame?.baseStyles ??
        {};

    const ownStyles =
        getStyles(data);

    const raw =
        Object.prototype.hasOwnProperty.call(
            frameStyles,
            axis
        )
            ? frameStyles[axis]
            : ownStyles[axis];

    if (
        raw === undefined ||
        raw === null
    ) {
        return null;
    }

    if (
        fillsAxis(
            raw,
            axis
        )
    ) {
        return null;
    }

    if (
        Number.isFinite(
            Number(raw)
        )
    ) {
        return Number(raw);
    }

    const normalized =
        `${raw}`
            .trim()
            .toLowerCase();

    if (
        normalized.endsWith(
            'px'
        )
    ) {
        const value =
            Number(
                normalized.slice(
                    0,
                    -2
                )
            );

        return Number.isFinite(value)
            ? value
            : null;
    }

    return null;
}


function layoutMetadataMembers(
    data = {},
    inheritedClassName = null
) {
    const props =
        getProps(data);

    const frame =
        getFrame(data);

    const frameStyles =
        frame?.baseStyles ??
        {};

    const ownStyles =
        getStyles(data);

    const fixedWidth =
        fixedAxisValue(
            data,
            'width'
        );

    const fixedHeight =
        fixedAxisValue(
            data,
            'height'
        );

    const hasOwnScroll =
        Object.prototype.hasOwnProperty.call(
            props,
            'scroll'
        );

    const ownWidthMode =
        axisSizeModeFromStyles(
            frameStyles,
            'width'
        ) ??
        axisSizeModeFromStyles(
            ownStyles,
            'width'
        );

    const ownHeightMode =
        axisSizeModeFromStyles(
            frameStyles,
            'height'
        ) ??
        axisSizeModeFromStyles(
            ownStyles,
            'height'
        );

    const hasOwnFlex =
        Object.prototype.hasOwnProperty.call(
            frameStyles,
            'flex'
        ) ||
        Object.prototype.hasOwnProperty.call(
            ownStyles,
            'flex'
        );

    const scrollExpr =
        hasOwnScroll
            ? dartString(
                normalizedScroll(
                    data
                )
            )
            : inheritedClassName
                ? `${inheritedClassName}.fastUIScroll`
                : dartString(
                    'none'
                );

    const widthModeExpr =
        ownWidthMode !== null
            ? dartString(
                ownWidthMode
            )
            : inheritedClassName
                ? `${inheritedClassName}.fastUIWidthMode`
                : dartString(
                    'auto'
                );

    const heightModeExpr =
        ownHeightMode !== null
            ? dartString(
                ownHeightMode
            )
            : inheritedClassName
                ? `${inheritedClassName}.fastUIHeightMode`
                : dartString(
                    'auto'
                );

    const flexExpr =
        hasOwnFlex
            ? `${declaredFlex(data)}`
            : inheritedClassName
                ? `${inheritedClassName}.fastUIFlex`
                : '0';

    const fixedWidthExpr =
        fixedWidth !== null
            ? `${fixedWidth}`
            : inheritedClassName
                ? `${inheritedClassName}.fastUIFixedWidth`
                : 'null';

    const fixedHeightExpr =
        fixedHeight !== null
            ? `${fixedHeight}`
            : inheritedClassName
                ? `${inheritedClassName}.fastUIFixedHeight`
                : 'null';

    return [
        `static const String fastUIScroll = ${scrollExpr};`,
        `static const String fastUIWidthMode = ${widthModeExpr};`,
        `static const String fastUIHeightMode = ${heightModeExpr};`,
        `static const double? fastUIFixedWidth = ${fixedWidthExpr};`,
        `static const double? fastUIFixedHeight = ${fixedHeightExpr};`,
        `static const int fastUIFlex = ${flexExpr};`,
    ].join('\n  ');
}


// -----------------------------------------------------------------------------
// FRAME COMPOSITION
// -----------------------------------------------------------------------------

const LAYOUT_ONLY_KEYS =
    new Set([
        'spaceValue',
        'justifyContent',
        'alignItems',
        'flexDirection',
        'flex',
        'fallbackWidth',
        'fallbackHeight'
    ]);

function stripLayoutKeys(styles) {
    return Object.fromEntries(
        Object.entries(styles)
            .filter(
                ([key]) =>
                    !LAYOUT_ONLY_KEYS.has(
                        key
                    )
            )
    );
}

function ownExpressionIsEmpty(value) {
    return (
        `${value ?? ''}`.trim() ===
        'const SizedBox.shrink()'
    );
}

function applyScrollableArea(
    scroll,
    child
) {
    if (
        scroll === 'both'
    ) {
        return `SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            primary: false,
            child: SingleChildScrollView(
                scrollDirection: Axis.vertical,
                primary: false,
                child: ${child}
            )
        )`;
    }

    if (
        scroll === 'horizontal'
    ) {
        return `SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            primary: false,
            child: ${child}
        )`;
    }

    if (
        scroll === 'vertical'
    ) {
        return `SingleChildScrollView(
            scrollDirection: Axis.vertical,
            primary: false,
            child: ${child}
        )`;
    }

    return child;
}

function composeFrame(
    data,
    frame,
    ownContentExpr,
    extendRefs = [],
    applyScroll = true
) {
    const current =
        frame?.current ??
        {};

    const base =
        frame?.base;

    const baseStyles =
        frame?.baseStyles ??
        {};

    const isRow =
        `${base ?? ''}`
            .toLowerCase()
            .startsWith(
                'row'
            );

    const next =
        frame?.next ??
        {};

    const hasCurrentWrapper =
        hasMeaningfulStyles(
            current
        );

    const hasNextWrapper =
        hasMeaningfulStyles(
            next
        );

    const currentFlexible =
        hasCurrentWrapper &&
        isFlexibleFrame(
            current,
            isRow
        );

    const nextFlexible =
        hasNextWrapper &&
        isFlexibleFrame(
            next,
            isRow
        );

    const loosenChildAxis =
        isRow
            ? 'horizontal'
            : 'vertical';

    const currentWidget =
        hasCurrentWrapper
            ? containerExpression(
                current,
                alignedContent(
                    current,
                    isRow,
                    ownContentExpr
                ),
                {
                    loosenChildAxis:
                        currentFlexible
                            ? loosenChildAxis
                            : null
                }
            )
            : ownContentExpr;

    const ownHasContent =
        hasCurrentWrapper ||
        !ownExpressionIsEmpty(
            ownContentExpr
        );

    const nextWidgets =
        extendRefs.map(
            (ref, index) => {
                const child =
                    widgetInvocation(ref, '', `${index}`);

                const widget =
                    hasNextWrapper
                        ? containerExpression(
                            next,
                            child,
                            {
                                loosenChildAxis:
                                    nextFlexible
                                        ? loosenChildAxis
                                        : null
                            }
                        )
                        : child;

                return {
                    ref,
                    widget
                };
            }
        );

    const hasBaseWrapper =
        Boolean(base) ||
        hasMeaningfulStyles(
            baseStyles
        ) ||
        extendRefs.length > 0 ||
        hasCurrentWrapper;

    if (!hasBaseWrapper) {
        return currentWidget;
    }

    const baseContainerStyles =
        stripLayoutKeys(
            baseStyles
        );

    const fillWidth =
        fillsAxis(
            baseStyles.width,
            'width'
        );

    const fillHeight =
        fillsAxis(
            baseStyles.height,
            'height'
        );

    const fallbackWidth =
        Number.isFinite(
            Number(
                baseStyles.fallbackWidth
            )
        )
            ? Number(
                baseStyles.fallbackWidth
            )
            : 0;

    const fallbackHeight =
        Number.isFinite(
            Number(
                baseStyles.fallbackHeight
            )
        )
            ? Number(
                baseStyles.fallbackHeight
            )
            : 0;

    const scroll =
        applyScroll
            ? data?.modifier?.props?.scroll
            : undefined;

    if (
        `${base ?? ''}`
            .toLowerCase()
            .includes(
                '.stack'
            )
    ) {
        const rawNextWidgets =
            nextWidgets.map(
                item =>
                    item.widget
            );

        const stackChildren =
            ownHasContent
                ? [
                    currentWidget,
                    ...rawNextWidgets
                ]
                : rawNextWidgets;

        const stack =
            `Stack(
                children: [
                    ${stackChildren.join(', ')}
                ]
            )`;

        const wrapped =
            Object.keys(
                baseContainerStyles
            ).length > 0
                ? containerExpression(
                    baseContainerStyles,
                    stack
                )
                : stack;

        return applyScrollableArea(
            scroll,
            wrapped
        );
    }

    const isEnd =
        `${base ?? ''}`
            .toLowerCase()
            .includes(
                '.end'
            );

    const bounded =
        isRow
            ? 'constraints.hasBoundedWidth'
            : 'constraints.hasBoundedHeight';

    const currentItem =
        ownHasContent
            ? (
                currentFlexible
                    ? `if (${bounded})
                        Expanded(
                            child: ${currentWidget}
                        )
                       else
                        ${currentWidget}`
                    : currentWidget
            )
            : null;

    const parentAxis =
        isRow
            ? 'horizontal'
            : 'vertical';

    const childAxisModeMember =
        isRow
            ? 'fastUIWidthMode'
            : 'fastUIHeightMode';

    const nextAxisMode =
        axisSizeModeFromStyles(
            next,
            isRow
                ? 'width'
                : 'height'
        );

    const nextWrapperHasFixedMainAxis =
        hasNextWrapper &&
        nextAxisMode ===
        'fixed';

    const nextItems =
        nextWidgets.map(
            ({
                 ref,
                 widget
             }) => {
                if (
                    nextFlexible
                ) {
                    return `if (${bounded})
                        Expanded(
                            child: ${widget}
                        )
                    else
                        ${widget}`;
                }

                if (
                    nextWrapperHasFixedMainAxis
                ) {
                    return widget;
                }

                const scrollMatchesParent =
                    `(
                        ${ref.className}.fastUIScroll == '${parentAxis}'
                        ||
                        ${ref.className}.fastUIScroll == 'both'
                    )`;

                const axisMode =
                    `${ref.className}.${childAxisModeMember}`;

                return `
                    if (
                        ${bounded}
                        &&
                        ${ref.className}.fastUIFlex > 0
                    )
                        Expanded(
                            flex: ${ref.className}.fastUIFlex,
                            child: ${widget}
                        )
                    else if (
                        ${bounded}
                        &&
                        (
                            ${axisMode} == 'fill'
                            ||
                            (
                                ${scrollMatchesParent}
                                &&
                                ${axisMode} != 'fixed'
                            )
                        )
                    )
                        Expanded(
                            child: ${widget}
                        )
                    else
                        ${widget}
                `;
            }
        );

    const orderedBase =
        isEnd
            ? [
                ...nextItems,
                ...(
                    currentItem
                        ? [currentItem]
                        : []
                )
            ]
            : [
                ...(
                    currentItem
                        ? [currentItem]
                        : []
                ),
                ...nextItems
            ];

    if (
        orderedBase.length === 0
    ) {
        const wrapped =
            Object.keys(
                baseContainerStyles
            ).length > 0
                ? containerExpression(
                    baseContainerStyles
                )
                : 'const SizedBox.shrink()';

        return applyScrollableArea(
            scroll,
            wrapped
        );
    }

    const gap =
        Number(
            baseStyles.spaceValue
        );

    const spacer =
        gap > 0
            ? `SizedBox(
                ${
                isRow
                    ? `width: ${gap}`
                    : `height: ${gap}`
            }
            )`
            : null;

    const ordered =
        spacer
            ? orderedBase.flatMap(
                (
                    item,
                    index
                ) =>
                    index === 0
                        ? [item]
                        : [
                            spacer,
                            item
                        ]
            )
            : orderedBase;

    const justifyContent =
        baseStyles.justifyContent;

    const alignItems =
        baseStyles.alignItems;

    const hasBaseContainerStyles =
        Object.keys(
            baseContainerStyles
        ).length > 0;

    const buildRowCol =
        boundedExpr => {
            const ms =
                boundedExpr ??
                bounded;

            return `${
                isRow
                    ? 'Row'
                    : 'Column'
            }(
                mainAxisSize:
                    ${ms}
                        ? MainAxisSize.max
                        : MainAxisSize.min,
                mainAxisAlignment:
                    ${mainAxis(justifyContent)},
                crossAxisAlignment:
                    ${crossAxis(alignItems)},
                children: [
                    ${ordered.join(', ')}
                ]
            )`;
        };

    let rowCol;

    if (
        fillWidth ||
        fillHeight
    ) {
        const sizes = [
            fillWidth
                ? `width:
                    constraints.hasBoundedWidth
                        ? constraints.maxWidth
                        : constraints.minWidth > ${fallbackWidth}
                            ? constraints.minWidth
                            : ${fallbackWidth}`
                : '',

            fillHeight
                ? `height:
                    constraints.hasBoundedHeight
                        ? constraints.maxHeight
                        : constraints.minHeight > ${fallbackHeight}
                            ? constraints.minHeight
                            : ${fallbackHeight}`
                : '',

            `child: ${
                buildRowCol(
                    isRow
                        ? 'constraints.hasBoundedWidth'
                        : 'constraints.hasBoundedHeight'
                )
            }`,
        ]
            .filter(Boolean)
            .join(', ');

        rowCol =
            `LayoutBuilder(
                builder: (context, constraints) =>
                    SizedBox(
                        ${sizes}
                    )
            )`;
    } else {
        rowCol =
            `LayoutBuilder(
                builder: (context, constraints) =>
                    ${buildRowCol()}
            )`;
    }

    if (
        hasBaseContainerStyles
    ) {
        const contArgs = [];
        const decorArgs = [];

        const width =
            transformSize(
                baseContainerStyles?.width ??
                null
            );

        const height =
            transformSize(
                baseContainerStyles?.height ??
                null
            );

        if (width) {
            contArgs.push(
                `width: ${width}`
            );
        }

        if (height) {
            contArgs.push(
                `height: ${height}`
            );
        }

        const padding =
            edgeInsets(
                baseContainerStyles,
                'padding'
            );

        const margin =
            edgeInsets(
                baseContainerStyles,
                'margin'
            );

        if (padding) {
            decorArgs.push(
                `padding: ${padding}`
            );
        }

        if (margin) {
            decorArgs.push(
                `margin: ${margin}`
            );
        }

        const decoList = [];

        const color =
            colorExpression(
                baseContainerStyles.backgroundColor ??
                baseContainerStyles.background
            );

        if (color) {
            decoList.push(
                `color: ${color}`
            );
        }

        const radius =
            borderRadius(
                baseContainerStyles
            );

        if (radius) {
            decoList.push(
                `borderRadius: ${radius}`
            );
        }

        if (
            decoList.length
        ) {
            decorArgs.push(
                `decoration:
                    BoxDecoration(
                        ${decoList.join(', ')}
                    )`
            );
        }

        if (
            contArgs.length > 0
        ) {
            decorArgs.push(
                `${contArgs.join(', ')}`,
                `child: ${rowCol}`
            );
        } else {
            decorArgs.push(
                `child: ${rowCol}`
            );
        }

        return applyScrollableArea(
            scroll,
            `Container(
                ${decorArgs.join(', ')}
            )`
        );
    }

    return applyScrollableArea(
        scroll,
        rowCol
    );
}


// -----------------------------------------------------------------------------
// REFERENCES / SERVICE
// -----------------------------------------------------------------------------

async function serviceImportAndStubs(
    data,
    specPath
) {
    const names =
        collectLogicNames(data);

    if (
        !names.length
    ) {
        return '';
    }

    const structure =
        specStructure(
            specPath,
            'flutter'
        );

    const servicePath =
        await ensureServiceFile({
            servicePath:
            structure.servicePath,

            functions:
            names,

            template:
                'flutter',

            flutterReturns: (() => {
                const styleLogic = parseLogicReference(data?.modifier?.styles);
                return styleLogic ? {[dartIdentifier(styleLogic.name)]: 'Map<String, dynamic>'} : {};
            })(),

            flutterContext: Object.keys(getStates(data)).length > 0 ? {
                runtimePath: resolve(flutterLibRoot(specPath), 'fastui_runtime.dart'),
                modelsPath: structure.storeModelsPath,
                providersPath: structure.storePath,
                model: stateModelName(specPath),
                notifier: notifierName(specPath),
            } : undefined,
        });

    return `import '${
        relativeImport(
            generatedPath(specPath),
            servicePath
        )
    }';`;
}

function referencedWidgets(
    data,
    specPath
) {
    const refs = {
        extendList:
            getExtendList(data)
                .map(
                    path =>
                        referenceImport(
                            specPath,
                            path
                        )
                )
                .filter(Boolean),

        left:
            referenceImport(
                specPath,
                getLeft(data)
            ),

        right:
            referenceImport(
                specPath,
                getRight(data)
            ),

        feed:
            referenceImport(
                specPath,
                getFeed(data)
            )
    };

    const allRefs = [
        ...refs.extendList,
        refs.left,
        refs.right,
        refs.feed
    ].filter(Boolean);

    const imports =
        [
            ...new Map(
                allRefs.map(
                    item => [
                        item.importPath,
                        item
                    ]
                )
            ).values()
        ]
            .map(
                item =>
                    `import '${item.importPath}';`
            )
            .join('\n');

    return {
        refs,
        imports
    };
}

function widgetInvocation(
    ref,
    extra = '',
    slot = 'child'
) {
    if (!ref) {
        return 'const SizedBox.shrink()';
    }

    return `${ref.className}(
        loopIndex: widget.loopIndex,
        loopElement: widget.loopElement,
        instanceId: '\${widget.instanceId ?? 'root'}/${slot}/${ref.className}'
        ${extra}
    )`;
}


// -----------------------------------------------------------------------------
// STATE
// -----------------------------------------------------------------------------

function stateModelName(
    specPath
) {
    return `FastUI${
        specStructure(
            specPath,
            'flutter'
        ).componentName
    }StateModel`;
}

function contextMembers(
    data,
    inputs,
    specPath
) {
    const inputEntries =
        inputs
            .filter(
                input =>
                    input !==
                    'view'
            )
            .map(
                input =>
                    `${dartString(input)}: widget.${input}`
            );

    const hasState = Object.keys(getStates(data)).length > 0;
    if (!hasState) {
        return `FastUIComponentContext<Map<String, dynamic>, Object?> _componentContext(
        BuildContext context,
        WidgetRef ref,
        [
            dynamic argument
        ]
    ) => FastUIComponentContext<Map<String, dynamic>, Object?>(
      context: context,
      ref: ref,
      state: const <String, dynamic>{},
      notifier: null,
      inputs: <String, dynamic>{${inputEntries.join(', ')}},
      args: argument == null ? <dynamic>[] : argument is core.List ? core.List<dynamic>.from(argument) : <dynamic>[argument],
      componentId: widget.instanceId ?? ${dartString(specPath)},
      setState: (key, value) => throw StateError('This component has no state'),
    );`;
    }
    const model = stateModelName(specPath);
    const notifier = notifierName(specPath);
    const provider = providerIdentifier(specPath);
    return `FastUIComponentContext<${model}, ${notifier}> _componentContext(
        BuildContext context,
        WidgetRef ref,
        [dynamic argument]
    ) {
      final instance = _providerInstance;
      final notifier = ref.read(${provider}(instance).notifier);
      return FastUIComponentContext<${model}, ${notifier}>(
        context: context,
        ref: ref,
        state: ref.read(${provider}(instance)),
        notifier: notifier,
        inputs: <String, dynamic>{${inputEntries.join(', ')}},
        args: argument == null ? <dynamic>[] : argument is core.List ? core.List<dynamic>.from(argument) : <dynamic>[argument],
        componentId: instance.id,
        setState: notifier.setField,
      );
    }`;
}

function effectsInit(data) {
    return Object.values(
        getEffects(data)
    )
        .map(
            effect => {
                const body =
                    effect?.body;

                return (
                    typeof body ===
                    'string' &&
                    /^(?:logics|services)\./i.test(
                        body
                    )
                )
                    ? `await ${logicCall(body)};`
                    : '';
            }
        )
        .filter(Boolean)
        .join('\n    ');
}


// -----------------------------------------------------------------------------
// WIDGET WRITER
// -----------------------------------------------------------------------------

function buildMetaMethod(
    data,
    isStateClass = false
) {
    return `Widget _applyMeta(
        Widget child
    ) =>
        FastUIStyleHelper.applyMeta(
            child,
            id: ${widgetIdExpression(
        data,
        isStateClass
    )}
        );`;
}

async function writeWidget({
                               data,
                               specPath,
                               buildExpression,

                               // Normal components use composeFrame().
                               // Loops set this to false because they already generate their own
                               // Row / Column / Wrap and scrollable viewport.
                               composeFrameEnabled = true
                           }) {
    const outputPath =
        generatedPath(specPath);

    const name =
        classNameFromPath(
            specPath
        );

    const layoutMetadata =
        layoutMetadataMembers(data);

    const inputs =
        collectInputs(data);

    const hasLogic =
        collectLogicNames(data)
            .length > 0;

    const behavior =
        analyzeBehavior(data);

    const {
        refs,
        imports
    } =
        referencedWidgets(
            data,
            specPath
        );

    const serviceImport =
        await serviceImportAndStubs(
            data,
            specPath
        );

    const runtimePath =
        resolve(
            flutterLibRoot(specPath),
            'fastui_runtime.dart'
        );

    await ensureFileExist(
        runtimePath
    );

    if (
        (
            await readFile(
                runtimePath
            )
        )
            .toString()
            .trim() === ''
    ) {
        await writeFile(
            runtimePath,
            flutterRuntimeSource()
        );
    }

    let runtimeImportPath =
        relative(
            dirname(outputPath),
            runtimePath
        )
            .split(sep)
            .join('/');

    if (
        !runtimeImportPath
            .startsWith('.')
    ) {
        runtimeImportPath =
            `./${runtimeImportPath}`;
    }

    const overrideParams =
        `this.instanceId,
         this.overrideProps = const {},
         this.overrideStates = const {}`;

    const constructorFields =
        [
            ...inputs.map(
                input =>
                    `this.${input}`
            ),

            overrideParams
        ]
            .join(', ');

    const fieldDeclarations =
        [
            ...inputs.map(
                input =>
                    `final dynamic ${input};`
            ),

            `final String? instanceId;`,
            `final Map<String, dynamic> overrideProps;`,
            `final Map<String, dynamic> overrideStates;`,
        ]
            .join('\n  ');

    const hasState =
        Object.keys(
            getStates(data)
        ).length > 0;

    const structure =
        specStructure(
            specPath,
            'flutter'
        );

    const storeImport =
        hasState
            ? `import '${
                relativeImport(
                    outputPath,
                    structure.storePath
                )
            }';
import '${
                relativeImport(
                    outputPath,
                    structure.storeModelsPath
                )
            }';`
            : '';

    const provider = hasState ? providerIdentifier(specPath) : '';
    const model = hasState ? stateModelName(specPath) : '';
    const providerMembers = hasState
        ? `FastUIProviderInstance<${model}> get _providerInstance => FastUIProviderInstance<${model}>(
      id: widget.instanceId ?? ${dartString(structure.specId)},
      initialOverrides: widget.overrideStates,
    );`
        : '';

    const props = data?.modifier?.props ?? {};
    const controlledStateMatch = typeof props.value === 'string' ? props.value.match(/^states\.([a-zA-Z_][a-zA-Z0-9_]*)$/i) : null;
    const controlledStateKey = props.control === 'input' && controlledStateMatch ? controlledStateMatch[1] : null;
    const hasController = Boolean(controlledStateKey);
    const controllerInit = hasController
        ? `_controller = TextEditingController(text: (ref.read(${provider}(_providerInstance)).${dartIdentifier(controlledStateKey)} ?? '').toString());`
        : '';
    const controllerMember = hasController ? 'late final TextEditingController _controller;' : '';
    const controllerDispose = hasController ? '_controller.dispose();' : '';

    const effects =
        effectsInit(data);

    const ownContent =
        buildExpression(refs);

    const composedFrame =
        composeFrameEnabled
            ? composeFrame(
                data,
                getFrame(data),
                ownContent,
                refs.extendList,
                !refs.feed
            )
            : ownContent;

    const composedContent =
        ownExpressionIsEmpty(
            ownContent
        )
            ? applyInteractions(
                data,
                composedFrame
            )
            : composedFrame;

    const usesMeta =
        getProps(data).id !==
        undefined &&
        getProps(data).id !==
        null &&
        getProps(data).id !==
        '';

    const runtimeImport =
        (
            usesMeta ||
            `${data?.base}`
                .toLowerCase() ===
            'image' ||
            behavior.hasNavigation ||
            behavior.hasTranslation ||
            hasState ||
            hasLogic
        )
            ? `import '${runtimeImportPath}';`
            : '';


    const contextSource =
        hasLogic
            ? contextMembers(
                data,
                inputs,
                specPath
            )
            : '';

    const metaHelperStateful =
        usesMeta
            ? `\n\n  ${
                buildMetaMethod(
                    data,
                    true
                )
            }`
            : '';

    const metaHelperStateless =
        usesMeta
            ? `\n\n  ${
                buildMetaMethod(
                    data,
                    false
                )
            }`
            : '';

    const buildReturnStateful =
        usesMeta
            ? `_applyMeta(
                ${composedContent}
              )`
            : composedContent;

    const buildReturnStateless =
        usesMeta
            ? `_applyMeta(
                ${composedContent}
              )`
            : composedContent;

    const usesStateValue = composedContent.includes('state.');
    const usesNotifier = composedContent.includes('_notifier');
    const stateBuild = hasState
        ? `${usesStateValue ? `final state = ref.watch(${provider}(_providerInstance));` : `ref.watch(${provider}(_providerInstance));`}
    ${usesNotifier ? `final _notifier = ref.read(${provider}(_providerInstance).notifier);` : ''}`
        : '';
    const controllerListen = hasController
        ? `ref.listen<String>(
      ${provider}(_providerInstance).select((value) => (value.${dartIdentifier(controlledStateKey)} ?? '').toString()),
      (previous, next) {
        if (_controller.text == next) return;
        final offset = _controller.selection.isValid
            ? _controller.selection.baseOffset.clamp(0, next.length)
            : next.length;
        _controller.value = _controller.value.copyWith(
          text: next,
          selection: TextSelection.collapsed(offset: offset),
          composing: TextRange.empty,
        );
      },
    );`
        : '';
    const effectSchedule = effects
        ? `WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      ${hasState ? `ref.read(${provider}(_providerInstance).notifier).initialize(() async { ${effects} })` : `Future<void>.sync(() async { ${effects} })`}.catchError((Object error, StackTrace stackTrace) {
        FlutterError.reportError(FlutterErrorDetails(exception: error, stack: stackTrace, library: 'FastUI service initialization'));
      });
    });`
        : '';
    const stateful =
        `class ${name} extends ConsumerStatefulWidget {
  const ${name}({
    super.key,
    ${constructorFields}
  });

  ${layoutMetadata}

  ${fieldDeclarations}

  @override
  ConsumerState<${name}> createState() =>
      _${name}State();
}

class _${name}State
    extends ConsumerState<${name}> {

  ${controllerMember}

  ${providerMembers}

  @override
  void initState() {
    super.initState();
    ${controllerInit}
    ${effectSchedule}
  }

  ${hasController ? `@override
  void dispose() {
    ${controllerDispose}
    super.dispose();
  }` : ''}

  ${contextSource}

  ${metaHelperStateful}

  @override
  Widget build(
      BuildContext context
  ) {
    ${stateBuild}
    ${controllerListen}
    return ${buildReturnStateful};
  }
}`;

    const needsConsumer = hasLogic || behavior.hasTranslation;
    const stateless =
        `class ${name}
    extends ${needsConsumer ? 'ConsumerWidget' : 'StatelessWidget'} {

  const ${name}({
    super.key,
    ${constructorFields}
  });

  ${layoutMetadata}

  ${fieldDeclarations}

  ${name} get widget => this;

  ${contextSource}

  ${metaHelperStateless}

  @override
  Widget build(
      BuildContext context${needsConsumer ? ', WidgetRef ref' : ''}
  ) {
    return ${buildReturnStateless};
  }
}`;

    const blurImport =
        JSON.stringify(data)
            .includes(
                'backdropFilter'
            )
            ? "import 'dart:ui' as ui;"
            : '';

    const content =
        `import 'dart:core';
import 'dart:core' as core;
import 'package:flutter/material.dart';
${behavior.requiresFlutterStatefulWidget || needsConsumer ? "import 'package:flutter_riverpod/flutter_riverpod.dart';" : ''}
${blurImport}
${runtimeImport}
${imports}
${storeImport}
${serviceImport}

${
            hasState || behavior.hasEffects || hasController
                ? stateful
                : stateless
        }
`;

    await ensurePathExist(
        dirname(outputPath)
    );

    await writeFile(
        outputPath,
        content.replace(
            /^\s+$/gm,
            ''
        )
    );
}


// -----------------------------------------------------------------------------
// SPEC BASE
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// PUBLIC COMPONENT GENERATOR
// -----------------------------------------------------------------------------

export async function composeFlutterComponent({
                                                  data,
                                                  path: specPath
                                              }) {
    if (!data) {
        return;
    }

    await writeWidget({
        data,
        specPath,

        buildExpression:
            () =>
                componentBody(
                    data
                )
    });
}


// -----------------------------------------------------------------------------
// CONDITION GENERATOR
// -----------------------------------------------------------------------------

export async function composeFlutterCondition({
                                                  data,
                                                  path: specPath
                                              }) {
    if (!data) {
        return;
    }

    await writeWidget({
        data,
        specPath,

        buildExpression:
            refs => {
                if (
                    !refs.left &&
                    !refs.right &&
                    !hasMeaningfulStyles(
                        getStyles(data)
                    )
                ) {
                    return 'const SizedBox.shrink()';
                }

                const left =
                    widgetInvocation(
                        refs.left,
                        '',
                        'left'
                    );

                const right =
                    widgetInvocation(
                        refs.right,
                        '',
                        'right'
                    );

                const branch =
                    refs.right
                        ? `(
                            ${stateIdentifier('condition')} == true
                                ? ${right}
                                : ${left}
                          )`
                        : left;

                return applyInteractions(
                    data,
                    containerExpression(
                        getStyles(data),
                        branch
                    )
                );
            }
    });
}


// -----------------------------------------------------------------------------
// LOOP GENERATOR
// -----------------------------------------------------------------------------

function loopExpression(
    data,
    refs
) {
    if (
        !refs.feed &&
        !hasMeaningfulStyles(
            getStyles(data)
        )
    ) {
        return 'const SizedBox.shrink()';
    }

    if (
        !refs.feed
    ) {
        return 'const SizedBox.shrink()';
    }

    const frame =
        getFrame(data);

    const frameBase =
        `${frame?.base ?? 'column.start'}`
            .trim()
            .toLowerCase();

    const frameStyles =
        frame?.baseStyles ??
        {};

    const isRow =
        frameBase.startsWith(
            'row'
        );

    const wrap =
        `${frameStyles.flexWrap ?? 'nowrap'}`
            .trim()
            .toLowerCase() ===
        'wrap';

    const scroll =
        normalizedScroll(
            data
        );

    const items =
        `core.List<dynamic>.from(
            ${stateIdentifier('data')}
            ??
            const []
        )`;

    const feedClass =
        refs.feed.className;

    const loopFixedHeight =
        fixedAxisValue(
            data,
            'height'
        );

    const gapValue =
        Number(
            frameStyles.spaceValue
        );

    const gap =
        Number.isFinite(
            gapValue
        ) &&
        gapValue > 0
            ? gapValue
            : 0;

    const mainAlignment =
        mainAxis(
            frameStyles.justifyContent
        );

    const crossAlignment =
        crossAxis(
            frameStyles.alignItems
        );

    const feedForIndex =
        indexExpr =>
            `${feedClass}(
                loopIndex: ${indexExpr},
                loopElement:
                    loopItems[
                        ${indexExpr}
                    ],
                instanceId: '\${widget.instanceId ?? 'root'}/\${loopItems[${indexExpr}] is Map ? (loopItems[${indexExpr}]['_key'] ?? loopItems[${indexExpr}]['id'] ?? loopItems[${indexExpr}]['key'] ?? ${indexExpr}) : ${indexExpr}}'
            )`;

    const rowChildren =
        gap > 0
            ? `[
                for (
                    int index = 0;
                    index < loopItems.length;
                    index++
                ) ...[
                    if (index > 0)
                        const SizedBox(
                            width: ${gap}
                        ),

                    ${feedForIndex('index')},
                ],
              ]`
            : `[
                for (
                    int index = 0;
                    index < loopItems.length;
                    index++
                )
                    ${feedForIndex('index')},
              ]`;

    const columnChildren =
        gap > 0
            ? `[
                for (
                    int index = 0;
                    index < loopItems.length;
                    index++
                ) ...[
                    if (index > 0)
                        const SizedBox(
                            height: ${gap}
                        ),

                    ${feedForIndex('index')},
                ],
              ]`
            : `[
                for (
                    int index = 0;
                    index < loopItems.length;
                    index++
                )
                    ${feedForIndex('index')},
              ]`;

    let repeatedContent;


    // -------------------------------------------------------------------------
    // WRAPPED ROW
    // -------------------------------------------------------------------------

    if (
        isRow &&
        wrap &&
        scroll ===
        'none'
    ) {
        repeatedContent =
            `Builder(
  builder: (context) {
    final loopItems =
        ${items};

    return Wrap(
      direction:
          Axis.horizontal,

      alignment:
          WrapAlignment.start,

      crossAxisAlignment:
          WrapCrossAlignment.start,

      spacing:
          ${gap},

      runSpacing:
          ${gap},

      children: [
        for (
          int index = 0;
          index < loopItems.length;
          index++
        )
          ${feedForIndex('index')},
      ],
    );
  },
)`;
    }


        // -------------------------------------------------------------------------
        // HORIZONTAL LOOP
    // -------------------------------------------------------------------------

    else if (
        isRow
    ) {
        const naturalRow =
            `Row(
  mainAxisSize:
      MainAxisSize.min,

  mainAxisAlignment:
      ${mainAlignment},

  crossAxisAlignment:
      ${crossAlignment},

  children:
      ${rowChildren},
)`;

        if (
            scroll ===
            'horizontal' ||
            scroll ===
            'both'
        ) {
            /*
             * Horizontal loops should stay lazy for large datasets.
             *
             * ListView requires a bounded cross-axis height. Resolve it in this
             * order:
             *
             *  1. explicit fixed height on the loop itself;
             *  2. fixed height exported by the feed component;
             *  3. a bounded height supplied by the parent.
             *
             * Only when none of those exist do we fall back to an eager
             * SingleChildScrollView + Row, because Flutter cannot create a
             * horizontal viewport without a finite height.
             */

            const explicitLoopHeight =
                loopFixedHeight !== null
                    ? `${loopFixedHeight}`
                    : 'null';

            repeatedContent =
                `LayoutBuilder(
  builder: (
    context,
    constraints
  ) {
    final loopItems =
        ${items};

    const double? explicitLoopHeight =
        ${explicitLoopHeight};

    final double? feedHeight =
        ${feedClass}.fastUIFixedHeight;

    final double? preferredHeight =
        explicitLoopHeight
        ??
        feedHeight;

    final double? resolvedHeight =
        constraints.hasBoundedHeight
            ? (
                preferredHeight == null
                ||
                preferredHeight > constraints.maxHeight
                    ? constraints.maxHeight
                    : preferredHeight
              )
            : preferredHeight;

    if (
      resolvedHeight != null
      &&
      resolvedHeight.isFinite
      &&
      resolvedHeight > 0
    ) {
      return SizedBox(
        height:
            resolvedHeight,

        child:
            ListView.separated(
          scrollDirection:
              Axis.horizontal,

          primary:
              false,

          itemCount:
              loopItems.length,

          separatorBuilder:
              (context, index) =>
                  const SizedBox(
                    width: ${gap}
                  ),

          itemBuilder:
              (context, index) =>
                  ${feedForIndex('index')},
        ),
      );
    }

    assert(() {
      if (loopItems.length > 50) {
        debugPrint(
          'FastUI warning: horizontal loop ${feedClass} has '
          '\${loopItems.length} items but no measurable height. '
          'Falling back to eager rendering. Give the loop or feed '
          'a fixed height so FastUI can use lazy ListView rendering.',
        );
      }

      return true;
    }());

    return SingleChildScrollView(
      scrollDirection:
          Axis.horizontal,

      primary:
          false,

      child:
          ${naturalRow},
    );
  },
)`;
        } else {
            /*
             * row.start / row.end describes layout.
             * It does not automatically imply horizontal scrolling.
             */

            repeatedContent =
                `Builder(
  builder: (context) {
    final loopItems =
        ${items};

    return ${naturalRow};
  },
)`;
        }
    }


        // -------------------------------------------------------------------------
        // VERTICAL LOOP
    // -------------------------------------------------------------------------

    else {
        const naturalColumn =
            `Column(
  mainAxisSize:
      MainAxisSize.min,

  mainAxisAlignment:
      ${mainAlignment},

  crossAxisAlignment:
      ${crossAlignment},

  children:
      ${columnChildren},
)`;

        if (
            scroll ===
            'vertical' ||
            scroll ===
            'both'
        ) {
            /*
             * ListView is used when Flutter gives us a real bounded viewport.
             *
             * If the height is unbounded, creating a vertical ListView would
             * cause the normal "Vertical viewport was given unbounded height"
             * failure. In that case emit a natural Column and allow the nearest
             * bounded page/body scroll area to own the scrolling.
             */

            repeatedContent =
                `LayoutBuilder(
  builder: (
    context,
    constraints
  ) {
    final loopItems =
        ${items};

    if (
      constraints.hasBoundedWidth
      &&
      constraints.hasBoundedHeight
    ) {
      return ListView.separated(
        scrollDirection:
            Axis.vertical,

        primary:
            false,

        itemCount:
            loopItems.length,

        separatorBuilder:
            (context, index) =>
                const SizedBox(
                    height: ${gap}
                ),

        itemBuilder:
            (context, index) =>
                ${feedForIndex('index')},
      );
    }

    return ${naturalColumn};
  },
)`;
        } else {
            repeatedContent =
                `Builder(
  builder: (context) {
    final loopItems =
        ${items};

    return ${naturalColumn};
  },
)`;
        }
    }


    // -------------------------------------------------------------------------
    // BOTH AXES
    // -------------------------------------------------------------------------

    if (
        scroll ===
        'both'
    ) {
        repeatedContent =
            isRow
                ? `SingleChildScrollView(
                    scrollDirection:
                        Axis.vertical,

                    primary:
                        false,

                    child:
                        ${repeatedContent}
                  )`
                : `SingleChildScrollView(
                    scrollDirection:
                        Axis.horizontal,

                    primary:
                        false,

                    child:
                        ${repeatedContent}
                  )`;
    }


    // -------------------------------------------------------------------------
    // LOOP OWN STYLES
    // -------------------------------------------------------------------------

    const ownStyles =
        getStyles(data);

    if (
        hasMeaningfulStyles(
            ownStyles
        )
    ) {
        repeatedContent =
            containerExpression(
                ownStyles,
                repeatedContent
            );
    }


    // -------------------------------------------------------------------------
    // FRAME STYLES
    // -------------------------------------------------------------------------

    const frameContainerStyles =
        stripLayoutKeys(
            frameStyles
        );

    /*
     * Already consumed by loop renderer.
     */
    delete frameContainerStyles.flexWrap;
    delete frameContainerStyles.overflow;
    delete frameContainerStyles.overflowX;
    delete frameContainerStyles.overflowY;

    if (
        Object.keys(
            frameContainerStyles
        ).length > 0
    ) {
        repeatedContent =
            containerExpression(
                frameContainerStyles,
                repeatedContent
            );
    }


    // -------------------------------------------------------------------------
    // OVERFLOW / CLIPPING
    // -------------------------------------------------------------------------

    const overflow =
        `${frameStyles.overflow ?? ''}`
            .trim()
            .toLowerCase();

    const overflowX =
        `${frameStyles.overflowX ?? ''}`
            .trim()
            .toLowerCase();

    const overflowY =
        `${frameStyles.overflowY ?? ''}`
            .trim()
            .toLowerCase();

    if (
        [
            'hidden',
            'clip'
        ].includes(
            overflow
        )
        ||
        [
            'hidden',
            'clip'
        ].includes(
            overflowX
        )
        ||
        [
            'hidden',
            'clip'
        ].includes(
            overflowY
        )
    ) {
        const radius =
            borderRadius(
                frameStyles
            );

        repeatedContent =
            radius
                ? `ClipRRect(
                    borderRadius:
                        ${radius},

                    child:
                        ${repeatedContent}
                  )`
                : `ClipRect(
                    child:
                        ${repeatedContent}
                  )`;
    }

    return applyInteractions(
        data,
        repeatedContent
    );
}


// -----------------------------------------------------------------------------
// PUBLIC LOOP GENERATOR
// -----------------------------------------------------------------------------

export async function composeFlutterLoop({
                                             data,
                                             path: specPath
                                         }) {
    if (!data) {
        return;
    }

    data = {
        ...data,

        modifier: {
            ...data.modifier,

            states: {
                data: [],
                ...data.modifier?.states,
            },
        },
    };

    await writeWidget({
        data,
        specPath,

        /*
         * Critical:
         *
         * loopExpression already owns the Row / Column / Wrap and the
         * SingleChildScrollView / ListView.
         *
         * Do NOT send it through composeFrame() again.
         */
        composeFrameEnabled:
            false,

        buildExpression:
            refs =>
                loopExpression(
                    data,
                    refs
                ),
    });
}
