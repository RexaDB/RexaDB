"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Plus } from "@/lib/icon-theme/lucide-react";
import {
  studioApi,
  handleStudio401Error,
} from "@/lib/studio-backend/api-client";
import { toast } from "sonner";

export async function fetchTeamList<T>(
  url: string,
  setData: (data: T[]) => void,
  setLoading: (v: boolean) => void,
  errorMsg: string,
) {
  try {
    const res = await studioApi.get<{ data: T[] }>(url);
    setData(res.data || []);
  } catch (err) {
    if (await handleStudio401Error(err)) return;
    toast.error(err instanceof Error ? err.message : errorMsg);
  } finally {
    setLoading(false);
  }
}

interface TeamListLayoutProps {
  loading: boolean;
  title: string;
  description: string;
  buttonLabel: string;
  buttonDisabled?: boolean;
  onButtonClick: () => void;
  children: ReactNode;
}

export function TeamListLayout({
  loading,
  title,
  description,
  buttonLabel,
  buttonDisabled,
  onButtonClick,
  children,
}: TeamListLayoutProps) {
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-lg border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-sm font-semibold">{title}</h1>
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        </div>
        <Button onClick={onButtonClick} size="sm" disabled={buttonDisabled}>
          <Plus className="w-4 h-4 mr-1" /> {buttonLabel}
        </Button>
      </div>
      {children}
    </div>
  );
}
