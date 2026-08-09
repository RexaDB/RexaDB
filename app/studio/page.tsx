import { Suspense } from "react";
import StudioClient from "./[id]/StudioClient";

export default function StudioPage() {
  return (
    <Suspense fallback={null}>
      <StudioClient />
    </Suspense>
  );
}
