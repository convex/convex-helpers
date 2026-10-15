import { api } from "../../../convex/_generated/api";
import { useQuery } from "convex/react";
import { useMemo } from "react";
import { z } from "zod/v4";

const stringToDate = z.codec(z.iso.datetime(), z.date(), {
  decode: (isoString) => new Date(isoString),
  encode: (date) => date.toISOString(),
});

export function ZodFunctionsExample() {
  const now = useMemo(() => new Date(), []);

  const noArgsResult = useQuery(api.zodFunctionsExample.noArgs);
  const noArgsResultEmptyArgs = useQuery(api.zodFunctionsExample.noArgs, {});
  const withArgsResult = useQuery(api.zodFunctionsExample.withArgs, {
    date: stringToDate.encode(now),
  });

  return (
    <div>
      <h2>Zod Functions Example</h2>
      <section>
        <h3>No Args Query</h3>
        <p>Result: {noArgsResult ?? "Loading..."}</p>
      </section>
      <section>
        <h3>No Args Query (Empty Args)</h3>
        <p>Result: {noArgsResultEmptyArgs ?? "Loading..."}</p>
      </section>
      <section>
        <h3>With Args Query</h3>
        {withArgsResult && (
          <p>
            One day after:{" "}
            {stringToDate.decode(withArgsResult.oneDayAfter).toLocaleString()}
          </p>
        )}
      </section>
    </div>
  );
}
