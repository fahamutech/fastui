/** Normalize current FastUI specs into the single shape consumed by both generators. */
const specificationKeys = ['component', 'condition', 'loop'];

function normalizeExtend(modifier = {}) {
    const extend = modifier.extend;
    if (Array.isArray(extend)) return extend.filter(item => typeof item === 'string' && item);
    if (typeof extend === 'string' && extend) return [extend];
    return [];
}

function normalizeFrame(modifier = {}) {
    const frame = modifier.frame;
    if (typeof frame === 'string') return {base: frame, id: undefined, current: {}, next: {}};
    if (frame?.styles !== undefined) {
        throw new Error('Unsupported frame.styles. Use frame.current.');
    }
    return {
        base: frame?.base,
        id: frame?.id,
        current: {...(frame?.current ?? {})},
        next: {...(frame?.next ?? {})},
    };
}

export function normalizeComposition(data = {}) {
    const output = structuredClone(data);
    output.modifier = {...output.modifier};
    for (const key of ['compose', 'ref', 'wrapper']) {
        if (output.modifier[key] !== undefined || output[key] !== undefined) {
            throw new Error(`Unsupported ${key} composition field. Use modifier.extend and modifier.frame.`);
        }
    }
    output.modifier.extend = normalizeExtend(output.modifier);
    output.modifier.frame = normalizeFrame(output.modifier);
    return output;
}

export function normalizeSpecDocument(document = {}) {
    if (document.app !== undefined || document.components !== undefined) {
        throw new Error('Unsupported spec root alias. Use component, condition, or loop.');
    }
    for (const key of specificationKeys) {
        if (document[key]) return {kind: key, data: normalizeComposition(document[key])};
    }
    return {kind: 'unknown', data: null};
}

export function prepareBehavior(kind, data) {
    const output = normalizeComposition(data);
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
