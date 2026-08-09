"use client";

import { AppErrorPage } from "@/components/shared/app-error-page";

export default function AuthError({
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
      errorType="react-auth-error"
      title="Auth error"
      message="Something went wrong during authentication. Please try again."
    />
  );
}
