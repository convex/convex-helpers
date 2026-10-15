import { FC, useRef, useState } from "react";
import {
  useQuery,
  usePaginatedQuery,
  useQueries,
} from "convex-helpers/react/cache";
import { api } from "../../../convex/_generated/api";

// Composing this with the tanstack-style useQuery:
import { makeUseQueryWithStatus } from "convex-helpers/react";
import { useMutation } from "convex/react";
const useQueryWithStatus = makeUseQueryWithStatus(useQueries);

export const CacheExample: FC = () => {
  const [count, setCount] = useState(4);
  const ref = useRef<HTMLInputElement>(null);
  const [skip, setSkip] = useState(true);
  const [unmounted, setUnmounted] = useState(false);
  const children = [];
  const updateCount = () => {
    const r = parseInt(ref.current!.value);
    if (!isNaN(r)) {
      setCount(Math.floor(r));
    }
    return false;
  };
  for (let i = 0; i < count; i++) {
    children.push(<Query key={i} count={i + 1} />);
  }
  return (
    <>
      <h2>Query Cache Example</h2>
      Enter a number counters to fetch:{" "}
      <input
        style={{ border: "1px solid" }}
        ref={ref}
        type="number"
        onChange={updateCount}
      />
      <ul>{children}</ul>
      <div>
        Try skipping and see that the non-skipped value is already there:
      </div>
      <button onClick={() => setSkip((skip) => !skip)}>
        {skip ? "Unskip" : "Skip"}
      </button>
      <div className="flex flex-row gap-8">
        <div className="flex-1 flex flex-col gap-2">
          <div>Regular query results</div>
          <Query count={count} skip={skip} />
          <div>Paginated query results</div>
          <Paginated skip={skip} />
        </div>
        <div className="flex-1 flex flex-col gap-2">
          <div>Alternative to skip: mounting and unmounting the component</div>
          <button onClick={() => setUnmounted((unmounted) => !unmounted)}>
            {unmounted ? "Mount" : "Unmount"}
          </button>
          {unmounted ? (
            <div>Unmounted</div>
          ) : (
            <>
              <div>Regular query results</div>
              <Query count={count} skip={false} />
              <div>Paginated query results</div>
              <Paginated skip={false} />
            </>
          )}
        </div>
      </div>
    </>
  );
};

const Query: FC<{ count: number; skip?: boolean }> = ({ count, skip }) => {
  const counters = useQuery(api.counter.getCounters, skip ? "skip" : { count });
  const sumWithStatus = useQueryWithStatus(
    api.counter.getCounters,
    skip ? "skip" : { count },
  );
  if (
    sumWithStatus.data !== counters ||
    sumWithStatus.isPending !== (counters === undefined) ||
    sumWithStatus.isSuccess !== (counters !== undefined)
  ) {
    throw new Error("These should never mismatch");
  }

  if (counters === undefined) {
    if (skip) return <li>Skipped</li>;
    return <li>Loading {count}...</li>;
  } else {
    return (
      <li>
        {count} &rarr; {counters.at(0)?.name}
        {counters.length > 1
          ? counters.length > 2
            ? `...${counters.length - 2}...${counters.at(-1)?.name}`
            : `...${counters.at(-1)?.name}`
          : ""}
      </li>
    );
  }
};

function Paginated({ skip }: { skip: boolean }) {
  const counters = usePaginatedQuery(
    api.counter.getCountersPaginated,
    skip ? "skip" : {},
    { initialNumItems: 2, customPagination: true },
  );
  const addCounter = useMutation(api.counter.incrementCounter);
  if (skip) {
    return <div>Skipped</div>;
  }
  return (
    <div>
      <div>Status: {counters.status}</div>
      <ul>
        {counters.results.map((counter, i) => (
          <li key={i}>
            {counter.name}: {counter.counter}
          </li>
        ))}
      </ul>
      <button
        onClick={() =>
          addCounter({ counterName: "test-" + Date.now(), increment: 1 })
        }
      >
        Add Counter
      </button>
      {counters.status === "CanLoadMore" && (
        <button onClick={() => counters.loadMore(2)}>Load More</button>
      )}
    </div>
  );
}
