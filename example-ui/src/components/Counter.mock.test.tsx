import Counter from "./Counter";
import { render } from "@testing-library/react";
import { describe, it, expect, afterEach, vi } from "vitest";
import * as convexReact from "convex/react";
import { FunctionReference, getFunctionName } from "convex/server";

// Keep track of counter values
let counters: Record<string, number> = {};

// A function very similar to the implementation of `getCounter`
const getCounter = ({ counterName }: { counterName: string }) =>
  counters[counterName];

// A function very similar to the implementation of `incrementCounter` in `convex/counter.ts`
const incrementCounter = ({
  counterName,
  increment,
}: {
  counterName: string;
  increment: number;
}) => {
  if (counters[counterName]) {
    counters[counterName] = counters[counterName]! + increment;
  } else {
    counters[counterName] = increment;
  }
  return null;
};

// Wrap incrementCounter in a vitest function so we can keep track of function calls in tests
const incrementCounterMock = vi.fn().mockImplementation(incrementCounter);

vi.mock("convex/react", async () => {
  const actual = await vi.importActual<typeof convexReact>("convex/react");

  return {
    ...actual,
    useQuery: (
      queryName: FunctionReference<"query", "public">,
      args: Record<string, any>,
    ) => {
      if (getFunctionName(queryName) !== "counter:getCounter") {
        throw new Error("Unexpected query call!");
      }
      return getCounter(args as any);
    },
    useMutation: (mutationName: FunctionReference<"mutation", "public">) => {
      if (getFunctionName(mutationName) !== "counter:incrementCounter") {
        throw new Error("Unexpected mutation call!");
      }
      return incrementCounterMock;
    },
  };
});

const setup = () => render(<Counter />);

afterEach(() => {
  // Resets the counter state after every test
  counters = {};

  // Resets mocks after every test
  vi.restoreAllMocks();

  // Reset the dom after every test
  document.getElementsByTagName("html")[0]!.innerHTML = "";
});

describe("Counter", () => {
  it("renders the counter", async () => {
    const { getByText } = setup();
    expect(getByText("Here's the counter: 0")).not.toBeNull();
  });

  it("increments the counter", async () => {
    const { getByRole, queryByText } = setup();

    getByRole("button").click();

    // The mocked incrementCounter function will be called.
    expect(incrementCounterMock).toHaveBeenCalledOnce();
    expect(incrementCounterMock).toHaveBeenCalledWith({
      counterName: "clicks",
      increment: 1,
    });

    // The mocked query doesn't support reactivity,
    // so we can't use it to test that components re-render with updated data.
    expect(queryByText("Here's the counter: 1")).toBeNull();
  });

  it("renders the counter with seeded data", async () => {
    // Update the test state before rendering the component to seed the getCounter query.
    incrementCounter({ counterName: "clicks", increment: 100 });

    const { getByText } = setup();

    expect(getByText("Here's the counter: 100")).not.toBeNull();
  });
});
