import {BaseTemplate} from "../base.mjs";
import {firstUpperCase} from "../../../helpers/index.mjs";

export class FlutterTemplate extends BaseTemplate {

    /**
     * @param states {{[string]:*}}
     * @param getStateIV {(string)=>*}
     * @return {string}
     */
    statePresentation(states, getStateIV) {
        return Object
            .keys(states ?? {})
            .map(k => `  dynamic ${k} = ${getStateIV(k)};`)
            .join('\n');
    }

    /**
     * @param effects {{[string]:*}}
     * @param getBody {(string)=>string}
     * @param getDependencies {(string)=>string}
     * @return {string}
     */
    sideEffectsPresentation(effects, getBody, getDependencies) {
        return Object
            .keys(effects ?? {})
            .map(k => `    /*${k}*/ ${getBody(k)}(data: _component);`)
            .join('\n');
    }

    /**
     * @param inputs {string[]}
     * @return {string}
     */
    inputsPresentation(inputs) {
        return Array.from(inputs.reduce((a, b) => a.add(b), new Set())).join(',');
    }
}