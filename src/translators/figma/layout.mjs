import {itOrEmptyList} from '../../shared/fn.mjs';
import {getColor} from './color.mjs';

/**
 * Maps a Figma axis-alignment enum to the matching CSS flexbox value.
 * @param counterAxisAlignItems {string}
 * @return {string}
 */
export function transformLayoutAxisAlign(counterAxisAlignItems) {
    switch (counterAxisAlignItems) {
        case 'MIN':
            return 'flex-start';
        case 'MAX':
            return 'flex-end';
        case 'CENTER':
            return 'center';
        case 'STRETCH':
            return 'stretch';
        case 'SPACE_BETWEEN':
            return 'space-between';
        default:
            return 'normal';
    }
}

export function transformLayoutWrap(layoutWrap) {
    return `${layoutWrap ?? 'NOWRAP'}`.replaceAll('_', '').toLowerCase();
}

/**
 * A Figma dimension only translates to a fixed CSS length when the node's
 * sizing mode for that axis is FIXED; HUG/FILL are expressed via other style
 * properties instead.
 */
export function getSize(layoutSizing, size) {
    return layoutSizing === 'FIXED' ? size : undefined;
}

export function isRepeatType(value) {
    return value === 'loop' || value === 'repeat';
}

/**
 * Returns the intended scroll direction for a loop node.
 *
 * Prefer an explicitly authored scroll value or Figma overflow direction.
 * Loops otherwise emit their layout axis so generated YAML always has the
 * `props.scroll` required by loop renderers.
 */
export function loopScrollDirection(node) {
    const explicitScroll = node?.props?.scroll ?? node?.scroll;
    if (['horizontal', 'vertical', 'both'].includes(explicitScroll)) return explicitScroll;
    const overflowDirection = node?.overflowDirection ?? node?.mainFrame?.overflowDirection;
    if (overflowDirection === 'HORIZONTAL_AND_VERTICAL_SCROLLING') return 'both';
    if (overflowDirection === 'HORIZONTAL_SCROLLING') return 'horizontal';
    if (overflowDirection === 'VERTICAL_SCROLLING') return 'vertical';
    const frameBase = node?.mainFrame?.base;
    const layout = `${frameBase?.type ?? frameBase ?? node?.layoutMode ?? ''}`.toLowerCase();
    if (layout.startsWith('row') || layout === 'horizontal') return 'horizontal';
    if (layout.startsWith('column') || layout === 'vertical') return 'vertical';
    return undefined;
}


/**
 * Returns the intended scroll direction for a component node.
 *
 * Scroll is **intentional** — it must be explicitly configured by the designer
 * in Figma. Never infer scroll from `layoutMode`: the layout axis controls how
 * children are arranged, not whether the container scrolls. A designer who
 * wants the list to scroll should set the frame's Overflow to "Scroll" in the
 * Figma prototype/design panel (which surfaces as `overflowDirection`).
 *
 * Returns `undefined` when no explicit scroll direction is set, which causes
 * the generated loop to render as a static list matching `frame.base`.
 */
export function componentScrollDirection(node) {
    const overflowDirection = node?.overflowDirection ?? node?.mainFrame?.overflowDirection;
    if (overflowDirection === 'HORIZONTAL_AND_VERTICAL_SCROLLING') return 'both';
    if (overflowDirection === 'HORIZONTAL_SCROLLING') return 'horizontal';
    if (overflowDirection === 'VERTICAL_SCROLLING') return 'vertical';
    return undefined;
}

/**
 * @param source {*[]}
 * @return {string|undefined} the `imageRef` of the first IMAGE paint, used to
 * look up/download the corresponding asset.
 */
export function getImageRef(source) {
    return itOrEmptyList(source)
        .filter(x => x?.type === 'IMAGE')
        .map(y => y?.imageRef)
        .shift();
}

function getBorderStyles(child) {
    if (itOrEmptyList(child?.strokes).length === 0) {
        return {};
    }
    return {
        borderTopWidth: child?.individualStrokeWeights?.top ?? child?.strokeWeight,
        borderLeftWidth: child?.individualStrokeWeights?.left ?? child?.strokeWeight,
        borderRightWidth: child?.individualStrokeWeights?.right ?? child?.strokeWeight,
        borderBottomWidth: child?.individualStrokeWeights?.bottom ?? child?.strokeWeight,
        borderColor: getColor(child?.strokes),
        borderStyle: itOrEmptyList(child?.strokeDashes).length > 0 ? 'dashed' : 'solid'
    };
}

/**
 * The CSS-ish style bag shared by every container-like node: fills, corner
 * radii, and border, plus the optional resolved background image.
 * @param child {*}
 * @param backGroundImage {string|undefined}
 * @return {object}
 */
export function getContainerLikeStyles(child, backGroundImage) {
    return {
        ...child?.style ?? {},
        borderRadius: child?.cornerRadius,
        borderTopLeftRadius: child?.rectangleCornerRadii?.[0],
        borderTopRightRadius: child?.rectangleCornerRadii?.[1],
        borderBottomRightRadius: child?.rectangleCornerRadii?.[2],
        borderBottomLeftRadius: child?.rectangleCornerRadii?.[3],
        backgroundColor: getColor(child?.fills),
        backgroundSize: backGroundImage ? 'cover' : undefined,
        backgroundPosition: backGroundImage ? 'center' : undefined,
        backgroundImage: backGroundImage ? `url("${backGroundImage}")` : undefined,
        ...getBorderStyles(child)
    };
}

/**
 * Fixed width/height for leaf nodes (text/image/rectangle). Icons keep an
 * intrinsic width so they never get pinned to their Figma render width.
 * @param child {*}
 * @return {{width: (string|undefined), height: (string|undefined)}}
 */
export function getSizeStyles(child) {
    return {
        width: `${child?.name}`.endsWith('_icon') ? undefined : getSize(child?.layoutSizingHorizontal, child?.absoluteBoundingBox?.width),
        height: getSize(child?.layoutSizingVertical, child?.absoluteBoundingBox?.height),
    };
}
