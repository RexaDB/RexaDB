"use client";

import { AppErrorPage } from "@/components/shared/app-error-page";

export default function StudioError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <AppErrorPage
      error={error}
      reset={reset}
      errorType="react-studio-error"
      title="Studio crashed"
      titleColor="var(--destructive, #ef4444)"
      message="The query editor encountered an error. It&apos;s been reported — try reloading."
      resetLabel="Reload studio"
    />
  );
}
