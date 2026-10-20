"use client";
export default function ServiceLink({
  id,
  children,
  className,
}: {
  id: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <a
      href="#booking"
      className={className}
      onClick={() =>
        window.dispatchEvent(new CustomEvent("sava:service", { detail: id }))
      }
    >
      {children}
    </a>
  );
}
