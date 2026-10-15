import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useEffect, useState } from "react";

export function HonoExample() {
  const siteUrl = useQuery(api.http.siteUrl);
  const [value, setValue] = useState("");
  useEffect(() => {
    if (!siteUrl) return;
    void fetch(`${siteUrl}/`)
      .then((r) => r.text())
      .then(setValue);
  }, [siteUrl]);

  return (
    <div>
      <h2>Hono Example</h2>
      <p>
        Value fetching from {siteUrl}/: {value}
      </p>
    </div>
  );
}
