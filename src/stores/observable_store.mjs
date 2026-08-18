import {BehaviorSubject} from 'rxjs';

export function createObservableStore(initialState = {}) {
  const subject = new BehaviorSubject(Object.freeze({...initialState}));
  return {
    state$: subject.asObservable(),
    get value() { return subject.value; },
    set(patch) { subject.next(Object.freeze({...subject.value, ...patch})); },
    update(reducer) { subject.next(Object.freeze(reducer(subject.value))); },
    subscribe(observer) { return subject.subscribe(observer); },
    dispose() { subject.complete(); },
  };
}

export const appState = createObservableStore();
