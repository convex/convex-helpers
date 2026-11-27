// @vitest-environment jsdom
import { cleanup, render, renderHook } from "@testing-library/react";
import { createElement, StrictMode, type ReactNode } from "react";
import { afterEach, expect, expectTypeOf, test, vi } from "vitest";
import { ConvexProvider, type ConvexReactClient } from "convex/react";
import {
  makeFunctionReference,
  type FunctionReference_future,
} from "convex/server";
import { makeUseQueryWithStatus } from "./react.js";
import { useQuery, useQueries } from "./react/cache/hooks.js";
import { ConvexQueryCacheProvider } from "./react/cache/provider.js";

afterEach(cleanup);

const query = makeFunctionReference<"query", { id: string }, string>(
  "test:query",
);
const futureQuery: FunctionReference_future<
  "query",
  "public",
  { id: string },
  string
> = query;

function setup(value: string | undefined | Error) {
  const unsubscribe = vi.fn();
  const watchQuery = vi.fn(() => ({
    localQueryResult: () => {
      if (value instanceof Error) throw value;
      return value;
    },
    onUpdate: () => unsubscribe,
    journal: () => undefined,
  }));
  const client = { watchQuery } as unknown as ConvexReactClient;
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(
      ConvexProvider,
      { client },
      createElement(ConvexQueryCacheProvider, { maxIdleEntries: 0 }, children),
    );
  return { wrapper, watchQuery, unsubscribe };
}

test.each([
  ["plain", query],
  ["future", futureQuery],
] as const)(
  "cached useQuery subscribes with a %s reference",
  (_name, reference) => {
    const { wrapper, watchQuery, unsubscribe } = setup("found");
    const { result, unmount } = renderHook(
      () => useQuery(reference, { id: "one" }),
      { wrapper },
    );
    expectTypeOf(result.current).toEqualTypeOf<string | undefined>();
    expect(result.current).toBe("found");
    expect(watchQuery).toHaveBeenCalledWith(reference, { id: "one" });
    expect(unsubscribe).not.toHaveBeenCalled();
    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  },
);

test("cached useQueries composes with makeUseQueryWithStatus for future references", () => {
  const { wrapper } = setup("found");
  const useQueryWithStatus = makeUseQueryWithStatus(useQueries);
  const { result } = renderHook(
    () => useQueryWithStatus(futureQuery, { id: "one" }),
    { wrapper },
  );
  expectTypeOf(result.current.data).toEqualTypeOf<string | undefined>();
  expect(result.current).toEqual({
    status: "success",
    data: "found",
    error: undefined,
    isSuccess: true,
    isPending: false,
    isError: false,
  });
});

test.each([undefined, new Error("query failed")])(
  "cached status queries preserve pending and error results: %s",
  (value) => {
    const { wrapper } = setup(value);
    const useQueryWithStatus = makeUseQueryWithStatus(useQueries);
    const { result } = renderHook(
      () => useQueryWithStatus(futureQuery, { id: "one" }),
      { wrapper },
    );
    expect(result.current.status).toBe(
      value === undefined ? "pending" : "error",
    );
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBe(value);
  },
);

test("skipped future references do not open cached subscriptions", () => {
  const { wrapper, watchQuery } = setup("found");
  const useQueryWithStatus = makeUseQueryWithStatus(useQueries);
  const { result } = renderHook(
    () => ({
      cached: useQuery(futureQuery, "skip"),
      status: useQueryWithStatus(futureQuery, "skip"),
    }),
    { wrapper },
  );
  expect(result.current.cached).toBeUndefined();
  expect(result.current.status.status).toBe("pending");
  expect(watchQuery).not.toHaveBeenCalled();
});

// Counts the subscriptions the client holds open, from both the cache and useQueries.
function trackingClient() {
  let open = 0;
  const watchQuery = vi.fn(() => ({
    localQueryResult: () => "found",
    onUpdate: () => {
      open++;
      let closed = false;
      return () => {
        if (closed) throw new Error("subscription closed twice");
        closed = true;
        open--;
      };
    },
    journal: () => undefined,
  }));
  const client = { watchQuery } as unknown as ConvexReactClient;
  return { client, watchQuery, open: () => open };
}

function Reader() {
  useQuery(query, { id: "one" });
  return null;
}

function cachedTree(client: ConvexReactClient, showReader: boolean) {
  return createElement(
    ConvexProvider,
    { client },
    createElement(
      ConvexQueryCacheProvider,
      null,
      showReader ? createElement(Reader) : null,
    ),
  );
}

test("unmounting the provider closes idle cached subscriptions", () => {
  vi.useFakeTimers();
  try {
    const { client, open } = trackingClient();
    const { rerender, unmount } = render(cachedTree(client, true));
    expect(open()).toBeGreaterThan(0);
    // The reader leaves; the cache keeps the query idle until it expires.
    rerender(cachedTree(client, false));
    expect(open()).toBe(1);
    unmount();
    expect(open()).toBe(0);
    // The eviction timer was cancelled with it, so nothing closes twice.
    vi.runAllTimers();
    expect(open()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

test("unmounting the provider with readers still mounted closes everything once", () => {
  const { client, open } = trackingClient();
  const { unmount } = render(cachedTree(client, true));
  unmount();
  expect(open()).toBe(0);
});

test("the cache still serves queries under StrictMode", () => {
  const { client, watchQuery, open } = trackingClient();
  const { unmount } = render(
    createElement(StrictMode, null, cachedTree(client, true)),
  );
  // StrictMode runs the provider's cleanup once while the tree stays mounted:
  // the reader subscribes again instead of being left without the cache.
  expect(watchQuery).toHaveBeenCalled();
  expect(open()).toBeGreaterThan(0);
  unmount();
  expect(open()).toBe(0);
});
