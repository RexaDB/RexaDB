import type { CSSProperties } from "react";
import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "@glideapps/glide-data-grid/dist/index.css";

export const metadata: Metadata = {
  description: "The Modern Postgres Database Desktop App",
};

import { ThemeProvider } from "@/components/providers/theme-provider";
import { IconThemeProvider } from "@/components/providers/icon-theme-provider";
import { ZoomWrapper } from "@/components/zoom-wrapper";
import { Toaster } from "sonner";
import { ConfirmProvider } from "@/hooks/use-confirm";
import { UpdateNotificationProvider } from "@/components/providers/update-notification-provider";
import { AppUpdateProvider } from "@/components/providers/app-update-context";
import { SettingsSyncProvider } from "@/components/providers/settings-sync-provider";
import { ClientShim } from "@/components/client-shim";
import { DesktopOpenHandler } from "@/components/desktop-open-handler";
import { SettingsMigrationGate } from "@/components/gates/settings-migration-gate";
import { ExtensionProvider } from "@/lib/extensions/react";
import { CredentialVaultPrompt } from "@/components/providers/credential-vault-prompt";

// Self-hosted (was next/font/google): identical files, vendored under
// app/fonts so production builds never touch fonts.googleapis.com.
// This also keeps sandboxed/offline builds (e.g. Nix) hermetic.
const outfit = localFont({
  src: "./fonts/Outfit-latin.woff2",
  variable: "--font-outfit",
  weight: "100 900",
  display: "swap",
});

const tajawalArabic = localFont({
  src: [
    { path: "./fonts/Tajawal-arabic-200.woff2", weight: "200" },
    { path: "./fonts/Tajawal-arabic-300.woff2", weight: "300" },
    { path: "./fonts/Tajawal-arabic-400.woff2", weight: "400" },
    { path: "./fonts/Tajawal-arabic-500.woff2", weight: "500" },
    { path: "./fonts/Tajawal-arabic-700.woff2", weight: "700" },
    { path: "./fonts/Tajawal-arabic-800.woff2", weight: "800" },
    { path: "./fonts/Tajawal-arabic-900.woff2", weight: "900" },
  ],
  variable: "--font-arabic",
  display: "swap",
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply stored light/dark + custom app theme colors before paint, to
            avoid a splash/flash of the default theme. The theme vars cache is
            kept warm by hooks/use-global-app-theme.ts. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var el=document.documentElement;var t=localStorage.getItem("theme");var d=window.matchMedia("(prefers-color-scheme: dark)").matches;var r=t==="light"||t==="dark"?t:(d?"dark":"light");var av=null;try{var raw=localStorage.getItem("rexa-db-app-theme-vars");if(raw)av=JSON.parse(raw);}catch(e2){av=null;}if(av&&av.colors&&(av.base==="light"||av.base==="dark")){r=av.base;}el.classList.remove("light","dark");el.classList.add(r);el.style.colorScheme=r;if(av&&av.colors){for(var k in av.colors){if(Object.prototype.hasOwnProperty.call(av.colors,k)){el.style.setProperty(k,av.colors[k]);}}if(av.id)el.dataset.appTheme=av.id;}}catch(e){}})();`,
          }}
        />
      </head>
      <body className={`${outfit.variable} ${tajawalArabic.variable} antialiased`}>
        <IconThemeProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <ClientShim />
            <DesktopOpenHandler />
            <CredentialVaultPrompt />
            <SettingsMigrationGate />
            <ZoomWrapper>
              <ConfirmProvider>
                  <AppUpdateProvider>
                    <UpdateNotificationProvider>
                    <SettingsSyncProvider>
                      <ExtensionProvider>
                      {children}
                      </ExtensionProvider>
                      <Toaster
                        position="bottom-right"
                        theme="system"
                        toastOptions={{
                          unstyled: false,
                          classNames: {
                            toast: "rexa-toast",
                            success: "rexa-toast-success",
                            error: "rexa-toast-error",
                            warning: "rexa-toast-warning",
                            info: "rexa-toast-info",
                          },
                        }}
                      />
                    </SettingsSyncProvider>
                  </UpdateNotificationProvider>
                  </AppUpdateProvider>
              </ConfirmProvider>
            </ZoomWrapper>
          </ThemeProvider>
        </IconThemeProvider>
        {/* Mount point for Glide Data Grid's overlay cell editors — must be
            the last child of <body>, see @glideapps/glide-data-grid docs. */}
        <div id="portal" />
      </body>
    </html>
  );
}
