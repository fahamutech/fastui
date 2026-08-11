const legacyKeys = ['component', 'components', 'condition', 'loop'];

function neutralDimension(value) {
    if (value === 'fill') return '100%';
    if (value === 'hug' || value === 'auto') return undefined;
    return value;
}

function neutralStyles(document = {}) {
    const style = document.style ?? {};
    const layout = document.layout ?? {};
    const typography = style.typography ?? {};
    const padding = style.padding ?? {};
    const margin = style.margin ?? {};
    return {
        ...style,
        ...typography,
        width: neutralDimension(layout.width ?? style.width),
        height: neutralDimension(layout.height ?? style.height),
        minWidth: layout.minWidth ?? style.minWidth,
        maxWidth: layout.maxWidth ?? style.maxWidth,
        minHeight: layout.minHeight ?? style.minHeight,
        maxHeight: layout.maxHeight ?? style.maxHeight,
        flex: layout.grow ?? style.flex,
        flexWrap: layout.wrap === true ? 'wrap' : layout.wrap === false ? 'nowrap' : style.flexWrap,
        justifyContent: layout.justify ?? style.justifyContent,
        alignItems: layout.align ?? style.alignItems,
        spaceValue: layout.gap ?? style.spaceValue,
        backgroundColor: style.fill?.color ?? style.backgroundColor,
        backgroundImage: style.fill?.image ? `url("${`${style.fill.image}`.replace(/^asset:\/\//, '')}")` : style.backgroundImage,
        backgroundSize: style.fill?.fit ?? style.backgroundSize,
        borderRadius: style.radius?.all ?? style.borderRadius,
        borderWidth: style.border?.width ?? style.borderWidth,
        borderColor: style.border?.color ?? style.borderColor,
        paddingTop: padding.top ?? style.paddingTop,
        paddingRight: padding.right ?? style.paddingRight,
        paddingBottom: padding.bottom ?? style.paddingBottom,
        paddingLeft: padding.left ?? style.paddingLeft,
        marginTop: margin.top ?? style.marginTop,
        marginRight: margin.right ?? style.marginRight,
        marginBottom: margin.bottom ?? style.marginBottom,
        marginLeft: margin.left ?? style.marginLeft,
        opacity: style.opacity,
    };
}

function frameFromV2(document = {}) {
    const direction = document.layout?.direction ?? 'column';
    return {
        base: `${direction === 'row' ? 'row' : 'column'}.start`,
        id: `${document.id ?? 'fastui'}_frame`,
        styles: neutralStyles(document),
    };
}

function effectMap(effects = {}) {
    return Object.fromEntries(Object.entries(effects).map(([key, value]) => {
        if (typeof value === 'string') return [key, {body: value}];
        if (value?.body) return [key, value];
        const action = value?.action;
        return [key, action ? {body: action, watch: value.dependencies ?? value.watch ?? []} : value];
    }));
}

export function normalizeLegacyComposition(data = {}) {
    const output = structuredClone(data);
    output.modifier = {...output.modifier};
    if (output.modifier.compose && !output.modifier.extend && typeof output.modifier.compose === 'string') {
        output.modifier.extend = output.modifier.compose;
    }
    return output;
}

export function normalizeSpecDocument(document = {}) {
    for (const key of legacyKeys) {
        if (!document[key]) continue;
        return {kind: key === 'components' ? 'component' : key, data: normalizeLegacyComposition(document[key])};
    }

    if (`${document.version ?? ''}`.startsWith('fastui/') && document.kind === 'primitive') {
        return {kind: 'primitive', data: null};
    }

    if (!`${document.version ?? ''}`.startsWith('fastui/')) return {kind: 'unknown', data: null};
    const node = document.node ?? {};
    const props = {...document.props};
    if (node.type === 'text') props.children = props.value ?? '';
    if (node.type === 'image') props.src = props.source ?? '';
    if (node.type === 'container' && props.control === 'input') props.type = props.inputType ?? 'text';
    const data = normalizeLegacyComposition({
        base: node.type ?? 'container',
        modifier: {
            compose: typeof document.compose === 'string' ? document.compose : undefined,
            props,
            states: document.state ?? {},
            styles: neutralStyles(document),
            effects: effectMap(document.effects ?? {}),
            controllers: document.controllers ?? {},
            frame: frameFromV2(document),
            metadata: document.metadata ?? {},
        }
    });
    return {kind: document.kind === 'surface' ? 'component' : 'component', data};
}

export function prepareBehavior(kind, data) {
    const output = normalizeLegacyComposition(data);
    const stateTargets = new Set();
    const collectStateTargets = value => {
        if (Array.isArray(value)) return value.forEach(collectStateTargets);
        if (!value || typeof value !== 'object') return;
        if (value.action === 'state.set' && value.target) stateTargets.add(value.target);
        Object.values(value).forEach(collectStateTargets);
    };
    collectStateTargets(output?.modifier?.props);
    if (stateTargets.size > 0) {
        output.modifier.states = {...output.modifier.states};
        for (const target of stateTargets) {
            if (!(target in output.modifier.states)) output.modifier.states[target] = null;
        }
    }
    if (kind === 'condition' && output?.modifier?.right && output?.modifier?.states?.condition === undefined) {
        output.modifier.states = {condition: false, ...output.modifier.states};
    }
    if (kind === 'loop' && output?.modifier?.states?.data === undefined) {
        output.modifier.states = {data: [], ...output.modifier.states};
    }
    return output;
}
