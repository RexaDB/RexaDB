export type UsersTableColumn = {
  id: string;
  name: string;
  minWidth?: number;
  width?: number;
  resizable?: boolean;
};

export const USERS_TABLE_COLUMNS: UsersTableColumn[] = [
  { id: "img", name: "", minWidth: 95, width: 95, resizable: false },
  { id: "id", name: "UID", width: 280 },
  { id: "name", name: "Display name", minWidth: 0, width: 150 },
  { id: "email", name: "Email", width: 300 },
  { id: "phone", name: "Phone" },
  { id: "providers", name: "Providers", minWidth: 150 },
  { id: "provider_type", name: "Provider type", minWidth: 150 },
  { id: "created_at", name: "Created at", width: 260 },
  { id: "last_sign_in_at", name: "Last sign in at", width: 260 },
];

export type SpecificFilterColumn = "id" | "email" | "phone" | "name" | "freeform";

export const SEARCH_COLUMN_OPTIONS: {
  value: SpecificFilterColumn;
  label: string;
}[] = [
  { value: "id", label: "User ID" },
  { value: "email", label: "Email address" },
  { value: "phone", label: "Phone number" },
  { value: "freeform", label: "Unified search" },
];

export const UUIDV4_LEFT_PREFIX_REGEX =
  /^(?:[0-9a-f]{1,8}|[0-9a-f]{8}-|[0-9a-f]{8}-[0-9a-f]{1,4}|[0-9a-f]{8}-[0-9a-f]{4}-|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{0,3}|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{0,3}|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{0,12})$/i;

export const PHONE_NUMBER_LEFT_PREFIX_REGEX = /^[+]?[0-9]{0,15}$/;

export const SEARCH_PLACEHOLDERS: Record<SpecificFilterColumn, string> = {
  id: "Search by user ID",
  email: "Search by email",
  phone: "Search by phone",
  name: "Search by name",
  freeform: "Search by user ID, email, phone or name",
};

export const SORT_OPTIONS: {
  column: string;
  label: string;
}[] = [
  { column: "id", label: "Sort by user ID" },
  { column: "created_at", label: "Sort by created at" },
  { column: "last_sign_in_at", label: "Sort by last sign in at" },
  { column: "email", label: "Sort by email" },
  { column: "phone", label: "Sort by phone" },
];
