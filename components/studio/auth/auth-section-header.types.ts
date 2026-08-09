import type { ReactNode } from "react";

export interface AuthSectionHeaderProps {
  title: string;
  description: string;
  onRefresh: () => void;
  loading: boolean;
  countLabel?: string;
  placeholder?: string;
  search?: string;
  onSearchChange?: (value: string) => void;
  showSearch?: boolean;
  actions?: ReactNode;
}
