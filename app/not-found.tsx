import Link from "next/link";

export default function NotFound() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "1rem" }}>Page not found</h1>
      <Link href="/" style={{ color: "var(--primary, #3b82f6)", textDecoration: "underline" }}>
        Back to connections
      </Link>
    </div>
  );
}
