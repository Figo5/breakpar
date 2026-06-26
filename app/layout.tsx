import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

export const metadata: Metadata = {
  title: "Break Par — daily golf challenge",
  description: "One real course a day. 18 holes, one decision each. Can you break par?",
  applicationName: "Break Par",
  appleWebApp: { capable: true, title: "Break Par", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#143728",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body>
          <div className="app">{children}</div>
        </body>
      </html>
    </ClerkProvider>
  );
}
