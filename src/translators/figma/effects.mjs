import {itOrEmptyList} from '../../shared/fn.mjs';
import {getColor} from './color.mjs';

/**
 * @param child {*}
 * @return {string|undefined} CSS `blur(...)` filter, or undefined when the
 * node has no visible background-blur effect.
 */
export function getBackgroundBlurEffect(child) {
    const effect = itOrEmptyList(child?.effects).find(x => x?.type === 'BACKGROUND_BLUR');
    return effect?.visible ? `blur(${effect?.radius ?? 0}px)` : undefined;
}

/**
 * @param child {*}
 * @return {string|undefined} CSS `box-shadow` value for the node's drop or
 * inner shadow effect.
 */
export function getDropShadowEffect(child) {
    const effect = itOrEmptyList(child?.effects).find(x => x?.type === 'DROP_SHADOW')
        ?? itOrEmptyList(child?.effects).find(x => x?.type === 'INNER_SHADOW');
    const inner = effect?.type === 'INNER_SHADOW' ? 'inset' : '';
    const x = effect?.offset?.x ?? 0;
    const y = effect?.offset?.y ?? 0;
    const radius = effect?.radius ?? 0;
    const spread = effect?.spread ?? 0;
    const color = getColor([{type: 'SOLID', color: {...child?.color ?? {}}}]);
    return effect?.visible
        ? `${inner} ${x}px ${y}px ${radius}px ${spread}px ${color}`.trim()
        : undefined;
}

/**
 * @param child {*}
 * @return {string|undefined} CSS `blur(...)` filter for the node's own layer
 * blur effect.
 */
export function getLayerBlurEffect(child) {
    const effect = itOrEmptyList(child?.effects).find(x => x?.type === 'LAYER_BLUR');
    return effect?.visible ? `blur(${effect?.radius ?? 0}px)` : undefined;
}
