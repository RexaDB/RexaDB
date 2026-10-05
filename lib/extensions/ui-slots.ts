/**
 * Extension UI look customization — contribution model.
 *
 * Two layers:
 * 1. Style packs (all extensions): CSS variables + raw CSS targeting
 *    `[data-slot="…"]` so buttons, inputs, shell chrome, etc. restyle
 *    everywhere without shipping React.
 * 2. React component overrides (trusted / host-registered): replace the
 *    actual component for a named slot (`shell`, `button`, …).
 */

export const UI_SLOTS = [
  "shell",
  "button",
  "input",
  "textarea",
  "rail",
  "header",
  "statusBar",
  "sidebar",
  "tabs",
  "dialog",
  "select",
  "badge",
  "card",
  "checkbox",
  "switch",
  "tooltip",
] as const;

export type UiSlotId = (typeof UI_SLOTS)[number] | (string & {});

export interface ExtensionStylePackContribution {
  /** Unique within the extension, e.g. `pill-buttons`. */
  id: string;
  label: string;
  description?: string;
  /**
   * Slots this pack is meant for. Use `"*"` (or omit) for whole-app packs.
   * Used for filtering in the Extensions UI picker.
   */
  slots?: Array<UiSlotId | "*">;
  /** CSS custom properties applied to `:root` while the pack is active. */
  cssVariables?: Record<string, string>;
  /**
   * Raw CSS injected while active. Prefer selectors under
   * `html[data-rexadb-ui-pack="<id>"]` — the host scopes automatically if
   * the CSS does not already start with that prefix.
   */
  css?: string;
}

export interface ExtensionShellContribution {
  /** Unique within the extension, e.g. `compact-shell`. */
  id: string;
  label: string;
  description?: string;
  /**
   * Class name(s) added to `<html>` while this shell is active
   * (e.g. `rexadb-shell-compact`). Pair with a style pack's CSS.
   */
  className?: string;
  /** Auto-activate this style pack when the shell becomes active. */
  stylePackId?: string;
  /**
   * Trusted React override id. Host code registers the component via
   * `registerUiComponent("shell", Comp)` under this key, or under the
   * fully-qualified `extensionId:shellId`. Sandboxed extensions leave
   * this empty and restyle via CSS/`className` instead.
   */
  componentKey?: string;
}

export interface ExtensionUiSlotContribution {
  /** Built-in slot id (`button`, `shell`, …) or a custom string. */
  slot: UiSlotId;
  /** Prefer this style pack from the same extension when the slot is customized. */
  stylePackId?: string;
  /** Trusted React override key (see `registerUiComponent`). */
  componentKey?: string;
}

export interface ExtensionUiContribution {
  stylePacks?: ExtensionStylePackContribution[];
  shells?: ExtensionShellContribution[];
  slots?: ExtensionUiSlotContribution[];
}

export function isKnownUiSlot(slot: string): boolean {
  return (UI_SLOTS as readonly string[]).includes(slot);
}
