import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
import { FeedbackWidget } from "./FeedbackWidget";
import { Analytics } from "@vercel/analytics/next";
import { PostHogProvider } from "./PostHogProvider";

const SITE_URL = "https://breakpar.xyz";
const TITLE = "Break Par — daily golf challenge";
const DESCRIPTION = "One real course a day. 18 holes, one decision each. Can you break par?";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: "Break Par",
  appleWebApp: { capable: true, title: "Break Par", statusBarStyle: "black-translucent" },
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: "Break Par",
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
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
          <div className="app">{children}<FeedbackWidget /></div>
          <Analytics />
          <PostHogProvider />
        </body>
      </html>
    </ClerkProvider>
  );
}
