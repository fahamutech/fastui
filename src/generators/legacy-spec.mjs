/**
 * Normalizes a resolved spec document's legacy `component`/`condition`/`loop`
 * primitive into the shape the React/Flutter generators expect, and fills in
 * the implicit default state every condition/loop primitive relies on
 * (`condition: false`, `data: []`) plus any state target referenced by an
 * inline `state.set` action that wasn't declared under `modifier.states`.
 */
const legacyKeys = ['component', 'components', 'condition', 'loop'];

/**
 * Legacy specs may use the `compose` alias for `extend`; normalize it so
 * downstream generator code only ever has to read `modifier.extend`.
 */
export function normalizeLegacyComposition(data = {}) {
    const output = structuredClone(data);
    output.modifier = {...output.modifier};
    if (output.modifier.compose && !output.modifier.extend && typeof output.modifier.compose === 'string') {
        output.modifier.extend = output.modifier.compose;
    }
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
