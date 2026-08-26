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

/**
 * Converts the first visible Figma linear gradient into a CSS gradient.  The
 * spec format is deliberately CSS-like, so React can use this directly while
 * native generators can map the same canonical value to their paint APIs.
 */
export function getLinearGradient(source) {
    const paint = itOrEmptyList(source).find(item => item?.type === 'GRADIENT_LINEAR' && item?.visible !== false);
    if (!paint || !Array.isArray(paint.gradientStops) || paint.gradientStops.length < 2) return undefined;

    const stops = paint.gradientStops.map(stop => {
        const color = stop?.color ?? {};
        const alpha = Math.max(0, Math.min(1, Number(color.a ?? 1) * Number(paint.opacity ?? 1)));
        const red = Math.round(Math.max(0, Math.min(1, Number(color.r ?? 0))) * 255);
        const green = Math.round(Math.max(0, Math.min(1, Number(color.g ?? 0))) * 255);
        const blue = Math.round(Math.max(0, Math.min(1, Number(color.b ?? 0))) * 255);
        return `rgba(${red}, ${green}, ${blue}, ${alpha}) ${Math.round(Number(stop.position ?? 0) * 10000) / 100}%`;
    });

    const [start, end] = paint.gradientHandlePositions ?? [];
    // Figma handles express a direction vector; CSS measures clockwise from
    // the upward axis, hence the +90 degree conversion from atan2.
    const angle = start && end
        ? ((Math.atan2(Number(end.y) - Number(start.y), Number(end.x) - Number(start.x)) * 180 / Math.PI) + 90 + 360) % 360
        : 180;
    return `linear-gradient(${Math.round(angle * 1000) / 1000}deg, ${stops.join(', ')})`;
}
