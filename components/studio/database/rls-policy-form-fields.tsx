"use client";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HighlightedTextarea } from "./highlighted-textarea";

interface RlsPolicyFormFieldsProps {
  formName: string;
  setFormName: (value: string) => void;
  formCommand: string;
  setFormCommand: (value: string) => void;
  formPermissive: "PERMISSIVE" | "RESTRICTIVE";
  setFormPermissive: (value: "PERMISSIVE" | "RESTRICTIVE") => void;
  formRoles: string;
  setFormRoles: (value: string) => void;
  formUsingExpression: string;
  setFormUsingExpression: (value: string) => void;
  formWithCheckExpression: string;
  setFormWithCheckExpression: (value: string) => void;
}

export function RlsPolicyFormFields(props: RlsPolicyFormFieldsProps) {
  return (
    <>
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground">Policy Name</label>
        <Input value={props.formName} onChange={(e) => props.setFormName(e.target.value)} className="h-9 text-xs" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">Command</label>
          <Select value={props.formCommand} onValueChange={props.setFormCommand}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">ALL</SelectItem>
              <SelectItem value="select">SELECT</SelectItem>
              <SelectItem value="insert">INSERT</SelectItem>
              <SelectItem value="update">UPDATE</SelectItem>
              <SelectItem value="delete">DELETE</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">Policy Mode</label>
          <Select
            value={props.formPermissive}
            onValueChange={(value: "PERMISSIVE" | "RESTRICTIVE") => props.setFormPermissive(value)}
          >
            <SelectTrigger className="h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="PERMISSIVE">PERMISSIVE</SelectItem>
              <SelectItem value="RESTRICTIVE">RESTRICTIVE</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground">Roles (comma-separated)</label>
        <Input
          value={props.formRoles}
          onChange={(e) => props.setFormRoles(e.target.value)}
          placeholder="public, authenticated"
          className="h-9 text-xs"
        />
      </div>

      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground">USING expression</label>
        <HighlightedTextarea
          value={props.formUsingExpression}
          onChange={(e) => props.setFormUsingExpression(e.target.value)}
          placeholder="auth.uid() = user_id"
        />
      </div>

      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground">WITH CHECK expression</label>
        <HighlightedTextarea
          value={props.formWithCheckExpression}
          onChange={(e) => props.setFormWithCheckExpression(e.target.value)}
          placeholder="auth.uid() = user_id"
        />
      </div>
    </>
  );
}

export function buildRlsPolicyPayload(form: RlsPolicyFormFieldsProps) {
  return {
    name: form.formName.trim(),
    command: form.formCommand,
    permissive: form.formPermissive,
    roles: form.formRoles
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean),
    usingExpression: form.formUsingExpression.trim() || null,
    withCheckExpression: form.formWithCheckExpression.trim() || null,
  };
}
