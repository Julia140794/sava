import Link from "next/link";
import type { Metadata } from "next";
import CalendarAdmin from "@/components/CalendarAdmin";
export const metadata: Metadata = {
  title: "Расписание мастеров — SAVA",
  robots: { index: false, follow: false },
  alternates: { canonical: null },
};
export default function Page() {
  return (
    <main className="privacy-page">
      <Link href="/">← На сайт</Link>
      <h1>Расписание мастеров</h1>
      <CalendarAdmin />
    </main>
  );
}
