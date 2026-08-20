import {parseLogicReference} from './modifier.mjs';

const referencePattern = /^(states|inputs)\.([A-Za-z_][A-Za-z0-9_]*)(?:\.(.*))?$/i;

/** Normalize one data-bearing value without introducing target-specific syntax. */
export function normalizeDataExpression(value) {
    if (value?.translation && typeof value.translation === 'object') {
        return {kind: 'translation', key: `${value.translation.key ?? ''}`, args: value.translation.args ?? {}};
    }
    if (value?.action) return {kind: 'inlineAction', value};
    const service = parseLogicReference(value);
    if (service) return {kind: 'service', ...service};
    if (typeof value === 'string') {
        const match = value.trim().match(referencePattern);
        if (match) {
            const scope = match[1].toLowerCase();
            const key = match[2];
            const rest = match[3];
            if (scope === 'inputs' && key === 'loopElement') {
                return {kind: 'loopElement', key: rest ?? '', source: value};
            }
            return {kind: scope === 'states' ? 'state' : 'input', key, rest, source: value};
        }
    }
    return {kind: 'literal', value};
}

/** Collect normalized bindings while excluding state declaration literals. */
export function analyzeDataBindings(data = {}) {
    const bindings = [];
    const visit = (value, path = []) => {
        const binding = normalizeDataExpression(value);
        if (binding.kind !== 'literal') bindings.push({...binding, path});
        if (typeof value === 'string' && !['state', 'input', 'loopElement'].includes(binding.kind)) {
            for (const match of value.matchAll(/\b(states|inputs)\.([A-Za-z_][A-Za-z0-9_]*)/gi)) {
                bindings.push({kind: match[1].toLowerCase() === 'states' ? 'state' : 'input', key: match[2], source: match[0], path});
            }
        }
        if (binding.kind === 'translation') {
            Object.entries(binding.args).forEach(([key, entry]) => visit(entry, [...path, 'translation', 'args', key]));
            return;
        }
        if (Array.isArray(value)) {
            value.forEach((entry, index) => visit(entry, [...path, index]));
        } else if (value && typeof value === 'object') {
            for (const [key, entry] of Object.entries(value)) {
                visit(entry, [...path, key]);
            }
        }
    };
    visit(data);
    return bindings;
}

export function referencedStateKeys(data = {}) {
    return [...new Set(analyzeDataBindings(data)
        .filter(binding => binding.kind === 'state' && !(binding.path[0] === 'modifier' && binding.path[1] === 'states'))
        .map(binding => binding.key))];
}

export function referencedInputKeys(data = {}) {
    return [...new Set(analyzeDataBindings(data).flatMap(binding => {
        if (binding.kind === 'input') return [binding.key];
        if (binding.kind === 'loopElement') return ['loopElement'];
        return [];
    }))];
}
