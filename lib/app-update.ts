/**
 * The command a Nix user runs to pick up a new release.
 *
 * `nix flake update` without an argument updates every input, so it works
 * whatever the user named the RexaDB input in their flake.
 */
export const NIX_UPDATE_COMMAND = "nix flake update";

/** The command that updates a profile install. */
export const NIX_PROFILE_UPGRADE_COMMAND = "nix profile upgrade";

/** One way of updating a Nix install. */
export interface NixUpdateOption {
  /** What kind of install this applies to. */
  label: string;
  /** The command to copy, when there is one. */
  command: string | null;
  /** What to do around it. */
  hint: string;
}

/**
 * The ways a Nix install can be updated.
 *
 * They are not interchangeable: `nix flake update` moves the input of a
 * configuration flake, it does not touch a profile install, and it does not
 * advance a flake that pins a release tag.
 */
export const NIX_UPDATE_OPTIONS: NixUpdateOption[] = [
  {
    label: "Configuration flake, unpinned input",
    command: NIX_UPDATE_COMMAND,
    hint: "Bumps the RexaDB input in your flake.lock. Rebuild and switch your configuration afterwards.",
  },
  {
    label: "Configuration flake, pinned release tag",
    command: null,
    hint: "Change the RexaDB tag in your flake, then rebuild and switch your configuration.",
  },
  {
    label: "Profile install",
    command: NIX_PROFILE_UPGRADE_COMMAND,
    hint: "Rebuilds the installed profile. A profile pinned to a release tag keeps that tag — install the newer tag instead.",
  },
];

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
