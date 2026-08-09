"use client";

import type { AuthProviderConfig } from "@/lib/studio/auth-provider-types";

interface AuthCustomProvidersTableProps {
  providers: AuthProviderConfig[];
  onManage: (provider: AuthProviderConfig) => void;
}

export function AuthCustomProvidersTable({
  providers,
  onManage,
}: AuthCustomProvidersTableProps) {
  if (!providers.length) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        No custom providers yet.
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="overflow-hidden rounded-lg border border-studio-border">
        <table className="w-full text-sm">
          <thead className="bg-studio-bg/60 text-xstracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left">Name</th>
              <th className="px-4 py-3 text-left">Identifier</th>
              <th className="px-4 py-3 text-left">Type</th>
              <th className="px-4 py-3 text-left">Enabled</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-studio-border">
            {providers.map((provider) => (
              <tr
                key={provider.id}
                onClick={() => onManage(provider)}
                className="cursor-pointer hover:bg-studio-row-hover"
              >
                <td className="px-4 py-3 font-medium text-foreground">
                  {provider.name}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {provider.identifier}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {provider.provider_type}
                </td>
                <td
                  className={`px-4 py-3 text-xs font-semibold ${provider.enabled ? "text-emerald-400" : "text-muted-foreground"}`}
                >
                  {provider.enabled ? "Enabled" : "Disabled"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
