/**
 * @typedef {Object} LoopFrame
 * @property {string} base
 * @property {Object} styles
 * @property {string} id
 */

/**
 * @typedef {*} LoopModifier
 * @property {LoopFrame} frame
 */

/**
 * @typedef {Object} Loop
 * @property {string} base
 * @property {LoopModifier} modifier
 */

/**
 * Default configuration for loop processing
 */
const LOOP_DEFAULTS = {
    BASE_TYPE: 'rectangle',
    INITIAL_STATE: {
        data: []
    },
    DEFAULT_EFFECTS: {
        onStart: {
            body: 'logics.onStart',
            watch: []
        }
    },
    EMPTY_STYLES: {}
};

/**
 * Processes frame base string by removing stack suffix
 * @param {string} frameBase - The frame base string to process
 * @returns {string} Processed frame base string
 */
const processFrameBase = (frameBase) => {
    if (!frameBase) return '';
    return String(frameBase).replace(/(\.\s*stack)/ig, '');
};

/**
 * Extracts and normalizes frame properties
 * @param {LoopModifier} modifier - The loop modifier object
 * @returns {Object} Normalized frame properties
 */
const extractFrameProperties = (modifier) => {
    const frame = modifier?.frame || {};
    return {
        base: frame.base,
        styles: frame.styles || LOOP_DEFAULTS.EMPTY_STYLES,
        id: frame.id
    };
};

/**
 * Creates frame configuration object
 * @param {Object} frameProps - Frame properties
 * @param {string} frameBase - Base frame configuration
 * @returns {Object} Frame configuration
 */
const createFrameConfig = (frameProps, frameBase) => ({
    id: frameProps.id,
    base: processFrameBase(frameBase || frameProps.base),
    styles: frameProps.styles
});

/**
 * Creates modifier configuration
 * @param {LoopModifier} existingModifier - Existing modifier configuration
 * @param {Object} frameConfig - Frame configuration
 * @returns {Object} Complete modifier configuration
 */
const createModifierConfig = (existingModifier, frameConfig) => ({
    ...existingModifier,
    frame: frameConfig,
    states: LOOP_DEFAULTS.INITIAL_STATE,
    effects: LOOP_DEFAULTS.DEFAULT_EFFECTS
});

/**
 * Validates loop object structure
 * @param {Loop} loop - Loop object to validate
 * @returns {boolean} Validation result
 */
const isValidLoop = (loop) => {
    return loop && typeof loop === 'object';
};

/**
 * Merges and processes loop configuration
 * @param {Loop} loop - Loop configuration to process
 * @returns {Loop|undefined} Processed loop configuration or undefined
 * @throws {Error} When loop processing fails
 */
function getMergedLoop(loop) {
    if (!isValidLoop(loop)) {
        return undefined;
    }

    try {
        const frameProps = extractFrameProperties(loop.modifier);
        const frameBase = frameProps.base ?? loop?.modifier?.frame;
        const frameConfig = createFrameConfig(frameProps, frameBase);

        const modifierConfig = createModifierConfig(
            loop.modifier || {},
            frameConfig
        );

        return {
            ...loop,
            base: LOOP_DEFAULTS.BASE_TYPE,
            modifier: modifierConfig
        };
    } catch (error) {
        console.error('Error processing loop configuration:', error);
        throw new Error(`Loop processing failed: ${error.message}`);
    }
}

/**
 * Utility function to create a basic loop configuration
 * @param {Object} options - Loop configuration options
 * @returns {Loop} Basic loop configuration
 */
const createBasicLoop = ({ id, base, styles = {} } = {}) => ({
    base: LOOP_DEFAULTS.BASE_TYPE,
    modifier: {
        frame: { id, base, styles },
        states: LOOP_DEFAULTS.INITIAL_STATE,
        effects: LOOP_DEFAULTS.DEFAULT_EFFECTS
    }
});

// Export functions and constants
export  {
    getMergedLoop,
    processFrameBase,
    extractFrameProperties,
    createFrameConfig,
    createModifierConfig,
    isValidLoop,
    createBasicLoop,
    LOOP_DEFAULTS
};