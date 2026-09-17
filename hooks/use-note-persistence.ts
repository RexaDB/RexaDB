import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Note } from "@/lib/studio/types";
import { normalizeNotes } from "@/lib/studio/note-utils";
import { getStudioNotes, saveStudioNotes } from "@/lib/api/actions-client";

interface UseNotePersistenceProps {
  connectionId: number;
  notes: Note[];
  setNotes: Dispatch<SetStateAction<Note[]>>;
}

/**
 * Mirrors useDashboardPersistence but simpler: notes are local-first
 * (SQLite + localStorage). No cloud sharing for v1.
 */
export function useNotePersistence({ connectionId, notes, setNotes }: UseNotePersistenceProps) {
  const hasLoadedRef = useRef(false);
  const lastSnapshotRef = useRef<string | null>(null);

  const loadLocalNotes = useCallback(async () => {
    hasLoadedRef.current = false;
    try {
      const stored = await getStudioNotes(connectionId).catch(() => null);
      const payload = stored?.success ? (stored.data as any) : null;
      const rawNotes = Array.isArray(payload?.notes) ? payload.notes : [];
      if (rawNotes.length > 0) {
        const snapshot = JSON.stringify(rawNotes);
        if (snapshot === lastSnapshotRef.current) return true;
        lastSnapshotRef.current = snapshot;
        setNotes(normalizeNotes(rawNotes));
        return true;
      }
      try {
        const raw = localStorage.getItem(`rexa-db-notes-${connectionId}`);
        if (raw) {
          const parsed = JSON.parse(raw);
          const list = Array.isArray(parsed) ? parsed : parsed?.notes;
          if (Array.isArray(list) && list.length > 0) {
            setNotes(normalizeNotes(list));
            return true;
          }
        }
      } catch (e) {
        console.error("Failed to load notes from local storage:", e);
      }
      setNotes([]);
      return false;
    } finally {
      hasLoadedRef.current = true;
    }
  }, [connectionId, setNotes]);

  useEffect(() => {
    void loadLocalNotes();
  }, [loadLocalNotes]);

  useEffect(() => {
    if (!hasLoadedRef.current) return;
    const payload = { notes };
    void saveStudioNotes(connectionId, payload).catch(() => {});
    lastSnapshotRef.current = JSON.stringify(notes);
    try {
      localStorage.setItem(`rexa-db-notes-${connectionId}`, JSON.stringify(payload));
    } catch {}
  }, [notes, connectionId]);
}
