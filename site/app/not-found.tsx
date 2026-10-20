import Link from "next/link";
export default function NotFound() {
  return (
    <main className="not-found">
      <span>SAVA est.2026</span>
      <h1>404</h1>
      <p>Здесь пока тихо. Вернёмся на главную?</p>
      <Link className="button button-cream" href="/">
        На главную <span aria-hidden="true">↗</span>
      </Link>
    </main>
  );
}
