import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  auth: true,
  preview: {
    buckets: {
      avatars: { access: "private" },
    },
    // NOTE 2026-10-15: edge-function cutover deferred. The 10 ported
    // functions live in ./neon/functions/* (reviewed, smoke-tested) but are
    // intentionally NOT deployed yet — Supabase functions + Supabase Auth
    // remain authoritative until the client cutover lands. To deploy:
    //   neon functions deploy <slug> --src neon/functions/<slug> --env KEY=VALUE
    // then re-add the functions block below.
  },
});
