/**
 * The command a Nix user runs to pick up a new release.
 *
 * `nix flake update` without an argument updates every input, so it works
 * whatever the user named the RexaDB input in their flake.
 */
export const NIX_UPDATE_COMMAND = "nix flake update";

/**
 * Whether the update notice is hidden.
 *
 * The dismissal is remembered per version: it stays hidden until a newer
 * release shows up, instead of coming back on every launch.
 */
export function isUpdateDismissed(
  dismissedVersion: string | null,
  latestVersion: string | null,
): boolean {
  return (
    dismissedVersion !== null &&
    latestVersion !== null &&
    dismissedVersion === latestVersion
  );
}
