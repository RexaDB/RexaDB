"use client";
import { cn } from "@/lib/utils";
import { Mail } from "@/lib/icon-theme/lucide-react";
import { AUTH_PROVIDER_NAMES } from "./auth-providers-data";

function isCustomProvider(provider: string): boolean {
  return provider.startsWith("custom:");
}

export function AuthProvidersCell({
  providers,
  icons = [],
}: {
  providers: string[];
  icons?: string[];
}) {
  if (!providers.length) return <span className="text-studio-cell-muted">-</span>;

  const display = providers
    .map((provider) => {
      if (isCustomProvider(provider)) return provider.split("custom:")[1] ?? provider;
      return AUTH_PROVIDER_NAMES[provider] ?? provider;
    })
    .join(", ");

  return (
    <div className="w-full flex items-center text-xs capitalize">
      {icons.length > 0 &&
        providers.map((provider, idx) => {
          const icon = icons[idx];
          const isCustom = isCustomProvider(provider);
          return (
            <div
              key={`${provider}-wrapper`}
              className="min-w-6 min-h-6 rounded-full border border-studio-border flex items-center justify-center bg-studio-header-bg overflow-hidden"
              style={{
                marginLeft: idx === 0 ? 0 : -8,
                zIndex: providers.length - idx,
              }}
            >
              {isCustom ? (
                <span className="text-xs text-studio-cell-text">
                  {(provider.split("custom:")[1]?.[0] ?? "?").toUpperCase()}
                </span>
              ) : icon ? (
                <img
                  key={`${provider}-icon`}
                  width={16}
                  height={16}
                  src={icon}
                  alt={`${provider} auth icon`}
                  className={cn(
                    (provider === "github" || provider === "x") && "dark:invert",
                  )}
                />
              ) : (
                <Mail className="h-3 w-3 text-studio-cell-muted" />
              )}
            </div>
          );
        })}
      <p className="ml-1">{display}</p>
    </div>
  );
}
