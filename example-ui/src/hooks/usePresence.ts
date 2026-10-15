import { api } from "../../../convex/_generated/api";
import { useQuery, useMutation } from "convex/react";
import { Value } from "convex/values";
import { useCallback, useEffect, useState } from "react";
import useSingleFlight from "./useSingleFlight";

export type PresenceData<D> = {
  created: number;
  updated: number;
  user: string;
  data: D;
};

const HEARTBEAT_PERIOD = 5000;
const OLD_MS = 10000;

/**
 * usePresence is a React hook for reading & writing presence data.
 *
 * The data is written by various users, and comes back as a list of data for
 * other users in the same room. It is not meant for mission-critical data, but
 * rather for optimistic metadata, like whether a user is online, typing, or
 * at a certain location on a page. The data is single-flighted, and when many
 * updates are requested while an update is in flight, only the latest data will
 * be sent in the next request. See for more details on single-flighting:
 * https://stack.convex.dev/throttling-requests-by-single-flighting
 *
 * Data updates are merged with previous data. This data will reflect all
 * updates, not just the data that gets synchronized to the server. So if you
 * update with {mug: userMug} and {typing: true}, the data will have both
 * `mug` and `typing` fields set, and will be immediately reflected in the data
 * returned as the first parameter.
 *
 * @param room - The location associated with the presence data. Examples:
 * page, chat channel, game instance.
 * @param user - The user associated with the presence data.
 * @param initialData - The initial data to associate with the user.
 * @param heartbeatPeriod? - If specified, the interval between heartbeats, in
 * milliseconds. A heartbeat updates the user's presence "updated" timestamp.
 * The faster the updates, the more quickly you can detect a user "left" at
 * the cost of more server function calls.
 * @returns A list with 1. this user's data; 2. A list of other users' data;
 * 3. function to update this user's data. It will do a shallow merge.
 */
export const usePresence = <T extends { [key: string]: Value }>(
  room: string,
  user: string,
  initialData: T,
  heartbeatPeriod = HEARTBEAT_PERIOD,
) => {
  const [data, setData] = useState(initialData);
  let presence: PresenceData<T>[] | undefined = useQuery(api.presence.list, {
    room,
  });
  if (presence) {
    presence = presence.filter((p) => p.user !== user);
  }
  const updatePresence = useSingleFlight(useMutation(api.presence.update));
  const heartbeat = useSingleFlight(useMutation(api.presence.heartbeat));

  useEffect(() => {
    void updatePresence({ room, user, data });
    const intervalId = setInterval(() => {
      void heartbeat({ room, user });
    }, heartbeatPeriod);
    // Whenever we have any data change, it will get cleared.
    return () => clearInterval(intervalId);
  }, [updatePresence, heartbeat, room, user, data, heartbeatPeriod]);

  // Updates the data, merged with previous data state.
  const updateData = useCallback((patch: Partial<T>) => {
    setData((prevState) => {
      return { ...prevState, ...patch };
    });
  }, []);

  return [data, presence, updateData] as const;
};

/**
 * isOnline determines a user's online status by how recently they've updated.
 *
 * @param presence - The presence data for one user returned from usePresence.
 * @param now - If specified, the time it should consider to be "now".
 * @returns True if the user has updated their presence recently.
 */
export const isOnline = <D>(presence: PresenceData<D>) => {
  return Date.now() - presence.updated < OLD_MS;
};

export default usePresence;
