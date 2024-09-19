export class BaseTemplate {


    /**
     *
     * @param states {{[sting]:*}} - all key value states
     * @param getStateIV {(string)=>*} - get state initial value
     * @return {string}
     */
    statePresentation(states, getStateIV) {
        throw new Error('Not implemented');
    }

    /**
     *
     * @param effects {{[sting]:*}} - all key value effects
     * @param getBody {(string)=>string}
     * @param getDependencies {(string)=>string}
     */
    sideEffectsPresentation(effects, getBody, getDependencies) {
        throw new Error('Not implemented');
    }

    /**
     *
     * @param inputs {string[]}
     * @return string
     */
    inputsPresentation(inputs) {
        throw new Error('Not implemented');
    }
}