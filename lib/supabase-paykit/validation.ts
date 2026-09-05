import type {
  PaykitDraftState,
  PaykitFeatureDraft,
  PaykitPlanDraft,
  PaykitResetInterval,
} from "./types";

export const PAYKIT_ID_RE = /^[a-z0-9_-]{1,64}$/;
export const PAYKIT_RESETS: PaykitResetInterval[] = ["day", "week", "month", "year"];

export function validatePaykitId(id: string): string | null {
  if (!id || !id.trim()) return "ID is required.";
  if (!PAYKIT_ID_RE.test(id.trim())) {
    return "Lowercase alphanumeric with dashes/underscores, max 64 chars.";
  }
  return null;
}

export function validateFeature(f: PaykitFeatureDraft): string | null {
  const idErr = validatePaykitId(f.id);
  if (idErr) return `Feature "${f.id || "?"}": ${idErr}`;
  if (f.type !== "boolean" && f.type !== "metered") {
    return `Feature "${f.id}": type must be boolean or metered.`;
  }
  return null;
}

export function validatePlan(
  plan: PaykitPlanDraft,
  featuresById: Map<string, PaykitFeatureDraft>,
): string[] {
  const errors: string[] = [];
  const idErr = validatePaykitId(plan.id);
  if (idErr) errors.push(`Plan "${plan.id || "?"}": ${idErr}`);
  if (!plan.name.trim()) errors.push(`Plan "${plan.id}": name is required.`);
  if (!plan.group.trim()) errors.push(`Plan "${plan.id}": group is required.`);

  const hasPrice =
    plan.priceAmount !== null &&
    plan.priceAmount !== undefined &&
    !Number.isNaN(plan.priceAmount);
  if (hasPrice) {
    const amount = Number(plan.priceAmount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 999999.99) {
      errors.push(`Plan "${plan.id}": price must be between 0 and 999,999.99 USD.`);
    }
    if (plan.priceInterval !== "month" && plan.priceInterval !== "year") {
      errors.push(`Plan "${plan.id}": price interval must be month or year.`);
    }
  }

  const seen = new Set<string>();
  for (const inc of plan.includes) {
    if (seen.has(inc.featureId)) {
      errors.push(`Plan "${plan.id}": duplicate feature "${inc.featureId}".`);
      continue;
    }
    seen.add(inc.featureId);
    const feat = featuresById.get(inc.featureId);
    if (!feat) {
      errors.push(`Plan "${plan.id}": unknown feature "${inc.featureId}".`);
      continue;
    }
    if (feat.type === "boolean") {
      if (inc.limit != null || inc.reset != null) {
        errors.push(
          `Plan "${plan.id}": boolean feature "${inc.featureId}" takes no limit/reset.`,
        );
      }
    } else {
      if (!Number.isInteger(inc.limit) || (inc.limit as number) <= 0) {
        errors.push(
          `Plan "${plan.id}": metered feature "${inc.featureId}" needs a positive integer limit.`,
        );
      }
      if (!PAYKIT_RESETS.includes(inc.reset as PaykitResetInterval)) {
        errors.push(
          `Plan "${plan.id}": metered feature "${inc.featureId}" needs reset day|week|month|year.`,
        );
      }
    }
  }
  return errors;
}

export function validateDrafts(state: PaykitDraftState): string[] {
  const errors: string[] = [];
  if (!state || typeof state !== "object") return ["Invalid billing drafts."];
  // Coerce so malformed payloads fail with messages, never exceptions.
  const features = Array.isArray(state.features) ? state.features : [];
  const plans = Array.isArray(state.plans) ? state.plans : [];
  const featureIds = new Set<string>();
  const featuresById = new Map<string, PaykitFeatureDraft>();
  for (const f of features) {
    const err = validateFeature(f);
    if (err) errors.push(err);
    if (featureIds.has(f.id)) errors.push(`Duplicate feature id "${f.id}".`);
    featureIds.add(f.id);
    featuresById.set(f.id, f);
  }

  const planIds = new Set<string>();
  const defaultsPerGroup = new Map<string, number>();
  for (const p of plans) {
    if (planIds.has(p.id)) errors.push(`Duplicate plan id "${p.id}".`);
    planIds.add(p.id);
    errors.push(...validatePlan(p, featuresById));
    if (p.default) {
      const group = p.group.trim() || "base";
      defaultsPerGroup.set(group, (defaultsPerGroup.get(group) ?? 0) + 1);
    }
  }
  for (const [group, count] of defaultsPerGroup) {
    if (count > 1) {
      errors.push(`Group "${group}": only one plan may be default.`);
    }
  }
  if (plans.length === 0) errors.push("Define at least one plan.");
  return errors;
}
