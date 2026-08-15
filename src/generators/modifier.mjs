/**
 * Accessors over a resolved spec document's `modifier` object. Every
 * React/Flutter generator reads spec fields exclusively through these
 * functions instead of poking at `data.modifier.*` directly, so the spec
 * shape only has one place to change.
 */

/**
 * @param data
 * @return {{type: string, value: (*|string)}|{type: string, value: string | undefined}}
 */
export function getChildren(data) {
    const modifier = {...data?.modifier ?? {}};
    const children = modifier?.props?.children;
    if (`${children}`.trim().toLowerCase().startsWith('states.')) {
        return {type: 'state', value: `${children}`?.replace(/^(states.)/ig, '')};
    } else if (`${children}`.trim().toLowerCase().startsWith('components.')) {
        return {type: 'component', value: `${children}`?.replace(/^(components.)/ig, '')};
    } else if (`${children}`.trim().toLowerCase().startsWith('inputs.')) {
        return {type: 'input', value: `${children}`?.replace(/^(inputs.)/ig, '')};
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
 * The composer's own frame contract: `{base, id, current, next}`.
 * - `base` is the outer layout token (row.start/row.end/column.start/
 *   column.end/*.stack) governing how the current view and every extended
 *   child wrapper are ordered.
 * - `current` are styles applied only to this node's own rendered view.
 * - `next` are styles applied uniformly to each extended child's wrapper.
 * Normalizes on read (accepting the legacy `frame.styles` field as
 * `current`) so this accessor is correct whether or not legacy-spec.mjs's
 * normalization already ran on `data`.
 */
export function getFrame(data) {
    const frame = data?.modifier?.frame;
    if (typeof frame === 'string') return {base: frame, id: undefined, current: {}, next: {}};
    return {
        base: frame?.base,
        id: frame?.id,
        current: {...(frame?.current ?? frame?.styles ?? {})},
        next: {...(frame?.next ?? {})},
    };
}

/**
 * Ordered list of child spec paths this node composes as its top-down
 * children. Always normalized to an array by legacy-spec.mjs, so this is a
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
