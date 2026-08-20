/**
 * Turns Figma prototype interactions (click/tap actions wired up in the
 * Figma prototyping tab) into FastUI's platform-neutral action vocabulary:
 * `navigation.open`, `state.set`, or a `sequence` of both.
 */
import {normalizeRouteType, routeFromSurfaceName} from '../../shared/routing.mjs';

function prototypeActions(child) {
    return (child?.interactions ?? [])
        .flatMap(interaction => interaction?.actions ?? [])
        .filter(Boolean);
}

function actionKind(action) {
    return `${action?.navigation ?? action?.type ?? ''}`.trim().toUpperCase();
}

/**
 * Converts current Figma NODE actions to a platform-neutral route instruction.
 * @param child {*} the Figma node carrying `.interactions`
 * @param routeLookup {Record<string, *>} Figma node id -> route metadata,
 * built once per translation run by translators/figma/tree.mjs while walking
 * every page.
 */
export function resolvePrototypeRoute(child, routeLookup = {}) {
    const actions = prototypeActions(child);
    const action = actions.find(item => {
        const kind = actionKind(item);
        return ['NAVIGATE', 'OVERLAY', 'SWAP', 'SWAP_OVERLAY', 'BACK', 'CLOSE', 'CLOSE_OVERLAY'].includes(kind)
            || (`${item?.type}`.toUpperCase() === 'NODE' && item?.destinationId);
    });
    const kind = actionKind(action);
    if (kind === 'BACK') return {type: 'back'};
    if (kind === 'CLOSE' || kind === 'CLOSE_OVERLAY') return {type: 'close'};

    const destinationId = action?.destinationId;
    const target = destinationId ? routeLookup[destinationId] : undefined;
    if (!target) return {type: 'close'};

    const inferred = routeFromSurfaceName(target?.surfaceName ?? target?.name);
    const overlayAction = ['OVERLAY', 'SWAP', 'SWAP_OVERLAY'].includes(kind);
    return {
        ...target,
        name: target?.name ?? inferred.name,
        type: target?.explicitType
            ? normalizeRouteType(target?.type)
            : (overlayAction ? 'dialog' : normalizeRouteType(target?.type, inferred.type)),
        replace: kind === 'SWAP' || kind === 'SWAP_OVERLAY',
        transition: action?.transition,
        preserveScrollPosition: action?.preserveScrollPosition === true
    };
}

/**
 * Reduces a Figma node's raw `.interactions` into the `states` a stateful
 * component needs plus the single (or sequenced) `onClick` action FastUI
 * writes into the generated spec's `props.onClick`.
 * @param child {*}
 * @param routeLookup {Record<string, *>}
 * @return {{states: object, onClick: object|undefined}}
 */
export function interactionBehavior(child, routeLookup) {
    const actions = prototypeActions(child);
    const eventActions = [];
    const states = {};
    const navigationKinds = new Set(['NAVIGATE', 'OVERLAY', 'SWAP', 'SWAP_OVERLAY', 'BACK', 'CLOSE', 'CLOSE_OVERLAY']);
    const hasNavigation = actions.some(action => navigationKinds.has(`${action?.navigation ?? action?.type ?? ''}`.toUpperCase())
        || (`${action?.type ?? ''}`.toUpperCase() === 'NODE' && action?.destinationId));
    if (hasNavigation) {
        eventActions.push({action: 'navigation.open', ...resolvePrototypeRoute(child, routeLookup)});
    }
    for (const action of actions) {
        const kind = `${action?.type ?? action?.action ?? ''}`.toUpperCase();
        if (kind === 'CHANGE_TO') {
            states.variant = child?.id ?? null;
            eventActions.push({action: 'state.set', target: 'variant', value: action?.destinationId ?? action?.value});
        }
        if (kind === 'SET_VARIABLE') {
            const target = `variable_${`${action?.variableId ?? action?.variableName ?? 'value'}`.replace(/[^a-zA-Z0-9_]/g, '_')}`;
            const value = action?.variableValue?.value ?? action?.variableValue ?? action?.value ?? null;
            states[target] = action?.initialValue ?? null;
            eventActions.push({action: 'state.set', target, value});
        }
    }
    return {
        states,
        onClick: eventActions.length === 0
            ? undefined
            : eventActions.length === 1
                ? eventActions[0]
                : {action: 'sequence', actions: eventActions}
    };
}
