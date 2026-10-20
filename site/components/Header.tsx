"use client";
import { Arrow } from "@/components/Icons";

import { useState } from "react";
export default function Header() {
  const [open, setOpen] = useState(false);
  return (
    <header className="header">
      <a className="brand" href="#top" aria-label="SAVA — на главную">
        SAVA<span>est.2026</span>
      </a>
      <nav
        className={open ? "nav is-open" : "nav"}
        aria-label="Главная навигация"
      >
        <a href="#services" onClick={() => setOpen(false)}>
          Услуги
        </a>
        <a href="#face" onClick={() => setOpen(false)}>
          Массаж лица
        </a>
        <a href="#studio" onClick={() => setOpen(false)}>
          О студии
        </a>
        <a href="#questions" onClick={() => setOpen(false)}>
          Вопросы
        </a>
      </nav>
      <a href="#booking" className="header-book" onClick={() => setOpen(false)}>
        Записаться{" "}
        <span aria-hidden="true">
          <Arrow />
        </span>
      </a>
      <button
        type="button"
        className="menu-toggle"
        aria-expanded={open}
        aria-controls="mobile-nav"
        aria-label={open ? "Закрыть меню" : "Открыть меню"}
        onClick={() => setOpen(!open)}
      >
        {open ? "Закрыть" : "Меню"}
        <span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      <nav
        id="mobile-nav"
        className={open ? "mobile-nav is-open" : "mobile-nav"}
        aria-label="Мобильная навигация"
        hidden={!open}
      >
        {[
          ["#services", "Услуги"],
          ["#face", "Массаж лица"],
          ["#studio", "О студии"],
          ["#questions", "Вопросы"],
          ["#booking", "Записаться"],
        ].map(([href, title]) => (
          <a key={href} href={href} onClick={() => setOpen(false)}>
            {title}
          </a>
        ))}
      </nav>
    </header>
  );
}
