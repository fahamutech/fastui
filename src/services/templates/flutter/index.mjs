import {BaseTemplate} from "../base.mjs";

export class FlutterTemplate extends BaseTemplate {
    statePresentation(states, getStateIV) {
        return Object.keys(states ?? {})
            .map(key => `late dynamic state_${key}; // initialized with ${getStateIV(key)}`)
            .join('\n');
    }

    sideEffectsPresentation(effects, getBody) {
        return Object.keys(effects ?? {})
            .map(key => `${getBody(key)}(_componentContext());`)
            .join('\n');
    }

    inputsPresentation(inputs) {
        return Array.from(new Set(inputs)).join(',');
    }
}
