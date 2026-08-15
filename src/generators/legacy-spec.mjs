/**
 * Normalizes a resolved spec document's `component`/`condition`/`loop`
 * primitive into the single top-down composition shape the React/Flutter
 * generators expect, and fills in the implicit default state every
 * condition/loop primitive relies on (`condition: false`, `data: []`) plus
 * any state target referenced by an inline `state.set` action that wasn't
 * declared under `modifier.states`.
 */
const legacyKeys = ['component', 'components', 'condition', 'loop'];

/**
 * `modifier.extend` may be authored as a single spec path or an ordered
 * array of spec paths; normalize it to an array so every generator reads one
 * shape.
 * @return {string[]}
 */
function normalizeExtend(modifier = {}) {
    const extend = modifier.extend;
    if (Array.isArray(extend)) return extend.filter(item => typeof item === 'string' && item);
    if (typeof extend === 'string' && extend) return [extend];
    return [];
}

/**
 * `modifier.frame` is always normalized to `{base, id, current, next}`.
 * Legacy documents that still only carry `frame.styles` (the pre-top-down
 * shape) are read as `frame.current` so already-authored specs keep working
 * without generators needing to know about the old field name.
 */
function normalizeFrame(modifier = {}) {
    const frame = modifier.frame;
    if (typeof frame === 'string') return {base: frame, id: undefined, current: {}, next: {}};
    return {
        base: frame?.base,
        id: frame?.id,
        current: {...(frame?.current ?? frame?.styles ?? {})},
        next: {...(frame?.next ?? {})},
    };
}

/**
 * Normalizes a spec document's composition fields into the single top-down
 * shape: `modifier.extend` as an ordered array and `modifier.frame` as
 * `{base, id, current, next}`. Removes every legacy composition field
 * (`compose`, `ref`, `wrapper`) so downstream generator code only ever has
 * to read the new shape.
 */
export function normalizeLegacyComposition(data = {}) {
    const output = structuredClone(data);
    output.modifier = {...output.modifier};
    output.modifier.extend = normalizeExtend(output.modifier);
    output.modifier.frame = normalizeFrame(output.modifier);
    delete output.modifier.compose;
    delete output.modifier.ref;
    delete output.modifier.wrapper;
    delete output.ref;
    return output;
}

/**
 * Determines which primitive (component/condition/loop) a spec document
 * declares, and normalizes its composition aliases. Documents that declare
 * none of the legacy primitive keys are reported as `unknown` so callers can
 * skip code generation for them.
 */
export function normalizeSpecDocument(document = {}) {
    for (const key of legacyKeys) {
        if (!document[key]) continue;
        return {kind: key === 'components' ? 'component' : key, data: normalizeLegacyComposition(document[key])};
    }
    return {kind: 'unknown', data: null};
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
