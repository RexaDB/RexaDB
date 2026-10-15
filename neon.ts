import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  auth: true,
  preview: {
    buckets: {
      avatars: { access: "private" },
    },
    functions: {
      entitlement: {
        name: "entitlement",
        source: "./neon/functions/entitlement/index.ts",
      },
      updates: {
        name: "updates",
        source: "./neon/functions/updates/index.ts",
      },
      redeemgiftcode: {
        name: "redeemgiftcode",
        source: "./neon/functions/redeemgiftcode/index.ts",
      },
      createportalsession: {
        name: "createportalsession",
        source: "./neon/functions/createportalsession/index.ts",
      },
      polarsponsorcheckout: {
        name: "polarsponsorcheckout",
        source: "./neon/functions/polarsponsorcheckout/index.ts",
      },
      subscribe: {
        name: "subscribe",
        source: "./neon/functions/subscribe/index.ts",
      },
      stripewebhook: {
        name: "stripewebhook",
        source: "./neon/functions/stripewebhook/index.ts",
      },
      planetscaleoauthcb: {
        name: "planetscaleoauthcb",
        source: "./neon/functions/planetscaleoauthcb/index.ts",
      },
      planetscaleoauthref: {
        name: "planetscaleoauthref",
        source: "./neon/functions/planetscaleoauthref/index.ts",
      },
      enforcesessionlimit: {
        name: "enforcesessionlimit",
        source: "./neon/functions/enforcesessionlimit/index.ts",
      },
    },
  },
});
