import {getTemplateSelected} from "../tooling/config.mjs";
import {composeFlutterLoop} from "./templates/flutter/generator.mjs";
import {composeReactLoop} from "./templates/reactjs/generator.mjs";

/**
 * Dispatches loop generation to the React or Flutter template based on the
 * selected target. All framework-specific code lives in
 * templates/reactjs/generator.mjs and templates/flutter/generator.mjs.
 *
 * @param data {*} map of the specification
 * @param path {string} specification path
 * @param projectPath {string} project root path
 * @return {Promise<void>}
 */
export async function composeLoop({data, path, projectPath}) {
    if (!data) {
        return;
    }
    if (getTemplateSelected() === 'flutter') {
        return composeFlutterLoop({data, path, projectPath});
    }
    return composeReactLoop({data, path, projectPath});
}
