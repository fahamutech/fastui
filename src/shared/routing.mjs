/**
 * Route-naming vocabulary shared by the Figma translator (which infers a
 * surface's route type from its layer name) and the React/Flutter route
 * generators (which need the same page/dialog/sheet vocabulary to emit
 * AppRoute code). Figma-specific prototype-interaction parsing lives in
 * translators/figma/route.mjs, which builds on top of this module.
 */
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
