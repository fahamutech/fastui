export function reactRuntimeSource() {
    return `import {useCallback, useLayoutEffect, useRef, useSyncExternalStore} from 'react';
import {BehaviorSubject} from 'rxjs';

const freezeState = value => Object.freeze({...value});

function reportFastUIError(error) {
  if (typeof globalThis.reportError === 'function') globalThis.reportError(error);
  else console.error(error);
}

export function createObservableStore(initialState = {}) {
  const subject = new BehaviorSubject(freezeState(initialState));
  return {
    get value() { return subject.value; },
    set(patch) { subject.next(freezeState({...subject.value, ...patch})); },
    update(reducer) { subject.next(freezeState(reducer(subject.value))); },
    subscribe(listener) {
      const subscription = subject.subscribe(listener);
      return () => subscription.unsubscribe();
    },
    dispose() { subject.complete(); },
  };
}

export const appState = createObservableStore();

export function createFastUIComponentStore({componentId, fields = [], createInitialState = () => ({}), setters = {}}) {
  const instances = new Map();
  const allowedFields = new Set(fields);
  const validate = value => {
    const next = {...value};
    for (const key of Object.keys(next)) {
      if (!allowedFields.has(key)) throw new TypeError(componentId + ': unknown state field "' + key + '"');
    }
    return freezeState(next);
  };
  const initialFor = seed => freezeState({
    ...createInitialState(seed?.inputs ?? {}),
    ...Object.fromEntries(Object.entries(seed?.initialState ?? {}).filter(([key]) => allowedFields.has(key))),
  });
  const ensure = (instanceId, seed) => {
    let record = instances.get(instanceId);
    if (!record) {
      record = {
        subject: new BehaviorSubject(initialFor(seed)),
        subscribers: 0,
        initialized: false,
        disposeTimer: undefined,
      };
      instances.set(instanceId, record);
    }
    if (record.disposeTimer !== undefined) {
      clearTimeout(record.disposeTimer);
      record.disposeTimer = undefined;
    }
    return record;
  };
  const store = {
    componentId,
    has(instanceId) { return instances.has(instanceId); },
    get(instanceId, seed) { return instances.get(instanceId)?.subject.value ?? initialFor(seed); },
    subscribe(instanceId, listener, seed) {
      const record = ensure(instanceId, seed);
      record.subscribers += 1;
      const subscription = record.subject.subscribe(listener);
      return () => {
        subscription.unsubscribe();
        record.subscribers = Math.max(0, record.subscribers - 1);
        if (record.subscribers !== 0) return;
        record.disposeTimer = setTimeout(() => {
          if (record.subscribers !== 0 || instances.get(instanceId) !== record) return;
          record.subject.complete();
          instances.delete(instanceId);
        }, 0);
      };
    },
    update(instanceId, reducer, seed) {
      const record = ensure(instanceId, seed);
      record.subject.next(validate(reducer(record.subject.value)));
    },
    setField(instanceId, key, value, seed) {
      if (!allowedFields.has(key)) throw new TypeError(componentId + ': unknown state field "' + key + '"');
      store.update(instanceId, state => ({...state, [key]: value}), seed);
    },
    initialize(instanceId, callback, seed) {
      const record = ensure(instanceId, seed);
      if (record.initialized) return;
      record.initialized = true;
      Promise.resolve().then(callback).catch(reportFastUIError);
    },
  };
  for (const [name, reducer] of Object.entries(setters)) {
    store[name] = (instanceId, value, seed) => store.update(
      instanceId,
      state => reducer(state, value),
      seed,
    );
  }
  return store;
}

export function useFastUISelector(store, instanceId, selector, seed = {}) {
  const seedRef = useRef(seed);
  seedRef.current = seed;
  const fallbackRef = useRef();
  if (fallbackRef.current?.instanceId !== instanceId) {
    fallbackRef.current = {instanceId, state: store.get(instanceId, seedRef.current)};
  }
  const subscribe = useCallback(
    listener => store.subscribe(instanceId, listener, seedRef.current),
    [store, instanceId],
  );
  const snapshot = useCallback(
    () => selector(store.has(instanceId) ? store.get(instanceId, seedRef.current) : fallbackRef.current.state),
    [store, instanceId, selector],
  );
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export class FastUIComponentContext {
  constructor({store, componentId, instanceId, inputs = {}, args = [], navigate}) {
    this.store = store;
    this.componentId = componentId;
    this.instanceId = instanceId;
    this.inputs = inputs;
    this.args = args;
    this.navigate = typeof navigate === 'function' ? navigate : () => {};
  }
  get state() { return this.store?.get(this.instanceId) ?? Object.freeze({}); }
  setState(key, value) {
    if (!this.store?.has(this.instanceId)) return;
    const setterName = 'set' + String(key).replace(/[^a-zA-Z0-9_]/g, '_').replace(/^./, char => char.toUpperCase());
    const setter = this.store?.[setterName];
    if (typeof setter !== 'function') throw new TypeError(this.componentId + ': no generated setter for "' + key + '"');
    setter.call(this.store, this.instanceId, value);
  }
  update(reducer) {
    if (this.store?.has(this.instanceId)) this.store.update(this.instanceId, reducer);
  }
  read(store, instanceId = this.instanceId) { return store.get(instanceId); }
  withArgs(args = []) {
    return new FastUIComponentContext({...this, args});
  }
}

export function createFastUIComponentContext(options) {
  return new FastUIComponentContext(options);
}

export function useFastUIControlledInput(value) {
  const inputRef = useRef(null);
  const previousValue = useRef(String(value ?? ''));
  const selection = useRef(null);
  const node = inputRef.current;
  const nextValue = String(value ?? '');
  if (node && previousValue.current !== nextValue && typeof document !== 'undefined' && document.activeElement === node) {
    selection.current = {
      start: node.selectionStart,
      end: node.selectionEnd,
      direction: node.selectionDirection,
    };
  }
  useLayoutEffect(() => {
    const node = inputRef.current;
    const nextValue = String(value ?? '');
    if (node && node.value !== nextValue) node.value = nextValue;
    const saved = selection.current;
    if (node && saved && saved.start != null && saved.end != null && typeof document !== 'undefined' && document.activeElement === node) {
      const max = nextValue.length;
      node.setSelectionRange(Math.min(saved.start, max), Math.min(saved.end, max), saved.direction ?? 'none');
    }
    selection.current = null;
    previousValue.current = nextValue;
  }, [value]);
  return inputRef;
}

export function createFastUITranslationStore(defaultCatalog = {}) {
  const observable = createObservableStore({locale: 'default', catalogs: {default: {...defaultCatalog}}});
  return {
    get value() { return observable.value; },
    subscribe: observable.subscribe,
    setLocale(locale) { observable.set({locale: String(locale || 'default')}); },
    load(locale, entries) {
      observable.update(state => ({...state, catalogs: {
        ...state.catalogs,
        [locale]: {...(state.catalogs[locale] ?? {}), ...entries},
      }}));
    },
    translate(key, args = {}) {
      const state = observable.value;
      let value = state.catalogs[state.locale]?.[key]
        ?? state.catalogs.default?.[key]
        ?? String(key ?? '');
      for (const [name, replacement] of Object.entries(args ?? {})) {
        value = value.replaceAll('{' + name + '}', String(replacement ?? ''));
      }
      return value;
    },
  };
}

export function useFastUITranslationValue(store, key, args = {}) {
  const subscribe = useCallback(listener => store.subscribe(listener), [store]);
  const argsKey = JSON.stringify(args ?? {});
  const snapshot = useCallback(() => store.translate(key, args), [store, key, argsKey]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
`;
}
