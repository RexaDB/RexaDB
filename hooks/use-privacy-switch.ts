"use client";

import { useCallback, useEffect, useState } from "react";
import { readPrivacySwitch, writePrivacySwitch } from "@/lib/privacy-settings";

/**
 * A privacy switch for the UI. It shares its reader with the code the switch
 * controls, so what Settings shows is always what the app will do.
 */
export function usePrivacySwitch(
  key: string,
  fallback: boolean,
): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(fallback);

  useEffect(() => {
    setValue(readPrivacySwitch(key, fallback));
  }, [key, fallback]);

  const update = useCallback(
    (next: boolean) => {
      writePrivacySwitch(key, next);
      setValue(readPrivacySwitch(key, fallback));
    },
    [key, fallback],
  );

  return [value, update];
}
