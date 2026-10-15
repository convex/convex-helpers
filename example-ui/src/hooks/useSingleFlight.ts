import { useCallback, useRef } from "react";

/**
 * Wraps a function to single-flight invocations, using the latest args.
 *
 * Generates a function that behaves like the passed in function,
 * but only one execution runs at a time. If multiple calls are requested
 * before the current call has finished, it will use the latest arguments
 * for the next invocation.
 *
 * Note: some requests may never be made. If while a request is in-flight, N
 * requests are made, N-1 of them will never resolve or reject the promise they
 * returned. For most applications this is the desired behavior, but if you need
 * all calls to eventually resolve, you can modify this code. Some behavior you
 * could add, left as an exercise to the reader:
 *   1. Resolve with the previous result when a request is about to be dropped.
 *   2. Resolve all N requests with the result of the next request.
 *   3. Do not return anything, and use this as a fire-and-forget library only.
 *
 * @param fn - Function to be called, with only one request in flight at a time.
 * This must be a stable identifier, e.g. returned from useCallback.
 * @returns Function that can be called whenever, returning a promise that will
 * only resolve or throw if the underlying function gets called.
 */
export default function useSingleFlight<
  F extends (...args: any[]) => Promise<any>,
>(fn: F) {
  const flightStatus = useRef({
    inFlight: false,
    upNext: null as null | {
      fn: F;
      resolve: any;
      reject: any;
      args: Parameters<F>;
    },
  });

  return useCallback(
    (...args: Parameters<F>): ReturnType<F> => {
      if (flightStatus.current.inFlight) {
        return new Promise((resolve, reject) => {
          flightStatus.current.upNext = { fn, resolve, reject, args };
        }) as ReturnType<F>;
      }
      flightStatus.current.inFlight = true;
      const firstReq = fn(...args) as ReturnType<F>;
      void (async () => {
        try {
          await firstReq;
        } finally {
          // If it failed, we naively just move on to the next request.
        }
        while (flightStatus.current.upNext) {
          const cur = flightStatus.current.upNext;
          flightStatus.current.upNext = null;
          await cur
            .fn(...cur.args)
            .then(cur.resolve)
            .catch(cur.reject);
        }
        flightStatus.current.inFlight = false;
      })();
      return firstReq;
    },
    [fn],
  );
}
