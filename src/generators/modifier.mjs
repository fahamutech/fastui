/**
 * Accessors over a resolved spec document's `modifier` object. Every
 * React/Flutter generator reads spec fields exclusively through these
 * functions instead of poking at `data.modifier.*` directly, so the spec
 * shape only has one place to change.
 */

/**
 * Parses `logics.*` / `services.*` references, including direct calls such as
 * `logics.t('hello')`, into `{name,argsSource,isCall}`.
 * @param value {*}
 * @return {{name: string, argsSource: string, isCall: boolean}|null}
 */
export function parseLogicReference(value) {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    if (!/^(?:logics|services)\./i.test(text)) return null;
    const body = text.replace(/^(?:logics|services)\./i, '');
    const call = body.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\((.*)\)$/s);
    if (call) {
        return {name: call[1], argsSource: call[2].trim(), isCall: true};
    }
    return {name: body.replace(/\(\)$/g, ''), argsSource: '', isCall: /\(\)$/.test(body)};
}

/**
 * @param data
 * @return {{type: string, value: (*|string), logic?: {name: string, argsSource: string, isCall: boolean}}|{type: string, value: string | undefined}}
 */
export function getChildren(data) {
    const modifier = {...data?.modifier ?? {}};
    const children = modifier?.props?.children;
    const logic = parseLogicReference(children);
    if (children?.translation && typeof children.translation === 'object') {
        return {type: 'translation', value: {...children.translation}};
    } else if (`${children}`.trim().toLowerCase().startsWith('states.')) {
        return {type: 'state', value: `${children}`?.replace(/^(states.)/ig, '')};
    } else if (`${children}`.trim().toLowerCase().startsWith('components.')) {
        return {type: 'component', value: `${children}`?.replace(/^(components.)/ig, '')};
    } else if (`${children}`.trim().toLowerCase().startsWith('inputs.')) {
        return {type: 'input', value: `${children}`?.replace(/^(inputs.)/ig, '')};
    } else if (logic) {
        return {type: 'logic', value: children, logic};
    } else {
        return {type: 'raw', value: children ?? ''};
    }
}

export function getStyles(data) {
    if (`${data?.modifier?.styles}`.trim().toLowerCase().startsWith('logics.')) {
        return data?.modifier?.styles ?? {};
    } else {
        return {...data?.modifier?.styles ?? {}};
    }
}

export function getProps(data) {
    return {...(data?.modifier?.props ?? {}), children: undefined};
}

export function getStates(data) {
    return {...data?.modifier?.states ?? {}};
}

export function getEffects(data) {
    return {...data?.modifier?.effects ?? {}};
}

/**
 * Resolves `frame.base` to `{token, baseStyles}`.
 * Accepts two forms:
 *   - string: "row.start"  → {token: "row.start", baseStyles: {}}
 *   - object: {type: "row.start", styles: {...}}  → {token: "row.start", baseStyles: {...}}
 */
function resolveFrameBase(base) {
    if (!base) return {token: undefined, baseStyles: {}};
    if (typeof base === 'string') return {token: base, baseStyles: {}};
    return {
        token: base?.type,
        baseStyles: {...(base?.styles ?? {})},
    };
}

/**
 * The composer's own frame contract: `{base, id, current, next, baseStyles}`.
 * - `base`       : the outer layout token (row.start/row.end/column.start/
 *                  column.end/*.stack) governing how the current view and
 *                  every extended child wrapper are ordered.
 * - `baseStyles` : optional CSS applied to the `_base` outer container div.
 *                  Set when `frame.base` is authored as `{type, styles}`.
 * - `current`    : styles applied only to this node's own rendered view.
 * - `next`       : styles applied uniformly to each extended child's wrapper.
 * Reads the current `frame.current` composition contract.
 */
export function getFrame(data) {
    const frame = data?.modifier?.frame;
    if (typeof frame === 'string') return {base: frame, id: undefined, baseStyles: {}, current: {}, next: {}};
    const {token, baseStyles} = resolveFrameBase(frame?.base);
    return {
        base: token,
        id: frame?.id,
        baseStyles,
        current: {...(frame?.current ?? {})},
        next: {...(frame?.next ?? {})},
    };
}

/**
 * Ordered list of child spec paths this node composes as its top-down
 * children. Always normalized to an array by spec-normalizer.mjs, so this is a
 * thin, explicit accessor kept for readability at call sites.
 * @return {string[]}
 */
export function getExtendList(data) {
    const extend = data?.modifier?.extend;
    if (Array.isArray(extend)) return extend.filter(item => typeof item === 'string' && item);
    if (typeof extend === 'string' && extend) return [extend];
    return [];
}

export function getLeft(data) {
    return data?.modifier?.left;
}

export function getRight(data) {
    return data?.modifier?.right;
}

export function getFeed(data) {
    return data?.modifier?.feed;
}
