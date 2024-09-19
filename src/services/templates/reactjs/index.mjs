import {BaseTemplate} from "../base.mjs";
import {firstUpperCase} from "../../../utils/index.mjs";

export class ReactJSTemplate extends BaseTemplate {


    /**
     *
     * @param states {{[sting]:*}} - all key value states
     * @param getStateIV {(string)=>*} - get state initial value
     * @return {string}
     */
    statePresentation(states, getStateIV) {
        return Object
            .keys(states ?? {})
            .map(k => `const [${k},set${firstUpperCase(k)}] = React.useState(${getStateIV(k)});`)
            .join('\n\t');
    }

    /**
     *
     * @param effects {{[sting]:*}} - all key value effects
     * @param getBody {(string)=>string}
     * @param getDependencies {(string)=>string}
     * @return string
     */
    sideEffectsPresentation(effects, getBody, getDependencies) {
        return Object
            .keys(effects ?? {})
            .map(k => `/*${k}*/
    React.useEffect(()=>${getBody(k)}({component,args:[]}),
    /* eslint-disable-line react-hooks/exhaustive-deps */[${getDependencies(k) ?? ``}]);`)
            .join('\n\t');
    }

    /**
     *
     * @param inputs {string[]}
     * @return string
     */
    inputsPresentation(inputs) {
        return Array.from(inputs.reduce((a, b) => a.add(b), new Set())).join(',');
    }
}