import {ensureReactAppRouteFile} from './templates/reactjs/routing.mjs';
import {ensureFlutterAppRouteFile} from './templates/flutter/routing.mjs';

/**
 * Dispatches AppRoute/routing-guard generation to the React or Flutter
 * template based on the selected target.
 * @param pages {{name: string, module: string}[]}
 * @param initialId {string}
 * @return {Promise<*>}
 */
export async function ensureAppRouteFileExist({pages, initialId, template = 'reactjs'}) {
    if (template === 'flutter') {
        return ensureFlutterAppRouteFile({pages, initialId});
    }
    return ensureReactAppRouteFile({pages, initialId});
}
