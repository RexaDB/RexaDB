import { Suspense } from "react";
import StudioClient from "./StudioClient";

export function generateStaticParams() {
  const ids: { id: string }[] = [];
  for (let i = 0; i < 200; i++) {
    ids.push({ id: String(i) });
  }
  return ids;
}

export default function StudioPage() {
  return (
    <Suspense fallback={null}>
      <StudioClient />
    </Suspense>
  );
}
