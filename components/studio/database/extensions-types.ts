export interface DatabaseExtension {
  name: string
  default_version: string
  installed_version: string | null
  comment: string | null
  installed_schema?: string | null
  default_schema?: string | null
  requires?: string | null
  available_versions?: string | null
  trusted?: boolean | null
  relocatable?: boolean | null
  superuser?: boolean | null
}
