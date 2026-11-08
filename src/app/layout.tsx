import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ScopePay AI — From scope to payment",
  description: "Turn client briefs into clear proposals and PayPal payments with an AI business partner.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
