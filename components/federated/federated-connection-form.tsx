"use client";

import type { Connection } from "@/lib/db/schema";
import { FederatedConnectionList } from "./federated-connection-list";
import { FederatedSelectedSources } from "./federated-selected-sources";
import type { FederatedDraft } from "./federated-connection-types";
import { setFederatedConnectionChecked } from "./federated-connection-utils";

type Props = {
  connections: Connection[];
  value: FederatedDraft[];
  onChange: (next: FederatedDraft[]) => void;
};

export function FederatedConnectionForm({ connections, value, onChange }: Props) {
  return (
    <div className="space-y-4">
      <FederatedConnectionList
        connections={connections}
        value={value}
        onToggle={(connection, checked) => onChange(setFederatedConnectionChecked(connection, value, checked))}
      />
      {value.length ? <FederatedSelectedSources connections={connections} value={value} onChange={onChange} /> : null}
    </div>
  );
}
