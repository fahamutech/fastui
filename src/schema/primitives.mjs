import {resolve} from 'node:path';
import * as yaml from 'js-yaml';

const commonMetadata = {figma: {nodeId: null, componentId: null, componentProps: {}}};

export const primitiveDocuments = {
    'text.spec.yml': {
        version: 'fastui/v2', kind: 'primitive', id: 'primitive.text', node: {type: 'text'},
        props: {value: '', selectable: false, maxLines: null, overflow: 'clip', textAlign: 'start', direction: 'auto', semanticsLabel: null},
        style: {color: null, typography: {fontFamily: null, fontSize: 14, fontWeight: 400, fontStyle: 'normal', lineHeight: 'auto', letterSpacing: 0, decoration: 'none', decorationColor: null}, opacity: 1},
        layout: {width: 'hug', height: 'hug', minWidth: null, maxWidth: null, minHeight: null, maxHeight: null, grow: 0, shrink: 0, alignSelf: 'auto'},
        metadata: commonMetadata,
    },
    'image.spec.yml': {
        version: 'fastui/v2', kind: 'primitive', id: 'primitive.image', node: {type: 'image'},
        props: {source: null, alt: '', semanticsLabel: null, fit: 'contain', alignment: 'center', repeat: 'noRepeat', placeholder: null, fallback: null},
        style: {tint: null, opacity: 1, radius: {all: 0, topLeft: null, topRight: null, bottomRight: null, bottomLeft: null}, border: {width: 0, color: null, style: 'solid'}, clip: true},
        layout: {width: 'hug', height: 'hug', minWidth: null, maxWidth: null, minHeight: null, maxHeight: null, aspectRatio: null, grow: 0, shrink: 0, alignSelf: 'auto'},
        metadata: commonMetadata,
    },
    'container.spec.yml': {
        version: 'fastui/v2', kind: 'primitive', id: 'primitive.container', node: {type: 'container'},
        props: {id: null, role: 'generic', enabled: true, focusable: false, semanticsLabel: null, onClick: null, onDoubleClick: null, onLongPress: null, onHover: null, onFocus: null, onBlur: null, control: 'none', value: null, placeholder: null, inputType: 'text', readOnly: false, multiline: false, onChange: null, onSubmit: null},
        layout: {direction: 'column', gap: 0, wrap: false, justify: 'start', align: 'start', alignSelf: 'auto', width: 'hug', height: 'hug', minWidth: null, maxWidth: null, minHeight: null, maxHeight: null, grow: 0, shrink: 0, position: 'relative', top: null, right: null, bottom: null, left: null, overflow: {horizontal: 'visible', vertical: 'visible'}},
        style: {fill: {color: 'transparent', image: null, fit: 'cover', alignment: 'center'}, opacity: 1, padding: {top: 0, right: 0, bottom: 0, left: 0}, margin: {top: 0, right: 0, bottom: 0, left: 0}, radius: {all: 0, topLeft: null, topRight: null, bottomRight: null, bottomLeft: null}, border: {width: 0, color: null, style: 'solid'}, shadow: [], blur: null, clip: false},
        metadata: commonMetadata,
    },
};
export async function ensurePrimitiveSpecs({blueprintRoot, writeIfMissing}) {
    for (const [filename, document] of Object.entries(primitiveDocuments)) {
        await writeIfMissing(resolve(blueprintRoot, 'primitives', filename), yaml.dump(document, {lineWidth: -1, noRefs: true}));
    }
}

export const v2Schema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'FastUI v2 specification',
    type: 'object',
    required: ['version', 'kind', 'id'],
    properties: {
        version: {const: 'fastui/v2'},
        kind: {enum: ['primitive', 'component', 'surface']},
        id: {type: 'string'},
        ref: {type: ['string', 'null']},
        node: {type: 'object', properties: {type: {enum: ['text', 'image', 'container']}}},
        props: {type: 'object'}, state: {type: 'object'}, style: {type: 'object'}, layout: {type: 'object'},
        effects: {type: 'object'}, compose: {type: ['object', 'string', 'null']}, metadata: {type: 'object'},
    },
};
