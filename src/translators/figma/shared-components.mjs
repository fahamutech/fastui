/**
 * Figma COMPONENT/INSTANCE handling: finding every component definition
 * used by the document (even ones only referenced as an INSTANCE, never
 * placed on a canvas themselves) so they can be generated once under
 * `modules/shared/common` and reused from every call site by pointing an
 * INSTANCE spec's `base` at the shared MAIN COMPONENT spec (top-down
 * `extend` composition, not structural `ref`).
 */
import {dirname, join, relative, resolve, sep} from 'node:path';
import {generatedNodeName} from './naming.mjs';

function walkFigmaNodes(node, visit) {
    if (!node) return;
    visit(node);
    for (const child of node?.children ?? []) walkFigmaNodes(child, visit);
}

/**
 * Walks the whole document once, pairing every INSTANCE with its COMPONENT
 * definition (synthesizing one from the first instance when Figma didn't
 * send the definition itself), and records each under a stable generated
 * name in `sharedComponentMap`.
 * @param document {*}
 * @param components {Record<string, *>}
 * @param sharedComponentMap {Record<string, {name: string, node: *}>} output
 * map, owned by the current translation run (see translators/figma/tree.mjs)
 * @return {[string, *][]} `[componentId, componentNode]` entries
 */
export function collectSharedComponents(document, components = {}, sharedComponentMap = {}) {
    const definitions = new Map();
    const instances = new Map();
    walkFigmaNodes(document, node => {
        if (node?.type === 'COMPONENT' && node?.id) definitions.set(node.id, node);
        if (node?.type === 'INSTANCE' && node?.componentId && !instances.has(node.componentId)) {
            instances.set(node.componentId, node);
        }
    });
    for (const [componentId, instance] of instances) {
        if (!definitions.has(componentId)) {
            definitions.set(componentId, {
                ...structuredClone(instance),
                id: componentId,
                name: components?.[componentId]?.name ?? instance?.name,
                type: 'COMPONENT'
            });
        }
    }
    for (const [componentId, node] of definitions) {
        sharedComponentMap[componentId] = {name: generatedNodeName(node, componentId), node};
    }
    return [...definitions.entries()];
}

/**
 * The `base:` path a Figma INSTANCE spec should point at to reuse its
 * already-generated shared MAIN COMPONENT spec, relative to the spec file
 * being written. `specs/reader.mjs` resolves this the same way it resolves
 * any other `base` spec-file reference: the shared spec's shape is read
 * first, then this instance's own `modifier` is deep-merged on top.
 * @return {string|undefined}
 */
export function sharedComponentBasePath({filename, child, srcPath, sharedComponentMap = {}}) {
    if (child?.type !== 'INSTANCE' || !child?.componentId) return undefined;
    const shared = sharedComponentMap[child.componentId];
    if (!shared) return undefined;
    let path = relative(dirname(filename), resolve(join(srcPath, 'modules', 'shared', 'common', `${shared.name}.yml`))).split(sep).join('/');
    if (!path.startsWith('.')) path = `./${path}`;
    return path;
}
