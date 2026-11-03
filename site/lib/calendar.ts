export const staff = [
  { id: "yulia", name: "Юлия" },
  { id: "olga", name: "Ольга" },
] as const;
export const calendarServices = [
  {
    id: "face-60",
    group: "face",
    name: "Массаж лица ручной",
    duration: 60,
    staff: ["yulia"],
  },
  {
    id: "face-90",
    group: "face",
    name: "Массаж лица ручной",
    duration: 90,
    staff: ["yulia"],
  },
  {
    id: "body-60",
    group: "body",
    name: "Массаж тела расслабляющий",
    duration: 60,
    staff: ["yulia"],
  },
  {
    id: "body-90",
    group: "body",
    name: "Массаж тела расслабляющий",
    duration: 90,
    staff: ["yulia"],
  },
  {
    id: "shape-60",
    group: "shape",
    name: "Коррекция фигуры ручная",
    duration: 60,
    staff: ["yulia"],
  },
  {
    id: "shape-90",
    group: "shape",
    name: "Коррекция фигуры ручная",
    duration: 90,
    staff: ["yulia"],
  },
  {
    id: "manicure-bare",
    group: "manicure-bare",
    name: "Маникюр без покрытия",
    duration: 60,
    staff: ["yulia", "olga"],
  },
  {
    id: "manicure-polish",
    group: "manicure-polish",
    name: "Маникюр с долговременным покрытием",
    duration: 120,
    staff: ["yulia", "olga"],
  },
  {
    id: "pedicure-bare",
    group: "pedicure-bare",
    name: "Педикюр гигиенический без покрытия",
    duration: 60,
    staff: ["yulia", "olga"],
  },
  {
    id: "pedicure-polish",
    group: "pedicure-polish",
    name: "Педикюр с обработкой и покрытием",
    duration: 90,
    staff: ["yulia"],
  },
  {
    id: "seas",
    group: "seas",
    name: "Занятие SEAS для детей",
    duration: 45,
    staff: ["yulia"],
  },
] as const;
export type CalendarService = (typeof calendarServices)[number];
export function calendarEnabled() {
  return process.env.CALENDAR_ENABLED?.trim() === "true";
}
export function minskDate(now = Date.now()) {
  return new Date(now + 3 * 3600000).toISOString().slice(0, 10);
}
export function maxCalendarDate(now = Date.now()) {
  return minskDate(now + 60 * 86400000);
}
export function validDate(date: string, now = Date.now()) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    date >= minskDate(now) &&
    date <= maxCalendarDate(now) &&
    !Number.isNaN(Date.parse(`${date}T00:00:00+03:00`)) &&
    new Date(Date.parse(`${date}T00:00:00+03:00`) + 3 * 3600000)
      .toISOString()
      .slice(0, 10) === date
  );
}
export function timeLabel(iso: string) {
  return new Intl.DateTimeFormat("ru-BY", {
    timeZone: "Europe/Minsk",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}
export function calendarInput(
  service: string,
  master: string,
  start: string,
  now = Date.now(),
) {
  const selected = calendarServices.find((s) => s.id === service);
  if (!selected || !selected.staff.some((s) => s === master)) return null;
  const t = Date.parse(start);
  if (
    !Number.isFinite(t) ||
    !start.endsWith("Z") ||
    new Date(t).toISOString() !== start
  )
    return null;
  const local = new Date(t + 3 * 3600000),
    end = new Date(t + 3 * 3600000 + (selected.duration + 15) * 60000);
  if (
    t < now + 3600000 ||
    !validDate(local.toISOString().slice(0, 10), now) ||
    local.getUTCDay() === 0 ||
    local.getUTCHours() < 9 ||
    local.getUTCMinutes() % 15 !== 0 ||
    local.getUTCSeconds() !== 0 ||
    local.getUTCMilliseconds() !== 0 ||
    end.toISOString().slice(0, 10) !== local.toISOString().slice(0, 10) ||
    end.getUTCHours() > 22 ||
    (end.getUTCHours() === 22 && end.getUTCMinutes() > 0)
  )
    return null;
  return selected;
}
export function calendarError(code: string) {
  return code === "23P01"
    ? "Это время уже занято. Выберите другое."
    : "Календарь временно недоступен. Попробуйте позже или позвоните в студию.";
}
