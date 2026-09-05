"use client";

import { useEffect, useRef, useState } from "react";
import { SqlEditor } from "@/components/studio/sql-editor";
import {
  useGlobalSqlControls,
  useStudioEditorProps,
  useStudioGridProps,
} from "@/components/studio/use-global-sql-panel-props";

/**
 * VS Code-style bottom "SQL Editor" panel for the Modern UI. Reuses the real
 * <SqlEditor /> component wired to the studio's global SQL context, so it is
 * exactly the same editor as the SQL editor tab. Toggleable with the panel
 * button or the Toggle Bottom Panel keybinding (default Cmd+J). The shell
 * controls the height; the drag handle lives in
 * the shell between the content card and this panel.
 */
export function ModernSqlEditorPanel({
	studio,
}: {
	studio: any;
}) {
	const [query, setQuery] = useState("");
	const rawState = studio.sqlTabStates?.[studio.globalSqlContextId] ?? null;
	const containerRef = useRef<HTMLDivElement | null>(null);
	const [layoutVersion, setLayoutVersion] = useState(0);

	useEffect(() => {
		const el = containerRef.current;
		if (!el) return;
		const observer = new ResizeObserver(() =>
			setLayoutVersion((v) => v + 1),
		);
		observer.observe(el);
		return () => observer.disconnect();
	}, []);

	const { dbType, state, handleRunQuery, handleStopQuery, canStopQuery } =
    useGlobalSqlControls(studio, query, rawState);
	const gridProps = useStudioGridProps(studio);
	const editorProps = useStudioEditorProps(studio);

	return (
		<div ref={containerRef} className="flex h-full min-h-0 flex-col overflow-hidden">
			<div className="flex min-h-0 flex-1 flex-col">
				<SqlEditor
					hideResults
					connectionId={studio.connection.id}
					connectionString={studio.currentConnectionString}
					dbType={dbType}
					query={query}
					setQuery={setQuery}
					error={state?.error ?? null}
					results={state?.results ?? null}
					loading={Boolean(state?.loading)}
					executionTime={state?.executionTime ?? 0}
					handleRunQuery={handleRunQuery}
					handleStopQuery={handleStopQuery}
					canStopQuery={canStopQuery}
					{...editorProps}
					layoutVersion={layoutVersion}
					keybindings={studio.keybindings}
					slashAiTrigger={studio.slashAiTrigger}
					resultTabsEnabled={studio.resultTabsEnabled}
					gridProps={gridProps}
					onOpenUnsavedQuery={(name, nextQuery) =>
						studio.openSqlEditor(undefined, undefined, nextQuery)
					}
				/>
			</div>
		</div>
	);
}
