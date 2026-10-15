import { useEffect } from "react";

export default (
  text: string,
  updateMyPresence: (p: { typing?: boolean }) => void,
) => {
  useEffect(() => {
    if (text.length === 0) {
      updateMyPresence({ typing: false });
      return;
    }
    updateMyPresence({ typing: true });
    const timer = setTimeout(() => updateMyPresence({ typing: false }), 1000);
    return () => clearTimeout(timer);
  }, [updateMyPresence, text]);
};
