import { AGENT_PROVIDER_META, type AgentProvider, type AgentProviderId } from "./provider-types";

export type LocalCliProviderId = Exclude<AgentProviderId, "rexadb">;

/** Keep CLI authentication separate from API providers with similar names. */
export function localCliProviderKey(id: LocalCliProviderId): string {
  return `cli:${id}`;
}

export function getLocalCliProviderId(provider: string): LocalCliProviderId | null {
  if (!provider.startsWith("cli:")) return null;
  const id = provider.slice(4);
  return id !== "rexadb" && Object.hasOwn(AGENT_PROVIDER_META, id)
    ? id as LocalCliProviderId
    : null;
}

export function localCliModels(providers: AgentProvider[]) {
  return providers.filter((p) => p.id !== "rexadb" && p.available && p.status === "installed")
    .flatMap((p) => {
      const provider = localCliProviderKey(p.id as LocalCliProviderId);
      // Other harnesses currently delegate model choice to their CLI config.
      const selectable = ["codex", "claude-code", "opencode", "pi"].includes(p.id);
      const models = selectable ? (p.models || []).filter((m) => m.id !== "default") : [];
      return [
        { provider, model: "default", label: `${p.name} · CLI default`, name: p.name },
        ...models.map((m) => ({ provider, model: m.id, label: `${p.name} · ${m.label}`, name: p.name })),
      ];
    });
}
