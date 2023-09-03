/**
 *
 * @param data
 * @return {{type: string, value: (*|string)}|{type: string, value: string | undefined}}
 */
export function getChildren(data) {
    const modifier = {...data?.modifier} ?? {};
    const children = modifier?.props?.children;
    if (`${children}`.trim().toLowerCase().startsWith('states.')) {
        return {type: 'state', value: `${children}`?.replace(/^(states.)/ig, '')};
    } else if (`${children}`.trim().toLowerCase().startsWith('components.')) {
        return {type: 'component', value: `${children}`?.replace(/^(components.)/ig, '')};
    } else if (`${children}`.trim().toLowerCase().startsWith('inputs.')) {
        return {type: 'input', value: `${children}`?.replace(/^(inputs.)/ig, '')};
    } else {
        return {type: 'raw', value: children ?? ''};
    }
}

export function getStyles(data) {
    if (`${data?.modifier?.styles}`.trim().toLowerCase().startsWith('logics.')) {
        return data?.modifier?.styles ?? {};
    } else {
        return {...data?.modifier?.styles ?? {}};
    }
}

export function getProps(data) {
    return {...(data?.modifier?.props ?? {}), children: undefined};
}

export function getStates(data) {
    return {...data?.modifier?.states ?? {}};
}

export function getEffects(data) {
    return {...data?.modifier?.effects ?? {}};
}

export function getFrame(data) {
    return data?.modifier?.frame;
}

export function getExtend(data){
    return data?.modifier?.extend;
}

export function getLeft(data){
    return data?.modifier?.left;
}

export function getRight(data){
    return data?.modifier?.right;
}

export function getFeed(data){
    return data?.modifier?.feed;
}