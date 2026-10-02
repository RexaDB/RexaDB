import { useEffect, type Dispatch, type SetStateAction } from "react";
import { getStudioTags, getStudioTableTags } from "@/lib/api/actions-client";
import { subscribeStudioTagsChanged } from "@/lib/studio/studio-tag-events";

type Tag = { name: string; color: string };

/** Reload tag metadata when an AI agent updates this connection in another view. */
export function useStudioTagSync(
  connectionId: number,
  setTags: Dispatch<SetStateAction<Tag[]>>,
  setTableTags: Dispatch<SetStateAction<Record<string, string[]>>>,
) {
  useEffect(() => {
    let active = true;
    const reload = async () => {
      const [tags, tableTags] = await Promise.all([
        getStudioTags(connectionId),
        getStudioTableTags(connectionId),
      ]);
      if (!active) return;
      if (tags.success && tags.data) {
        setTags(tags.data.map((tag: Tag) => ({ name: tag.name, color: tag.color })));
      }
      if (tableTags.success && tableTags.data) setTableTags(tableTags.data);
    };
    const unsubscribe = subscribeStudioTagsChanged(connectionId, () => void reload());
    return () => {
      active = false;
      unsubscribe();
    };
  }, [connectionId, setTags, setTableTags]);
}
