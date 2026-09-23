export { ProviderAccountsHeader } from "@/components/shared/provider-accounts/header";
export {
  AccountChips,
  type AccountChipItem,
} from "@/components/shared/provider-accounts/account-chips";
export { ProviderEmptyState } from "@/components/shared/provider-accounts/empty-state";
export { ProviderListToolbar } from "@/components/shared/provider-accounts/list-toolbar";
export { ResourceRow } from "@/components/shared/provider-accounts/resource-row";
export {
  buildAccountChips,
  filterByName,
  ProviderBranchLoadingState,
  ProviderLoadError,
  ProviderLoadingState,
  ProviderOrgError,
} from "@/components/shared/provider-accounts/shared";

export interface ProviderConnectPayload {
  name: string;
  connectionString: string;
  connectionType: string;
}

export interface ProviderAccountScreenBaseProps {
  activeAccountId: string | null;
  onSwitchAccount: (id: string) => void;
  onRemoveAccount: (id: string) => void;
  onAddAccount: () => void;
  canAddAccount: boolean;
  onBack?: () => void;
  onConnectDatabase: (
    payload: ProviderConnectPayload,
    opts?: { silent?: boolean },
  ) => Promise<{ success: boolean }>;
}
