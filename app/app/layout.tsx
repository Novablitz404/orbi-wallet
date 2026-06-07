import type { Metadata } from "next";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import BufferPolyfill from "../components/BufferPolyfill";

// Space Grotesk for headings/balances/display text, JetBrains Mono for
// addresses/hashes/amounts — see globals.css for how these wire into Tailwind.
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Orbi Wallet",
  description: "The first smart wallet on Stellar — no seed phrase, no gas",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[#020817]">
        <BufferPolyfill />
        {children}
      </body>
    </html>
  );
}
