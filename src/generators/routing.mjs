import {ensureReactAppRouteFile} from './templates/reactjs/routing.mjs';
import {ensureFlutterAppRouteFile} from './templates/flutter/routing.mjs';
import {ensurePathExist} from '../shared/fs.mjs';
import {readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';

const routeRegistryPath = () => resolve(join('.fastui', 'generated-routes.json'));

async function readRouteRegistry() {
    try {
        const registry = JSON.parse(await readFile(routeRegistryPath(), 'utf8'));
        return Array.isArray(registry?.pages) ? registry : undefined;
    } catch (_) {
        return undefined;
    }
}

function routeKey(page) {
    return `${page?.sourceId ?? page?.id ?? ''}`;
}

function mergeRoutePages(existing, incoming) {
    const routes = new Map(existing.map(page => [routeKey(page), page]));
    for (const page of incoming) routes.set(routeKey(page), page);
    return [...routes.values()];
}

/**
 * Dispatches AppRoute/routing-guard generation to the React or Flutter
 * template based on the selected target.
 * @param pages {{name: string, module: string}[]}
 * @param initialId {string}
 * @return {Promise<*>}
 */
export async function ensureAppRouteFileExist({pages, initialId, template = 'reactjs', merge = false}) {
    const registry = await readRouteRegistry();
    // A selected-node run can bootstrap a project that intentionally avoids
    // downloading a large full Figma document. Later selected-node runs merge
    // into this registry by source node ID.
    const resolvedPages = merge && registry ? mergeRoutePages(registry.pages, pages) : pages;
    const resolvedInitialId = merge && registry ? registry.initialId : initialId;
    if (template === 'flutter') {
        await ensureFlutterAppRouteFile({pages: resolvedPages, initialId: resolvedInitialId});
    } else {
        await ensureReactAppRouteFile({pages: resolvedPages, initialId: resolvedInitialId});
    }
    await ensurePathExist(resolve('.fastui'));
    await writeFile(routeRegistryPath(), JSON.stringify({version: 1, initialId: resolvedInitialId, pages: resolvedPages}, null, 2));
}
