import Counter from "./components/Counter";
import RelationshipExample from "./components/RelationshipExample";
import SessionsExample from "./components/SessionsExample";
import { HonoExample } from "./components/HonoExample";
import { StreamsExample } from "./components/StreamsExample";
import { ZodFunctionsExample } from "./components/ZodFunctionsExample";
import { SessionProvider } from "convex-helpers/react/sessions";
import { CacheExample } from "./components/CacheExample";
import { ConvexQueryCacheProvider } from "convex-helpers/react/cache";
// Used for the session example if you want to store sessionId in local storage
// import { useLocalStorage } from "usehooks-ts";

export default function App() {
  return (
    <main>
      <SessionProvider
      // storageKey={"ConvexSessionId"}
      // useStorage={useLocalStorage}
      >
        <ConvexQueryCacheProvider maxIdleEntries={11} expiration={15000}>
          <Counter />
          <RelationshipExample />
          <SessionsExample />
          <HonoExample />
          <CacheExample />
          <StreamsExample />
          <ZodFunctionsExample />
        </ConvexQueryCacheProvider>
      </SessionProvider>
    </main>
  );
}
