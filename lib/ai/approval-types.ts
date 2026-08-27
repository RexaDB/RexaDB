export type ApprovalQuestionType = "radio" | "check";

export type ApprovalQuestion = {
  q: string;
  type: ApprovalQuestionType;
  options: string[];
};

export type ApprovalBlock = {
  questions: ApprovalQuestion[];
  resettable?: boolean;
};

export function normalizeApprovalQuestionType(v: unknown): ApprovalQuestionType {
  const s = String(v || "").toLowerCase().trim();
  if (s === "check" || s === "checkbox" || s === "multi" || s === "multiple") return "check";
  return "radio";
}
