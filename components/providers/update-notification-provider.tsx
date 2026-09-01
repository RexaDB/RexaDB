"use client";

/**
 * Update UI is now rendered inline in headers (UpdateHeaderBadge) right after
 * the search bar, in both the Connections header and the Modern UI header.
 * This provider no longer renders the old floating bottom-right card; it just
 * passes children through so the AppUpdateProvider context remains available.
 */
export function UpdateNotificationProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
