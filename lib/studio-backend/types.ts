"use client";

export interface StudioUser {
  id: string;
  email: string;
  name: string;
  roleId: number;
  isActive: boolean;
  createdAt: string;
}

export interface UserWithRoleResponse extends StudioUser {
  role: {
    id: number;
    name: string;
    description: string;
  };
  avatarUrl?: string | null;
}

export interface Role {
  id: number;
  name: string;
  description: string;
  isSystem: boolean;
  createdAt: string;
  permissions: Permission[];
  userCount: number;
  users: StudioUser[];
}

export interface Permission {
  id: number;
  code: string;
  name: string;
  description: string;
}

export interface Connection {
  id: string;
  name: string;
  type: "postgres" | "mysql";
  host: string;
  port: number;
  database: string;
  username: string;
  ssl: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type TableActionHandler = (table: string, schema: string) => void;
export type ExportDataHandler = (format: "json" | "csv" | "sql") => void;
export type OpenSqlEditorHandler = (table?: string, schema?: string, initialQuery?: string) => void;

interface ConnectionInput {
  name: string;
  type: "postgres" | "mysql";
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl?: boolean;
}

export interface ConnectionAccess {
  id: number;
  connectionId: string;
  roleId: number;
  role: { id: number; name: string; description: string };
  accessType: "FULL_ACCESS" | "READ_ONLY" | "READ_AND_REQUEST" | "CUSTOM";
  queryPattern: string | null;
  allowedQueryIds: string | null;
}

export type AccessType = "FULL_ACCESS" | "READ_ONLY" | "READ_AND_REQUEST" | "CUSTOM";

export interface Invite {
  id: number;
  email: string;
  status: "PENDING" | "ACCEPTED" | "EXPIRED";
  expiresAt: string;
  createdAt: string;
  acceptedAt: string | null;
  createdBy: { id: string; email: string; name: string; avatarUrl?: string | null; role?: { id: number; name: string } | null };
}

interface SavedQuery {
  id: number;
  connectionId: string;
  name: string;
  queryText: string;
  createdBy: string;
  createdAt: string;
}

interface QueryResult {
  rows: Record<string, unknown>[];
  fields: string[];
  rowCount: number;
  duration: number;
}

export type PendingQueryStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface PendingQuery {
  id: number;
  connectionId: string;
  teamId: number | null;
  requestedBy: string;
  sql: string;
  params: string | null;
  status: PendingQueryStatus;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
  requestedByUser: { id: string; email: string; name: string };
  connection: { id: string; name: string; type: string };
  approvedByUser?: { id: string; email: string; name: string } | null;
}

export interface ApiResponse<T> {
  data: T;
  error?: string;
  code?: string;
}
