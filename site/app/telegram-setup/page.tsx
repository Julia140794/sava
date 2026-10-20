import Link from "next/link";
import type { Metadata } from "next";
import TelegramSetup from "@/components/TelegramSetup";
export const metadata: Metadata = {
  title: "Настройка подтверждений — SAVA",
  robots: { index: false, follow: false },
  alternates: { canonical: null },
};
export default function Page() {
  return (
    <main className="privacy-page">
      <Link href="/">← На сайт SAVA</Link>
      <h1>Подтверждение записи в Telegram</h1>
      <TelegramSetup />
    </main>
  );
}
