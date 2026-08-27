import { Suspense } from "react";
import AgentsClient from "./AgentsClient";

export function generateStaticParams() {
  const ids: { id: string }[] = [];
  for (let i = 0; i < 200; i++) {
    ids.push({ id: String(i) });
  }
  return ids;
}

export default function AgentsPage() {
  return (
    <Suspense fallback={null}>
      <AgentsClient />
    </Suspense>
  );
}
