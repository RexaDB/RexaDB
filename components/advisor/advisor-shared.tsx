import {
  Shield,
  Zap,
  Database,
  Table2,
  User,
  Terminal,
  FunctionSquare,
} from "@/lib/icon-theme/lucide-react";

export function EntityIcon({ checkId, className }: { checkId: string; className?: string }) {
  switch (checkId) {
    case "tables-without-rls":
    case "tables-without-pk":
    case "rls-policies-missing":
    case "table-bloat":
    case "cache-hit-ratio":
    case "missing-foreign-key-indexes":
    case "missing-indexes-on-fk":
      return <Table2 className={className} />;
    case "superuser-roles":
      return <User className={className} />;
    case "slow-queries":
      return <Terminal className={className} />;
    case "disabled-triggers":
      return <Zap className={className} />;
    case "function-search-path-mutable":
    case "security-definer-public":
    case "security-definer-authenticated":
      return <FunctionSquare className={className} />;
    case "leaked-password-protection":
      return <Shield className={className} />;
    case "unused-indexes":
    case "indexes-on-low-cardinality":
    case "duplicate-index":
    case "multiple-permissive-policies":
    case "auth-rls-initplan":
    default:
      return <Database className={className} />;
  }
}
