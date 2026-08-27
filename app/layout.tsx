import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { Outfit, Tajawal } from "next/font/google";
import "./globals.css";

export const metadata: Metadata = {
  description: "The Modern Postgres Database Desktop App",
};

import { ThemeProvider } from "@/components/providers/theme-provider";
import { IconThemeProvider } from "@/components/providers/icon-theme-provider";
import { ZoomWrapper } from "@/components/zoom-wrapper";
import { Toaster } from "sonner";
import { ConfirmProvider } from "@/hooks/use-confirm";
import { UpdateNotificationProvider } from "@/components/providers/update-notification-provider";
import { ClientShim } from "@/components/client-shim";
import { SettingsMigrationGate } from "@/components/gates/settings-migration-gate";
import { SidecarGate } from "@/components/gates/sidecar-gate";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
});

const tajawalArabic = Tajawal({
  subsets: ["arabic"],
  variable: "--font-arabic",
  weight: ["200", "300", "400", "500", "700", "800", "900"],
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
            <SettingsMigrationGate />
            <ZoomWrapper>
              <SidecarGate>
                <ConfirmProvider>
                  <UpdateNotificationProvider>
                    {children}
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
                  </UpdateNotificationProvider>
                </ConfirmProvider>
              </SidecarGate>
            </ZoomWrapper>
          </ThemeProvider>
        </IconThemeProvider>
      </body>
    </html>
  );
}
