import type { Metadata } from "next";
import "@fontsource/manrope/cyrillic-400.css";
import "@fontsource/manrope/cyrillic-500.css";
import "@fontsource/manrope/cyrillic-600.css";
import "@fontsource/manrope/latin-400.css";
import "@fontsource/manrope/latin-500.css";
import "@fontsource/manrope/latin-600.css";
import "./globals.css";
import { siteUrl } from "@/lib/studio";
const origin = siteUrl();
export const metadata: Metadata = {
  ...(origin ? { metadataBase: new URL(origin) } : {}),
  title: "SAVA est.2026 — массаж лица, маникюр и педикюр в Минске",
  description:
    "SAVA est.2026 — бьюти-студия в Минске. Косметический массаж лица, маникюр и педикюр. Выберите услугу и оставьте заявку на запись.",
  ...(origin ? { alternates: { canonical: "/" } } : {}),
  robots: { index: !!origin, follow: true },
  openGraph: {
    title: "SAVA est.2026 — время для себя",
    description: "Массаж лица, маникюр и педикюр в Минске",
    locale: "ru_BY",
    type: "website",
    ...(origin
      ? {
          url: origin,
          images: [{ url: "/opengraph-image", width: 1200, height: 630 }],
        }
      : {}),
  },
  twitter: {
    card: "summary_large_image",
    title: "SAVA est.2026",
    description: "Бьюти-студия в Минске",
  },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
