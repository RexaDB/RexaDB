"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
	ArrowLeft,
	ArrowRight,
	RefreshCw,
	ExternalLink,
	Globe,
	Home,
} from "lucide-react";
import { openExternalUrl } from "@/lib/desktop";

interface BrowserTabProps {
	initialUrl?: string;
	onUrlChange?: (url: string) => void;
}

export function BrowserTab({ initialUrl = "https://www.wikipedia.org", onUrlChange }: BrowserTabProps) {
	const [url, setUrl] = useState(initialUrl);
	const [history, setHistory] = useState<string[]>([initialUrl]);
	const [historyIndex, setHistoryIndex] = useState(0);
	const [isLoading, setIsLoading] = useState(false);
	const [loadError, setLoadError] = useState(false);
	const [isTauri, setIsTauri] = useState(false);
	const [useExternalBrowser, setUseExternalBrowser] = useState(false);
	const iframeRef = useRef<HTMLIFrameElement>(null);

	// Check if we're running in Tauri
	useEffect(() => {
		const checkTauri = async () => {
			try {
				const { invoke } = await import('@tauri-apps/api/core');
				await invoke('get_app_version');
				setIsTauri(true);
			} catch (error) {
				console.log('Not running in Tauri environment');
				setIsTauri(false);
			}
		};
		
		checkTauri();
	}, []);

	const convertToEmbedUrl = useCallback((originalUrl: string): string => {
		// In Tauri, we can try to use the URL directly, but for YouTube we still need special handling
		if (originalUrl.includes('youtube.com') || originalUrl.includes('youtu.be')) {
			const videoIdMatch = originalUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/);
			if (videoIdMatch) {
				return `https://www.youtube-nocookie.com/embed/${videoIdMatch[1]}`;
			}
			// For non-video YouTube pages, return the original URL and let error handling deal with it
			return originalUrl;
		}
		return originalUrl;
	}, []);

	const navigateToUrl = useCallback(async (newUrl: string) => {
		if (!newUrl.trim()) return;
		
		let formattedUrl = newUrl;
		if (!/^https?:\/\//i.test(newUrl)) {
			formattedUrl = `https://${newUrl}`;
		}

		setUrl(formattedUrl);
		setIsLoading(true);
		setLoadError(false);
		onUrlChange?.(formattedUrl);

		const newHistory = history.slice(0, historyIndex + 1);
		newHistory.push(formattedUrl);
		setHistory(newHistory);
		setHistoryIndex(newHistory.length - 1);

		// Check if this should use external browser
		const isYouTube = formattedUrl.includes('youtube.com') || formattedUrl.includes('youtu.be');
		const isNonVideoYouTube = isYouTube && !formattedUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/);
		
		if (useExternalBrowser || (isTauri && isNonVideoYouTube)) {
			openExternalUrl(formattedUrl);
			setIsLoading(false);
			return;
		}

		// Use iframe for embeddable content
		const embedUrl = convertToEmbedUrl(formattedUrl);
		if (iframeRef.current) {
			iframeRef.current.src = embedUrl;
		}
		
		// Set a timeout for loading
		setTimeout(() => {
			setIsLoading(false);
		}, 3000);
	}, [history, historyIndex, onUrlChange, convertToEmbedUrl, isTauri, useExternalBrowser]);

	const handleGoBack = useCallback(() => {
		if (historyIndex > 0) {
			const newIndex = historyIndex - 1;
			setHistoryIndex(newIndex);
			const previousUrl = history[newIndex];
			setUrl(previousUrl);
			setLoadError(false);
			onUrlChange?.(previousUrl);
			
			const embedUrl = convertToEmbedUrl(previousUrl);
			if (iframeRef.current) {
				iframeRef.current.src = embedUrl;
			}
		}
	}, [historyIndex, history, onUrlChange, convertToEmbedUrl]);

	const handleGoForward = useCallback(() => {
		if (historyIndex < history.length - 1) {
			const newIndex = historyIndex + 1;
			setHistoryIndex(newIndex);
			const nextUrl = history[newIndex];
			setUrl(nextUrl);
			setLoadError(false);
			onUrlChange?.(nextUrl);
			
			const embedUrl = convertToEmbedUrl(nextUrl);
			if (iframeRef.current) {
				iframeRef.current.src = embedUrl;
			}
		}
	}, [historyIndex, history, onUrlChange, convertToEmbedUrl]);

	const handleRefresh = useCallback(() => {
		setIsLoading(true);
		setLoadError(false);
		
		const embedUrl = convertToEmbedUrl(url);
		if (iframeRef.current) {
			iframeRef.current.src = embedUrl;
		}
		
		setTimeout(() => {
			setIsLoading(false);
		}, 2000);
	}, [url, convertToEmbedUrl]);

	const handleHome = () => {
		navigateToUrl("https://www.wikipedia.org");
	};

	const handleOpenExternal = () => {
		openExternalUrl(url);
	};

	const toggleExternalBrowser = () => {
		setUseExternalBrowser(!useExternalBrowser);
		if (!useExternalBrowser) {
			// If switching to external browser, open current URL
			openExternalUrl(url);
		}
	};

	const handleIframeLoad = () => {
		setIsLoading(false);
		setLoadError(false);
	};

	const handleIframeError = () => {
		setIsLoading(false);
		setLoadError(true);
	};

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		navigateToUrl(url);
	};

	// Initialize iframe on mount
	useEffect(() => {
		const embedUrl = convertToEmbedUrl(initialUrl);
		if (iframeRef.current) {
			iframeRef.current.src = embedUrl;
		}
	}, [initialUrl, convertToEmbedUrl]);

	const isYouTube = url.includes('youtube.com') || url.includes('youtu.be');
	const isNonVideoYouTube = isYouTube && !url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/);

	return (
		<div className="flex flex-col h-full bg-background">
			{/* Browser toolbar */}
			<div className="flex items-center gap-2 p-2 border-b border-border">
				<div className="flex items-center gap-1">
					<Button
						variant="ghost"
						size="icon-sm"
						className="size-7"
						onClick={handleGoBack}
						disabled={historyIndex === 0}
					>
						<ArrowLeft className="size-4" />
					</Button>
					<Button
						variant="ghost"
						size="icon-sm"
						className="size-7"
						onClick={handleGoForward}
						disabled={historyIndex === history.length - 1}
					>
						<ArrowRight className="size-4" />
					</Button>
					<Button
						variant="ghost"
						size="icon-sm"
						className="size-7"
						onClick={handleRefresh}
						disabled={isLoading}
					>
						<RefreshCw className={cn("size-4", isLoading && "animate-spin")} />
					</Button>
					<Button
						variant="ghost"
						size="icon-sm"
						className="size-7"
						onClick={handleHome}
					>
						<Home className="size-4" />
					</Button>
				</div>

				<form onSubmit={handleSubmit} className="flex-1 flex">
					<Input
						type="text"
						value={url}
						onChange={(e) => setUrl(e.target.value)}
						placeholder="Enter URL..."
						className="flex-1 h-7 text-sm"
					/>
				</form>

				<div className="flex items-center gap-1">
					{isTauri && (
						<Button
							variant={useExternalBrowser ? "default" : "ghost"}
							size="icon-sm"
							className="size-7"
							onClick={toggleExternalBrowser}
							title={useExternalBrowser ? "Use embedded browser" : "Use external browser"}
						>
							<ExternalLink className={cn("size-4", useExternalBrowser && "text-primary")} />
						</Button>
					)}
					<Button
						variant="ghost"
						size="icon-sm"
						className="size-7"
						onClick={handleOpenExternal}
						title="Open in external browser"
					>
						<Globe className="size-4" />
					</Button>
				</div>
			</div>

			{/* Browser content */}
			<div className="flex-1 relative">
				{isLoading && (
					<div className="absolute inset-0 flex items-center justify-center bg-background/50 z-10">
						<div className="flex items-center gap-2 text-sm text-muted-foreground">
							<RefreshCw className="size-4 animate-spin" />
							<span>Loading...</span>
						</div>
					</div>
				)}
				
				{loadError ? (
					<div className="absolute inset-0 flex flex-col items-center justify-center bg-background z-10 p-8 text-center">
						<Globe className="size-12 text-muted-foreground mb-4" />
						<h3 className="text-lg font-semibold mb-2">Unable to embed this page</h3>
						<p className="text-sm text-muted-foreground mb-6 max-w-md">
							{isNonVideoYouTube ? (
								<>
									YouTube homepage, search, and channels cannot be embedded. 
									Use the external browser button for full YouTube functionality.
								</>
							) : (
								<>
									This website blocks embedding in iframes for security reasons. 
									Try Wikipedia, documentation sites, or use external browser.
								</>
							)}
						</p>
						<div className="flex gap-3">
							<Button
								onClick={handleOpenExternal}
								variant="default"
								className="gap-2"
							>
								<Globe className="size-4" />
								Open in External Browser
							</Button>
							<Button
								onClick={handleRefresh}
								variant="outline"
								className="gap-2"
							>
								<RefreshCw className="size-4" />
								Try Again
							</Button>
						</div>
					</div>
				) : (
					<iframe
						ref={iframeRef}
						src={convertToEmbedUrl(url)}
						title="Browser"
						className="w-full h-full border-0"
						sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-modals allow-presentation"
						onLoad={handleIframeLoad}
						onError={handleIframeError}
						allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
						allowFullScreen
					/>
				)}
			</div>
		</div>
	);
}