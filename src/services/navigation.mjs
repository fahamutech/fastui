const surfaceSuffix = /_(bottom_sheet|sheet|dialog|page)$/i;

export function normalizeRouteType(value, fallback = 'page') {
    const type = `${value ?? ''}`.trim().toLowerCase().replaceAll('-', '_');
    if (type === 'bottom_sheet' || type === 'sheet') return 'sheet';
    if (['page', 'dialog', 'close', 'back'].includes(type)) return type;
    return fallback;
}

export function routeFromSurfaceName(value) {
    const name = `${value ?? ''}`.trim();
    const match = name.match(surfaceSuffix);
    const rawType = match?.[1] ?? 'page';
    return {
        name: match ? name.slice(0, -match[0].length) : name,
        type: normalizeRouteType(rawType),
        explicitType: Boolean(match),
        surfaceName: name
    };
}

export const isRouteSurfaceName = value => surfaceSuffix.test(`${value ?? ''}`.trim());

function prototypeActions(child) {
    return (child?.interactions ?? [])
        .flatMap(interaction => interaction?.actions ?? [])
        .filter(Boolean);
}

function actionKind(action) {
    return `${action?.navigation ?? action?.type ?? ''}`.trim().toUpperCase();
}

/**
 * Converts both current Figma NODE actions and legacy transitionNodeID data to
 * a platform-neutral route instruction.
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

    const destinationId = action?.destinationId ?? action?.transitionNodeID ?? child?.transitionNodeID;
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
