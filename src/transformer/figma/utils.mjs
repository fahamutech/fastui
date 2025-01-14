import {itOrEmptyList} from "../../helpers/general.mjs";

export function getImageRef(source) {
    return itOrEmptyList(source)
        .filter(x => x?.type === 'IMAGE')
        .map(y => y?.imageRef)
        .shift();
}

export function getColor(source) {
    const getAlpha = v =>
        (v?.color?.a > 0 && v?.color?.a < 1)
            ? (v?.color?.a ?? 1) * 255
            : v?.opacity ?? 1;
    return itOrEmptyList(source)
        .filter(x => x?.type === 'SOLID')
        .map(y => `rgba(${y?.color?.r * 255},${y?.color?.g * 255},${y?.color?.b * 255},${getAlpha(y)})`)
        .shift();
}

/**
 *
 * @param child
 * @param backGroundImage
 * @return {object}
 */
export function getContainerLikeStyles(child, backGroundImage) {
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
        }
    }
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
    }
}
