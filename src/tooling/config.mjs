import {loadEnvFile} from "./env.mjs";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";

await loadEnvFile();

export function normalizeTemplate(value, fallback = 'reactjs') {
    const selected = `${value ?? ''}`.trim().toLowerCase();
    return selected === 'flutter' || selected === 'reactjs' ? selected : fallback;
}

function readProjectTemplate() {
    try {
        const config = JSON.parse(readFileSync(resolve('fastui.config.json'), 'utf8'));
        return config?.template;
    } catch (_) {
        return undefined;
    }
}

export const getTemplateSelected = explicit => normalizeTemplate(
    explicit ?? process.env.FASTUI_TEMPLATE ?? process.env.TEMPLATE ?? readProjectTemplate()
);

export const getBlueprintRoot = template =>
    getTemplateSelected(template) === 'flutter' ? 'lib/blueprints' : 'src/blueprints';
