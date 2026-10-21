import { AUTH_USERS_LIMIT } from "./users-constants";

export type NeonUserStatusFilter = "all" | "verified" | "unverified";

export interface NeonUsersEmptyMessage {
  title: string;
  description: string;
}

const STATUS_LABELS: Record<Exclude<NeonUserStatusFilter, "all">, string> = {
  verified: "verified",
  unverified: "unverified",
};

/**
 * The empty table has to name the filter that emptied it, otherwise a
 * filtered list reads as a project without users.
 */
export function neonUsersEmptyMessage({
  search,
  status,
}: {
  search: string;
  status: NeonUserStatusFilter;
}): NeonUsersEmptyMessage {
  const hasSearch = search.trim().length > 0;
  const hasStatus = status !== "all";
  if (!hasSearch && !hasStatus) {
    return {
      title: "No users in your project",
      description: "There are currently no users who signed up to your project",
    };
  }
  if (hasStatus && !hasSearch) {
    return {
      title: `No ${STATUS_LABELS[status]} users`,
      description: `There are currently no ${STATUS_LABELS[status]} users in your project. Change the status filter to see the other accounts.`,
    };
  }
  return {
    title: "No users found",
    description: "There are currently no users based on the filters applied",
  };
}

export interface NeonUsersStatusMessage {
  text: string;
  tone: "muted" | "error";
  notice: string | null;
}

/**
 * The line under the Neon user table: the count, the refresh state, and the
 * notice that older accounts are not loaded.
 */
export function neonUsersStatusMessage({
  error,
  loading,
  filteredCount,
  totalCount,
  limitReached,
}: {
  error: string | null;
  loading: boolean;
  filteredCount: number;
  totalCount: number;
  limitReached: boolean;
}): NeonUsersStatusMessage {
  const notice = limitReached
    ? `Showing the ${AUTH_USERS_LIMIT} most recent users`
    : null;
  if (error) {
    return { text: `Unable to refresh users: ${error}`, tone: "error", notice };
  }
  if (loading) {
    return { text: "Refreshing users…", tone: "muted", notice };
  }
  return {
    text: `Showing ${filteredCount} of ${totalCount} users`,
    tone: "muted",
    notice,
  };
}
