import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Providers from "./providers";
import { Sidebar } from "@/src/components/sidebar";
import ChatDock from "@/src/components/chat-dock";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "FinMonitor",
  description: "Dashboard financeiro Open Finance",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`dark ${inter.variable}`}>
      <body className="min-h-screen bg-bg text-text">
        <Providers>
          <div className="flex min-h-screen">
            <Sidebar />
            <main className="min-w-0 flex-1 p-4 pt-16 md:ml-56 md:p-8 md:pt-8">
              {children}
            </main>
          </div>
          <ChatDock />
        </Providers>
      </body>
    </html>
  );
}
