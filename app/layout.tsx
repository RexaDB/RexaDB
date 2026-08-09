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
        {/* Apply stored light/dark preference before paint to avoid splash/flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("theme");var d=window.matchMedia("(prefers-color-scheme: dark)").matches;var r=t==="light"||t==="dark"?t:(d?"dark":"light");var e=document.documentElement;e.classList.remove("light","dark");e.classList.add(r);e.style.colorScheme=r;}catch(e){}})();`,
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
