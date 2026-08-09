"use client";

import { AppErrorPage } from "@/components/shared/app-error-page";

export default function TeamError({
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
      errorType="react-team-error"
      title="Something went wrong"
      message="An error occurred on this page. It&apos;s been logged."
    />
  );
}
