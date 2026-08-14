import {getEffects, getRight, getStates} from './modifier.mjs';

export function containsLogicReference(value) {
    if (typeof value === 'string') return /^(?:logics|services)\./i.test(value.trim());
    if (Array.isArray(value)) return value.some(containsLogicReference);
    if (value && typeof value === 'object') return Object.values(value).some(containsLogicReference);
    return false;
}

export function containsNavigationAction(value) {
    if (Array.isArray(value)) return value.some(containsNavigationAction);
    if (!value || typeof value !== 'object') return false;
    if (`${value.action ?? ''}`.toLowerCase().startsWith('navigation.')) return true;
    return Object.values(value).some(containsNavigationAction);
}

export function analyzeBehavior(data = {}, {kind = 'component'} = {}) {
    const states = getStates(data);
    const effects = getEffects(data);
    const hasLocalState = Object.keys(states).length > 0;
    const hasEffects = Object.keys(effects).length > 0;
    const hasCondition = kind === 'condition' && Boolean(getRight(data));
    const hasControllers = Object.keys(data?.modifier?.controllers ?? {}).length > 0;
    return {
        hasLocalState,
        hasEffects,
        hasCondition,
        hasControllers,
        hasLogic: containsLogicReference(data),
        hasNavigation: containsNavigationAction(data),
        requiresReactState: hasLocalState,
        requiresReactEffect: hasEffects,
        requiresFlutterStatefulWidget: hasLocalState || hasEffects || hasControllers,
    };
}
