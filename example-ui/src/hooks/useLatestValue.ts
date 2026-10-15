import { useCallback, useMemo, useRef } from "react";

/**
 * Promise-based access to the latest value updated.
 * Every call to nextValue will return a promise to the next value.
 * "Next value" is defined as the latest value passed to "updateValue" that
 * hasn not been returned yet.
 * @returns a function to await for a new value, and one to update the value.
 */
export default function useLatestValue<T>() {
  const initial = useMemo(() => {
    const [promise, resolve] = makeSignal();
    // We won't access data until it has been updated.
    return { data: undefined as T, promise, resolve };
  }, []);
  const ref = useRef(initial);
  const nextValue = useCallback(async () => {
    await ref.current.promise;
    const [promise, resolve] = makeSignal();
    ref.current.promise = promise;
    ref.current.resolve = resolve;
    return ref.current.data;
  }, [ref]);

  const updateValue = useCallback(
    (data: T) => {
      ref.current.data = data;
      ref.current.resolve();
    },
    [ref],
  );

  return [nextValue, updateValue] as const;
}

const makeSignal = () => {
  let resolve: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return [promise, resolve!] as const;
};
