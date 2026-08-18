"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, SquareTerminal, X } from "@/lib/icon-theme/lucide-react";

const PROMPT = "rexa@studio";

const BOOT_LINES = [
	"Welcome to the RexaDB terminal.",
	"This panel will later become the SQL editor.",
	'Type "help" for a list of commands.',
	"",
];

/**
 * VS Code-style bottom panel for the Modern UI. Shaped like a terminal for
 * now; will become the SQL editor later. Toggleable with the panel button or
 * the Toggle Bottom Panel keybinding (default Cmd+J).
 */
export function ModernTerminalPanel({ onClose }: { onClose: () => void }) {
	const [lines, setLines] = useState<string[]>(BOOT_LINES);
	const [value, setValue] = useState("");
	const scrollRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		const el = scrollRef.current;
		if (el) el.scrollTop = el.scrollHeight;
	}, [lines]);

	const submit = () => {
		const cmd = value.trim();
		if (!cmd) return;
		let output: string[] = [];
		if (cmd === "clear") output = [];
		else if (cmd === "help") output = ["Available commands: clear, help"];
		else output = [`zsh: command not found: ${cmd}`];
		setLines((prev) => [...prev, `${PROMPT} % ${cmd}`, ...output].slice(-200));
		setValue("");
	};

	return (
		<div className="flex h-64 shrink-0 flex-col overflow-hidden border-t border-border bg-[var(--shell-content-bg)]">
			<div className="flex h-8 shrink-0 items-center justify-between border-b border-border/60 px-3">
				<div className="flex items-center gap-1.5 text-foreground">
					<SquareTerminal className="size-3.5 text-muted-foreground" />
					<span className="text-xs font-medium">Terminal</span>
				</div>
				<div className="flex items-center gap-0.5">
					<button
						type="button"
						aria-label="Collapse panel"
						onClick={onClose}
						className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
					>
						<ChevronDown className="size-3.5" />
					</button>
					<button
						type="button"
						aria-label="Close panel"
						onClick={onClose}
						className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
					>
						<X className="size-3.5" />
					</button>
				</div>
			</div>
			<div
				ref={scrollRef}
				className="min-h-0 flex-1 overflow-y-auto bg-black/25 px-3 py-2 font-mono text-[13px] leading-relaxed text-foreground"
			>
				{lines.map((line, i) => (
					<div key={i} className="whitespace-pre-wrap">
						{line}
					</div>
				))}
				<div className="flex items-center gap-2">
					<span className="shrink-0">
						<span className="text-emerald-500">{PROMPT}</span>
						<span className="text-sky-500"> %</span>
					</span>
					<input
						autoFocus
						spellCheck={false}
						value={value}
						onChange={(e) => setValue(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") submit();
						}}
						className="min-w-0 flex-1 bg-transparent font-mono text-foreground outline-none placeholder:text-muted-foreground/50"
						placeholder="type a command"
					/>
				</div>
			</div>
		</div>
	);
}
