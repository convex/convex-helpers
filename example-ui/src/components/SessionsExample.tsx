import {
  useSessionId,
  useSessionIdArg,
  useSessionMutation,
  useSessionPaginatedQuery,
  useSessionQuery,
} from "convex-helpers/react/sessions";
import { api } from "../../../convex/_generated/api";
import { useState } from "react";
import { useStableQuery } from "../hooks/useStableQuery";
// import { useLocalStorage } from "usehooks-ts";

export default () => {
  const [sessionId, refreshSessionId] = useSessionId();
  const login = useSessionMutation(api.sessionsExample.logIn);
  const logout = useSessionMutation(api.sessionsExample.logOut);
  const myPresence = useSessionQuery(api.sessionsExample.myPresence);
  const paginatedPresence = useSessionPaginatedQuery(
    api.sessionsExample.paginatedQueryWithSession,
    {},
    { initialNumItems: 2 },
  )!;
  const joinRoom = useSessionMutation(
    api.sessionsExample.joinRoom,
  ).withOptimisticUpdate((store, args) => {
    if (!sessionId) return;
    const roomPresence = store.getQuery(api.sessionsExample.myPresence, {
      sessionId,
    });
    store.setQuery(
      api.sessionsExample.myPresence,
      { sessionId },
      roomPresence ? [...roomPresence, args.room] : undefined,
    );
  });
  const [room, setRoom] = useState("");
  const roomData = useStableQuery(
    api.sessionsExample.roomPresence,
    useSessionIdArg(room ? { room } : "skip"),
  );
  return (
    <div>
      <h2>Sessions Example</h2>
      <span>{sessionId}</span>
      <button
        onClick={() =>
          void refreshSessionId((newSessionId) => {
            void login({ new: newSessionId });
          })
        }
      >
        Refresh Session Id on Log In
      </button>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (room) void joinRoom({ room });
          setRoom("");
        }}
      >
        <label>Join a room</label>
        <input
          type="text"
          placeholder="Room name"
          value={room}
          onChange={(e) => setRoom(e.target.value)}
        />
      </form>
      <p>{JSON.stringify(roomData)}</p>
      <ul>{myPresence && myPresence.map((room) => <li>{room}</li>)}</ul>
      <ul>
        {paginatedPresence.results.map((room) => (
          <li>{room.room}</li>
        ))}
      </ul>
      <button
        disabled={paginatedPresence.status !== "CanLoadMore"}
        onClick={() => paginatedPresence.loadMore(2)}
      >
        load more
      </button>

      <button
        onClick={() =>
          void refreshSessionId((_newSessionId) => {
            void logout();
          })
        }
      >
        Delete Session Data on Log Out
      </button>
    </div>
  );
};
