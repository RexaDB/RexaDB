import { z } from "zod";
import { createTool } from "@mastra/core/tools";
import { ok, fail } from "./ai-shared";

export function createApprovalTools() {
  return {
    ask_questions: createTool({
      id: "ask_questions",
      description:
        "Ask the user one or more questions that require human approval or input. Use when you need clarification, choices, or confirmation before proceeding. Each question can be single-choice (radio) or multi-select (check). The UI will show an approval card with the questions. This tool will wait for the user's answer and return it.",
      inputSchema: z.object({
        questions: z
          .array(
            z.object({
              q: z.string().min(1).describe("Question text, e.g. 'How many flavors should we launch?'"),
              type: z.enum(["radio", "check"]).describe("radio for single-choice, check for multi-select"),
              options: z.array(z.string().min(1)).min(1).max(6).describe("Answer options"),
            }),
          )
          .min(1)
          .max(5),
      }),
      outputSchema: z.object({
        ok: z.boolean(),
        data: z.any().nullable(),
        error: z.string().nullable(),
      }),
      execute: async ({ questions }) => {
        const { createPendingApproval } = await import("@/lib/ai/pending-approvals");
        const toolCallId = `mastra-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const answers = await createPendingApproval(toolCallId, questions);
        return ok({ answers, questions, message: "User provided answers" });
      },
    }),

    ask_approval: createTool({
      id: "ask_approval",
      description: "Ask for approval on a single decision. Shorthand for ask_questions with one radio question. This tool will wait for the user's answer.",
      inputSchema: z.object({
        question: z.string().min(1),
        options: z.array(z.string().min(1)).min(1).max(6),
        type: z.enum(["radio", "check"]).optional().default("radio"),
      }),
      outputSchema: z.object({
        ok: z.boolean(),
        data: z.any().nullable(),
        error: z.string().nullable(),
      }),
      execute: async ({ question, options, type }) => {
        const { createPendingApproval } = await import("@/lib/ai/pending-approvals");
        const toolCallId = `mastra-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const questions = [{ q: question, type: type || "radio", options }];
        const answers = await createPendingApproval(toolCallId, questions);
        return ok({ answers, questions, message: "User provided answer" });
      },
    }),
  };
}
