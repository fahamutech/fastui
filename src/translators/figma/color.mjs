import {itOrEmptyList} from '../../shared/fn.mjs';

/**
 * Converts the first SOLID paint in a Figma `fills`/`strokes` array to a CSS
 * `rgba(...)` string, applying both the paint's own alpha and its layer
 * opacity.
 * @param source {*[]}
 * @return {string|undefined}
 */
export function getColor(source) {
    const getAlpha = value => Math.max(0, Math.min(1,
        Number(value?.color?.a ?? 1) * Number(value?.opacity ?? 1)
    ));
    return itOrEmptyList(source)
        .filter(x => x?.type === 'SOLID')
        .map(y => `rgba(${y?.color?.r * 255},${y?.color?.g * 255},${y?.color?.b * 255},${getAlpha(y)})`)
        .shift();
}
