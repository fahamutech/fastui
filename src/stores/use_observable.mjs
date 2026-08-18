import {useSyncExternalStore} from 'react';

export function useObservable(store, selector = value => value) {
  return useSyncExternalStore(
    listener => {
      const subscription = store.subscribe(listener);
      return () => subscription.unsubscribe();
    },
    () => selector(store.value),
    () => selector(store.value),
  );
}
