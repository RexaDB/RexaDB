export default function GlobalLoading() {
  return (
    <div
      className="flex h-svh items-center justify-center bg-background text-muted-foreground"
      style={{ fontFamily: "system-ui, sans-serif" }}
    >
      <p className="text-sm">Loading...</p>
    </div>
  );
}
