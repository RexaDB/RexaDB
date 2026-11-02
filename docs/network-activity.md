# Network activity

What RexaDB sends off your device, and how to turn it off. Your database
connections go only to the hosts you configure.

## Automatic requests

These can happen without you doing anything in the moment.

| Request | Goes to | When | How to stop it |
| --- | --- | --- | --- |
| Update check | `github.com` (the updater), plus `api.github.com` for Nix installs | Desktop app launch | Turn off **Settings → Advanced → Check for Updates Automatically** |
| Error reports | The RexaDB backend | Only after you turn on **Settings → Advanced → Send Diagnostics** (off by default) | Leave it off. Errors are then only written to the local log |
| Session refresh, profile and settings sync | The RexaDB backend | Only while signed in | Use local mode (no account) |

In local mode with both switches off, none of the requests above are made.

Both switches are stored on this device and are not synced. **Reset
Everything** in the Danger Zone returns them to their defaults, which turns
automatic update checks back on.

## Requests you start

These only happen when you use the feature.

| Feature | Goes to |
| --- | --- |
| Check for Updates, and downloading an update | `github.com`, `api.github.com` |
| Sign-in, teams, workspace sharing | The RexaDB backend, or the workspace server you connect to |
| Theme marketplace | The RexaDB backend, and the VS Code theme source if you import one |
| Ask AI and SQL AI | The provider you configure, such as Anthropic, OpenAI, Google or Kilo |
| AI web search | Exa (`api.exa.ai`, `mcp.exa.ai`) |
| Supabase, Neon, PlanetScale, Cloudflare, Val Town and SpacetimeDB account features | That service's API |
| Stripe tools in Supabase PayKit | `api.stripe.com` |
| JDBC drivers | The download URL of the driver you choose |
| Built-in browser tab | The sites you open (the new tab page is `google.com`) |
| Avatars in the Supabase auth users view | `avatars.githubusercontent.com`, `lh3.googleusercontent.com` |

The app's fonts are bundled, so opening it does not contact Google Fonts.
