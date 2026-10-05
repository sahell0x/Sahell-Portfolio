"use client";

import { useEffect, useState } from "react";

/** "⌘" on Apple platforms, "Ctrl" elsewhere — decided after mount. */
export function useModKey() {
  const [mod, setMod] = useState("⌘");
  useEffect(() => {
    const platform =
      (navigator as Navigator & { userAgentData?: { platform?: string } })
        .userAgentData?.platform ?? navigator.platform;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!/mac|iphone|ipad/i.test(platform)) setMod("Ctrl");
  }, []);
  return mod;
}
