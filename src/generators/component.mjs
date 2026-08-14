import {getTemplateSelected} from "../tooling/config.mjs";
import {composeFlutterComponent} from "./templates/flutter/generator.mjs";
import {composeReactComponent} from "./templates/reactjs/generator.mjs";

/**
 * Dispatches component generation to the React or Flutter template based on
 * the selected target. All framework-specific code lives in
 * templates/reactjs/generator.mjs and templates/flutter/generator.mjs.
 *
 * @param data {*} map of the specification
 * @param path {string} specification path
 * @param projectPath {string} project root path
 * @return {Promise<void>}
 */
export async function composeComponent({data, path, projectPath}) {
    if (!data) {
        return;
    }
    if (getTemplateSelected() === 'flutter') {
        return composeFlutterComponent({data, path, projectPath});
    }
    return composeReactComponent({data, path, projectPath});
}
