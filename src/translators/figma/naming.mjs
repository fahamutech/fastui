/**
 * Pure name/id helpers for turning Figma node metadata into FastUI spec
 * identifiers. Centralizing these removes the three near-identical
 * `i${id}_${name}` expressions that used to be duplicated across the
 * translator.
 */
import {firstUpperCaseRestSmall, justString} from '../../shared/fn.mjs';

/**
 * The generated FastUI node name for a Figma node: `i<id>_<Name>` with every
 * non-alphanumeric character folded to `_`. Used both for per-child spec file
 * names and for shared-component definition names.
 * @param node {*}
 * @param id {string}
 * @return {string}
 */
export function generatedNodeName(node, id = node?.id) {
    return `i${id}_${firstUpperCaseRestSmall(node?.name)}`.replaceAll(/[^a-zA-Z0-9]/ig, '_');
}

/**
 * The trailing `_word` suffix of a Figma layer name, lowercased. This is the
 * naming convention designers use to flag special behavior (`_condition`,
 * `_loop`/`_repeat`, `_button`, `_input`, `_image`, etc).
 * @param child {*}
 * @return {string}
 */
export function getBaseType(child) {
    return (`${child?.name}`.split('_').pop() ?? '').toLowerCase();
}

/**
 * Strips the generated `i<id>_` prefix and the trailing "role" segment from a
 * loop element's own generated name, producing the key FastUI reads it back
 * under on `inputs.loopElement`.
 * @param child {*}
 * @return {string}
 */
export function sanitizedNameForLoopElement(child) {
    const id = child?.id ?? '';
    const name = child?.name;
    const stripped = `${name}`.trim().replaceAll(`i${id?.replaceAll(':', '_')}_`, '');
    const chunks = stripped.split('_');
    if (chunks.length > 1) {
        chunks.pop();
    }
    return chunks.map(x => `${x.toLowerCase()}`).join('_');
}

/**
 * Figma page/frame names may carry a `[module/path]` suffix used to group
 * generated files under a module folder. These two helpers split a raw layer
 * name into the visible route name and the module path. When no `[...]`
 * suffix is present, `moduleFromName` returns an empty string so the caller
 * can fall back to a default surface folder (e.g. `presentation/pages`)
 * instead of guessing a per-page module from the visible name.
 */
export const stripModuleSuffix = value => justString(value).replaceAll(/(\[.*])/g, '').trim();
export const moduleFromName = value => (justString(value).match(/\[(.*)]/)?.[1] ?? '').trim();
