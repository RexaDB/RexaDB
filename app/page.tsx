import { Metadata } from "next";
import { Suspense } from "react";
import { ConnectionsPage } from "@/components/connections/connections-page";

export const metadata: Metadata = {
  title: "Manage Connections",
};

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ConnectionsPage />
    </Suspense>
  );
}
