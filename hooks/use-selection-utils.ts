import { useCallback } from "react";
import { toggleRowSelection as toggleRow } from "@/lib/studio-backend/api-client";

export function useToggleRowSelection(
  setSelectedRows: React.Dispatch<React.SetStateAction<Set<number>>>,
) {
  return useCallback((index: number) => {
    toggleRow(index, setSelectedRows);
  }, [setSelectedRows]);
}

export function useToggleHandlers(
  setter: (v: boolean) => void,
): [() => void, () => void] {
  const handleOpen = useCallback(() => setter(true), [setter]);
  const handleClose = useCallback(() => setter(false), [setter]);
  return [handleOpen, handleClose];
}
