import { extractCodeBlock } from "@/lib/ai/chat-blocks";
import type { ApprovalBlock, ApprovalQuestion } from "@/lib/ai/approval-types";
import { normalizeApprovalQuestionType } from "@/lib/ai/approval-types";

export function parseApprovalBlock(source: string): ApprovalBlock | null {
  const raw =
    extractCodeBlock(source, "approval") ||
    extractCodeBlock(source, "ask") ||
    extractCodeBlock(source, "questions") ||
    extractCodeBlock(source, "question");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed.questions) ? parsed.questions : null;
    if (!arr) return null;
    const questions: ApprovalQuestion[] = arr
      .map((q: any) => {
        if (!q || typeof q !== "object") return null;
        const text = String(q.q || q.question || q.title || "").trim();
        if (!text) return null;
        const options = Array.isArray(q.options) ? q.options.map((o: any) => String(o).trim()).filter(Boolean) : [];
        if (options.length === 0) return null;
        return {
          q: text,
          type: normalizeApprovalQuestionType(q.type),
          options: options.slice(0, 6),
        } as ApprovalQuestion;
      })
      .filter(Boolean) as ApprovalQuestion[];
    if (questions.length === 0) return null;
    return {
      questions: questions.slice(0, 5),
      resettable: parsed.resettable !== false,
    };
  } catch {
    return null;
  }
}

export function extractAllApprovalBlocks(source: string): ApprovalBlock[] {
  const blocks: ApprovalBlock[] = [];
  const re = /```(?:approval|ask|questions|question)\s*([\s\S]*?)\s*```/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const b = parseApprovalBlock(m[0]);
    if (b) blocks.push(b);
  }
  return blocks;
}
