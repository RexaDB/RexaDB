export default function AuthLoading() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <p style={{ color: "var(--muted-foreground, #888)", fontSize: "0.875rem" }}>
        Signing in...
      </p>
    </div>
  );
}
