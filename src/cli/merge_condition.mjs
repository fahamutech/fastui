/**
 * @typedef {Object} ConditionModifier
 * @property {Object} frame
 * @property {string} frame.base
 * @property {Object} frame.styles
 * @property {string} frame.id
 */

/**
 * @typedef {Object} Condition
 * @property {string} base
 * @property {ConditionModifier} modifier
 */

/**
 * Default values for condition configuration
 */
const DEFAULT_CONFIG = {
    BASE_TYPE: 'rectangle',
    FRAME_BASE: 'column.start',
    INITIAL_STATE: false,
    DEFAULT_EFFECT: {
        onStart: {
            body: 'logics.onStart',
            watch: []
        }
    }
};

/**
 * Processes and normalizes frame base string
 * @param {string} frameBase - The frame base string to process
 * @returns {string} Processed frame base string
 */
const normalizeFrameBase = (frameBase) => {
    if (!frameBase) return DEFAULT_CONFIG.FRAME_BASE;
    return frameBase.replace(/(\.\s*stack)/ig, '');
};

/**
 * Extracts frame properties from condition modifier
 * @param {ConditionModifier} modifier - The condition modifier object
 * @returns {Object} Extracted and processed frame properties
 */
const extractFrameProperties = (modifier) => {
    const frame = modifier?.frame || {};
    return {
        base: frame.base,
        styles: frame.styles || {},
        id: frame.id
    };
};

/**
 * Creates the merged frame configuration
 * @param {Object} frameProps - Frame properties
 * @param {string} frameBase - Base frame configuration
 * @returns {Object} Merged frame configuration
 */
const createFrameConfig = (frameProps, frameBase) => ({
    id: frameProps.id,
    base: normalizeFrameBase(frameBase || frameProps.base),
    styles: frameProps.styles
});

/**
 * Merges and processes condition configuration
 * @param {Condition} condition - The condition object to process
 * @returns {Condition|undefined} Processed condition or undefined if no input
 */
function getMergedCondition(condition) {
    // Return early if no condition provided
    if (!condition) return undefined;

    try {
        // Extract and process frame properties
        const frameProps = extractFrameProperties(condition.modifier);
        const frameBase = frameProps.base || condition?.modifier?.frame || DEFAULT_CONFIG.FRAME_BASE;

        // Construct merged condition
        return {
            ...condition,
            base: DEFAULT_CONFIG.BASE_TYPE,
            modifier: {
                ...condition.modifier || {},
                frame: createFrameConfig(frameProps, frameBase),
                states: { condition: DEFAULT_CONFIG.INITIAL_STATE },
                effects: DEFAULT_CONFIG.DEFAULT_EFFECT
            }
        };
    } catch (error) {
        console.error('Error processing condition:', error);
        return undefined;
    }
}

/**
 * Validation function for condition object (optional)
 * @param {Condition} condition - The condition to validate
 * @returns {boolean} Whether the condition is valid
 */
function isValidCondition(condition) {
    return condition &&
        typeof condition === 'object' &&
        (!condition.modifier || typeof condition.modifier === 'object');
}

// Export both main function and helpers for testing
export  {
    getMergedCondition,
    normalizeFrameBase,
    extractFrameProperties,
    createFrameConfig,
    isValidCondition,
    DEFAULT_CONFIG
};