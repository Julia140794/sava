import { Arrow, Flower } from "@/components/Icons";
import Image from "next/image";
import Header from "@/components/Header";
import Booking from "@/components/Booking";
import ServiceLink from "@/components/ServiceLink";
import { contact, faq, intakeReady, services, siteUrl } from "@/lib/studio";
export default function Home() {
  const origin = siteUrl();
  const businessId = origin ? `${origin}/#studio` : "#studio";
  const structured = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BeautySalon",
        "@id": businessId,
        name: "SAVA est.2026",
        ...(origin ? { url: origin } : {}),
        address: {
          "@type": "PostalAddress",
          addressLocality: contact.city,
          streetAddress: contact.street,
          addressCountry: "BY",
        },
        areaServed: "Минск",
        telephone: "+375445752492",
      },
      ...services.map((s) => ({
        "@type": "Service",
        name: s.name,
        provider: { "@id": businessId },
        areaServed: "Минск",
      })),
      {
        "@type": "FAQPage",
        mainEntity: faq.map(([q, a]) => ({
          "@type": "Question",
          name: q,
          acceptedAnswer: { "@type": "Answer", text: a },
        })),
      },
    ],
  };
  return (
    <>
      <a className="skip-link" href="#main">
        Перейти к содержимому
      </a>
      <Header />
      <main id="main">
        <section className="hero" id="top">
          <div className="hero-topline">
            <span>Бьюти-студия в Минске</span>
            <span>Лицо. Руки. Настроение.</span>
          </div>
          <div className="hero-grid">
            <div className="hero-copy">
              <div className="hero-mark" aria-hidden="true">
                SAVA<span>est.2026</span>
              </div>
              <h1>
                Массаж лица,
                <br />
                маникюр и педикюр
                <br />в Минске
              </h1>
              <p>Время, которое принадлежит вам</p>
              <a href="#booking" className="button button-cream">
                Выбрать свой уход{" "}
                <span aria-hidden="true">
                  <Arrow />
                </span>
              </a>
              <div className="hero-caption">
                <span className="spark" aria-hidden="true">
                  <Flower />
                </span>
                <span>
                  Чуть тише город.
                  <br />
                  Чуть больше себя.
                </span>
              </div>
            </div>
            <figure className="hero-visual">
              <Image
                src="/images/facial-massage.webp"
                alt="Атмосферная иллюстрация косметического массажа лица"
                fill
                priority
                sizes="(max-width: 700px) 100vw, 55vw"
              />
              <figcaption>
                <span>Прикосновение к себе</span>
                <span aria-hidden="true">01 / SAVA</span>
              </figcaption>
              <div className="image-stamp" aria-hidden="true">
                a moment
                <br />
                for yourself
              </div>
            </figure>
          </div>
          <div className="hero-bottom">
            <a href="#services">
              Познакомиться с SAVA <span aria-hidden="true">↓</span>
            </a>
            <span>Косметический уход с вниманием к себе</span>
          </div>
        </section>
        <section id="services" className="services section">
          <div className="section-intro">
            <span className="small-label">Уход в SAVA</span>
            <p>
              Для лица, рук и стоп.
              <br />
              Для вашего настроения.
            </p>
          </div>
          <div className="section-heading">
            <h2>
              Три способа
              <br />
              выбрать себя
            </h2>
            <p>
              Начните с того, чего хочется сегодня.
              <br />
              Мы оставили выбор простым.
            </p>
          </div>
          <div className="service-list">
            {services.map((s, i) => (
              <article key={s.id} className="service-row">
                <span className="service-number">0{i + 1}</span>
                <div className="service-name">
                  <span>{s.label}</span>
                  <h3>{s.name}</h3>
                </div>
                <p>{s.text}</p>
                <ServiceLink id={s.id} className="round-link">
                  <span className="sr-only">Записаться: {s.name}</span>
                  <span aria-hidden="true">
                    <Arrow />
                  </span>
                </ServiceLink>
              </article>
            ))}
          </div>
          <p className="section-note">
            Стоимость и длительность уточняются при согласовании записи
          </p>
        </section>
        <section id="face" className="face-section">
          <figure className="face-photo">
            <Image
              src="/images/facial-massage.webp"
              alt="Иллюстрация бережных прикосновений во время массажа лица"
              fill
              sizes="(max-width: 700px) 100vw, 50vw"
            />
            <figcaption>Атмосферная иллюстрация</figcaption>
          </figure>
          <div className="face-copy">
            <span className="small-label">Косметический массаж лица</span>
            <h2>
              Выдохните.
              <br />
              Это ваше
              <br />
              время.
            </h2>
            <p>
              Мягкий свет. Закрытые глаза. Внимание к ощущениям. Косметический
              массаж лица — возможность сделать паузу и посвятить время уходу за
              собой.
            </p>
            <p className="muted">
              Перед визитом обсудим ваши пожелания и ограничения. Детали
              процедуры и стоимость уточняются при записи.
            </p>
            <ServiceLink id="face" className="button button-wine">
              Хочу на массаж лица{" "}
              <span aria-hidden="true">
                <Arrow />
              </span>
            </ServiceLink>
            <span className="medical-note">
              Косметический уход, не медицинская услуга
            </span>
          </div>
        </section>
        <section className="nails-section section">
          <div className="nails-copy">
            <span className="small-label">Маникюр и педикюр</span>
            <h2>
              Красота
              <br />в деталях.
              <br />
              <span className="outline-text">Ваших.</span>
            </h2>
            <p>
              Любимый оттенок. Та самая форма. Уход за руками и стопами, для
              которого хочется найти время.
            </p>
            <div className="nails-actions">
              <ServiceLink id="manicure" className="text-link">
                Выбрать маникюр{" "}
                <span aria-hidden="true">
                  <Arrow />
                </span>
              </ServiceLink>
              <ServiceLink id="pedicure" className="text-link">
                Выбрать педикюр{" "}
                <span aria-hidden="true">
                  <Arrow />
                </span>
              </ServiceLink>
            </div>
          </div>
          <div className="nails-art">
            <figure className="nails-photo">
              <Image
                src="/images/burgundy-nails.webp"
                alt="Атмосферная иллюстрация маникюра в бордовом оттенке, не пример работ студии"
                fill
                sizes="(max-width: 700px) 100vw, 45vw"
              />
              <figcaption>Вдохновение в цвете SAVA</figcaption>
            </figure>
            <div className="color-note">
              <span className="color-dot" />
              <span>
                Наше настроение —<br />
                насыщенный бордовый
              </span>
            </div>
          </div>
        </section>
        <section className="studio-section section" id="studio">
          <span className="small-label">SAVA est.2026 / Минск</span>
          <div className="studio-statement">
            <span className="large-spark" aria-hidden="true">
              <Flower />
            </span>
            <h2>
              Не особый повод.
              <br />
              Просто вы.
            </h2>
          </div>
          <div className="studio-bottom">
            <span>
              Место для вашего
              <br />
              маленького ритуала
            </span>
            <p>
              SAVA — бьюти-студия в Минске. Массаж лица, маникюр и педикюр — три
              направления ухода в одном пространстве. Выбирайте то, что хочется
              подарить себе сегодня.
            </p>
          </div>
        </section>
        <section className="faq-section section" id="questions">
          <div>
            <span className="small-label">До встречи в студии</span>
            <h2>
              Пара слов
              <br />
              перед визитом
            </h2>
          </div>
          <div className="faq-list">
            {faq.map(([q, a]) => (
              <details key={q}>
                <summary>
                  {q}
                  <span aria-hidden="true">+</span>
                </summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>
        <section className="booking-section section" id="booking">
          <div className="booking-copy">
            <span className="small-label">Запись в SAVA</span>
            <h2>
              Оставьте
              <br />
              время
              <br />
              для себя.
            </h2>
            <p>
              Выберите услугу и расскажите о пожеланиях. Запись подтверждается
              после согласования со студией.
            </p>
            <address className="studio-contact">
              <div className="location-line">
                <span className="location-dot" aria-hidden="true" />
                <span>
                  {contact.city}, {contact.street}
                  <br />
                  <span className="metro-label">{contact.metro}</span>
                </span>
              </div>
              <a className="contact-phone" href={contact.phoneHref}>
                {contact.phone}
              </a>
              <span className="contact-hint">
                Позвоните, чтобы уточнить детали и записаться
              </span>
            </address>
            <p className="booking-caption">
              Массаж лица
              <br />
              Маникюр
              <br />
              Педикюр
            </p>
          </div>
          <Booking ready={intakeReady()} />
        </section>
      </main>
      <footer className="footer">
        <div className="footer-top">
          <a href="#top" className="brand">
            SAVA<span>est.2026</span>
          </a>
          <p>Больше внимания себе</p>
          <a href="#top" className="back-top">
            Наверх <span aria-hidden="true">↑</span>
          </a>
        </div>
        <div className="footer-bottom">
          <span>© 2026 SAVA est.2026</span>
          <a href="/privacy">Конфиденциальность</a>
          <a href={contact.phoneHref}>{contact.phone}</a>
          <span>
            {contact.city}, {contact.street}
          </span>
        </div>
      </footer>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structured).replace(/</g, "\\u003c"),
        }}
      />
    </>
  );
}
