import classNames from "classnames";
import { useEffect, useState } from "react";
import { isOnline, PresenceData } from "../hooks/usePresence";

const UPDATE_MS = 1000;

type FacePileProps = {
  othersPresence?: PresenceData<{ emoji: string }>[];
};
export default ({ othersPresence }: FacePileProps) => {
  const [, setNow] = useState(Date.now());
  useEffect(() => {
    const intervalId = setInterval(() => setNow(Date.now()), UPDATE_MS);
    return () => clearInterval(intervalId);
  }, [setNow]);
  return (
    <div className="isolate flex -space-x-2 overflow-hidden">
      {othersPresence
        ?.slice(0, 5)
        .map((presence) => ({
          ...presence,
          online: isOnline(presence),
        }))
        .sort((presence1, presence2) =>
          presence1.online === presence2.online
            ? presence1.created - presence2.created
            : Number(presence1.online) - Number(presence2.online),
        )
        .map((presence) => (
          <span
            className={classNames(
              "relative inline-block h-6 w-6 rounded-full bg-white ring-2 ring-white text-xl",
              { grayscale: !presence.online },
            )}
            key={presence.created}
            title={
              presence.online
                ? "Online"
                : "Last seen " + new Date(presence.updated).toDateString()
            }
          >
            {presence.data.emoji}
          </span>
        ))}
    </div>
  );
};
