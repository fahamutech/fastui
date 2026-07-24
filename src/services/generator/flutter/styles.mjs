const COLOR_MAP = {
    red: 'Colors.red', blue: 'Colors.blue', green: 'Colors.green',
    white: 'Colors.white', black: 'Colors.black', grey: 'Colors.grey',
    gray: 'Colors.grey', yellow: 'Colors.yellow', orange: 'Colors.orange',
    purple: 'Colors.purple', pink: 'Colors.pink', transparent: 'Colors.transparent',
    lightblue: 'Colors.lightBlue', lightgreen: 'Colors.lightGreen',
    deeporange: 'Colors.deepOrange', deeppurple: 'Colors.deepPurple',
    indigo: 'Colors.indigo', teal: 'Colors.teal', cyan: 'Colors.cyan',
    amber: 'Colors.amber', lime: 'Colors.lime', brown: 'Colors.brown',
};

export function toFlutterColor(value) {
    if (!value) return 'Colors.transparent';
    const v = `${value}`.trim().toLowerCase().replace(/\s/g, '');
    if (COLOR_MAP[v]) return COLOR_MAP[v];
    if (v.startsWith('#')) {
        const hex = v.slice(1);
        const full = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex;
        return `Color(0xFF${full.padStart(6, '0').toUpperCase()})`;
    }
    return `Colors.black /* ${value} */`;
}

export const EVENT_PROPS = ['onTap', 'onDoubleTap', 'onLongPress', 'onPressed'];

export function isDynamicValue(value) {
    const v = `${value}`.trim().toLowerCase();
    return v.startsWith('states.') || v.startsWith('inputs.') || v.startsWith('logics.')
        || v.startsWith('theme.') || v.startsWith('i18n.');
}

export function resolveFlutterValue(value, isStateful = true) {
    const v = `${value}`.trim();
    if (/^states\./i.test(v)) return v.replace(/^states\./i, '');
    if (/^inputs\./i.test(v)) {
        const field = v.replace(/^inputs\./i, '');
        return isStateful ? `widget.${field}` : field;
    }
    if (/^logics\./i.test(v)) {
        return `${v.replace(/^logics\.|\(\)$/ig, '')}(data: _component)`;
    }
    if (/^theme\./i.test(v)) return `AppTheme.${v.replace(/^theme\./i, '')}`;
    if (/^i18n\./i.test(v)) return `AppStrings.${v.replace(/^i18n\./i, '')}`;
    return `${value}`;
}

export function toFlutterSize(value) {
    const n = parseFloat(`${value}`.replace('px', '').trim());
    return isNaN(n) ? null : `${n}`;
}

function val(v, isStateful, transformer) {
    if (isDynamicValue(v)) return resolveFlutterValue(v, isStateful);
    return transformer ? transformer(v) : `${v}`;
}

export function buildBoxDecoration(styles, isStateful) {
    if (!styles || typeof styles !== 'object') return null;
    const parts = [];
    if (styles.backgroundColor != null) {
        parts.push(`color: ${val(styles.backgroundColor, isStateful, toFlutterColor)}`);
    }
    if (styles.borderRadius != null) {
        parts.push(`borderRadius: BorderRadius.circular(${val(styles.borderRadius, isStateful, toFlutterSize) ?? '0'})`);
    }
    if (styles.borderColor || styles.borderStyle || styles.borderWidth) {
        const c = styles.borderColor ? val(styles.borderColor, isStateful, toFlutterColor) : 'Colors.black';
        const w = styles.borderWidth ? val(styles.borderWidth, isStateful, toFlutterSize) ?? '1' : '1';
        parts.push(`border: Border.all(color: ${c}, width: ${w})`);
    }
    return parts.length ? `BoxDecoration(${parts.join(', ')})` : null;
}

export function buildEdgeInsets(styles, prefix, isStateful) {
    if (!styles) return null;
    const all = styles[prefix];
    const t = styles[`${prefix}Top`], b = styles[`${prefix}Bottom`];
    const l = styles[`${prefix}Left`], r = styles[`${prefix}Right`];
    if (all != null) return `EdgeInsets.all(${val(all, isStateful, toFlutterSize) ?? '0'})`;
    if (t || b || l || r) {
        return `EdgeInsets.only(top: ${t ? val(t, isStateful, toFlutterSize) : '0'}, bottom: ${b ? val(b, isStateful, toFlutterSize) : '0'}, left: ${l ? val(l, isStateful, toFlutterSize) : '0'}, right: ${r ? val(r, isStateful, toFlutterSize) : '0'})`;
    }
    return null;
}

export function buildTextStyle(styles, isStateful) {
    if (!styles) return null;
    const parts = [];
    if (styles.color != null) parts.push(`color: ${val(styles.color, isStateful, toFlutterColor)}`);
    if (styles.fontSize != null) parts.push(`fontSize: ${val(styles.fontSize, isStateful, toFlutterSize)}`);
    if (styles.fontFamily != null) {
        parts.push(`fontFamily: ${isDynamicValue(styles.fontFamily) ? resolveFlutterValue(styles.fontFamily, isStateful) : `'${styles.fontFamily}'`}`);
    }
    if (styles.fontWeight != null) {
        const fw = `${styles.fontWeight}`;
        parts.push(`fontWeight: ${fw === 'bold' ? 'FontWeight.bold' : fw === 'normal' ? 'FontWeight.normal' : `FontWeight.w${fw}`}`);
    }
    return parts.length ? `TextStyle(${parts.join(', ')})` : null;
}

export function buildGestureDetector(childWidget, props, isStateful) {
    const events = EVENT_PROPS.filter(e => props[e] != null);
    if (events.length === 0) return childWidget;
    const eventParts = events.map(e => {
        const v = props[e];
        const isLogics = `${v}`.trim().toLowerCase().startsWith('logics.');
        const isInputs = `${v}`.trim().toLowerCase().startsWith('inputs.');
        const handler = isDynamicValue(v) ? resolveFlutterValue(v, isStateful) : '() {}';
        return isLogics ? `${e}: () => ${handler}` : `${e}: ${handler}`;
    });
    return `GestureDetector(${eventParts.join(', ')}, child: ${childWidget})`;
}

export function buildContainerWidget({base, styles, children, props, isStateful}) {
    base = (base ?? 'rectangle').toLowerCase();
    styles = styles ?? {};
    props = props ?? {};

    if (base === 'text') {
        let textContent;
        if (children?.type === 'state') textContent = `${children.value}?.toString() ?? ''`;
        else if (children?.type === 'input') textContent = isStateful ? `widget.${children.value}?.toString() ?? ''` : `${children.value}?.toString() ?? ''`;
        else if (children?.type === 'raw' && isDynamicValue(children?.value)) textContent = `${resolveFlutterValue(children.value, isStateful)}?.toString() ?? ''`;
        else textContent = `'${children?.value ?? ''}'`;
        const ts = buildTextStyle(styles, isStateful);
        const textWidget = ts ? `Text(${textContent}, style: ${ts})` : `Text(${textContent})`;
        return buildGestureDetector(textWidget, props, isStateful);
    }

    if (base === 'image') {
        const src = props.src ?? props.children;
        const srcVal = src ? (isDynamicValue(src) ? resolveFlutterValue(src, isStateful) : `'${src}'`) : "''";
        const parts = [srcVal];
        if (styles.height != null) parts.push(`height: ${val(styles.height, isStateful, toFlutterSize)}`);
        if (styles.width != null) parts.push(`width: ${val(styles.width, isStateful, toFlutterSize)}`);
        parts.push('fit: BoxFit.cover');
        return `Image.network(${parts.join(', ')})`;
    }

    if (base === 'input') {
        const onChanged = props.onChange ?? props.onChanged;
        const placeholder = props.placeholder ?? props.hintText ?? props.hint;
        const inputParts = [];
        if (placeholder) {
            const ph = isDynamicValue(placeholder) ? resolveFlutterValue(placeholder, isStateful) : `'${placeholder}'`;
            inputParts.push(`decoration: InputDecoration(hintText: ${ph})`);
        }
        if (onChanged && isDynamicValue(onChanged)) {
            inputParts.push(`onChanged: (v) => ${resolveFlutterValue(onChanged, isStateful)}`);
        }
        return `TextField(${inputParts.join(', ')})`;
    }

    // rectangle (Container)
    const parts = [];
    const margin = buildEdgeInsets(styles, 'margin', isStateful);
    const padding = buildEdgeInsets(styles, 'padding', isStateful);
    const decoration = buildBoxDecoration(styles, isStateful);
    const ts = buildTextStyle(styles, isStateful);

    if (styles.height != null) parts.push(`height: ${val(styles.height, isStateful, toFlutterSize)}`);
    if (styles.width != null) parts.push(`width: ${val(styles.width, isStateful, toFlutterSize)}`);
    if (margin) parts.push(`margin: ${margin}`);
    if (padding) parts.push(`padding: ${padding}`);
    if (decoration) parts.push(`decoration: ${decoration}`);

    if (children?.value) {
        const cv = children.type === 'state'
            ? children.value
            : children.type === 'input'
                ? (isStateful ? `widget.${children.value}` : children.value)
                : `'${children.value}'`;
        const childWidget = ts
            ? `Text(${cv}?.toString() ?? '', style: ${ts})`
            : `Text(${cv}?.toString() ?? '')`;
        parts.push(`child: ${childWidget}`);
    }
    const container = `Container(${parts.join(', ')})`;
    return buildGestureDetector(container, props, isStateful);
}

export function buildFrameWidget({frame, childWidget, isStateful}) {
    const rawFrame = frame ?? 'column.start';
    const frameStr = `${typeof rawFrame === 'object' ? rawFrame?.base ?? 'column.start' : rawFrame}`.trim().toLowerCase();
    const isColumn = frameStr.startsWith('column');
    const isStart = frameStr.includes('.start');
    const viewRef = isStateful ? 'widget.view' : 'view';

    const itemsStart = `${childWidget},\n        ${viewRef} ?? const SizedBox.shrink(),`;
    const itemsEnd = `${viewRef} ?? const SizedBox.shrink(),\n        ${childWidget},`;
    const children = isStart ? itemsStart : itemsEnd;

    if (isColumn) {
        const align = isStart ? 'CrossAxisAlignment.start' : 'CrossAxisAlignment.end';
        return `Column(\n      crossAxisAlignment: ${align},\n      children: [\n        ${children}\n      ],\n    )`;
    }
    const align = isStart ? 'MainAxisAlignment.start' : 'MainAxisAlignment.end';
    return `Row(\n      mainAxisAlignment: ${align},\n      children: [\n        ${children}\n      ],\n    )`;
}
