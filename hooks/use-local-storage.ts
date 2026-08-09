"use client";

import { useState, useEffect } from "react";

export function useLocalStorage<T>(key: string, initialValue: T): [T, (value: T) => void] {
  const [storedValue, setStoredValue] = useState<T>(initialValue);

  useEffect(() => {
    try {
      const item = localStorage.getItem(key);
      if (item !== null) setStoredValue(JSON.parse(item));
    } catch {}
  }, [key]);

  const setValue = (value: T) => {
    setStoredValue(value);
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  };

  return [storedValue, setValue];
}
