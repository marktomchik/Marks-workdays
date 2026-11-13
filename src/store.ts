// Data model, calculations and the vault file. Everything lives in one JSON file in the vault
// (default "Фінанси/workdays.json"), so it syncs between devices and survives disabling the plugin.
import { App, normalizePath, TFile } from "obsidian";

export interface Rate { from: string; rate: number } // from = YYYY-MM-DD, rate in PLN per day
export interface Place {
  id: string;
  name: string;
  rates: Rate[]; // sorted by `from`
  bonus: number; // default extra per day (tips), PLN
  color?: string;
  archived?: boolean;
}
export interface Day { place: string; extra?: number; note?: string } // extra overrides place.bonus when set
export interface WorkData {
  version: 1;
  places: Place[];
  days: Record<string, Day>; // YYYY-MM-DD
  boss: Record<string, Record<string, number>>; // YYYY-MM → placeId → amount received
  approved: Record<string, boolean>; // YYYY-MM → added to the finance plan
  updatedAt?: string;
}

export const PALETTE = ["#4e79a7", "#59a14f", "#f28e2b", "#b07aa1", "#e15759", "#76b7b2", "#edc948", "#9c755f"];
export const r2 = (n: number): number => Math.round(n * 100) / 100;
const fmt = new Intl.NumberFormat("uk-UA", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
export const zl = (n: number): string => `${fmt.format(r2(n))} zł`;
export const MONTHS = ["Січень", "Лютий", "Березень", "Квітень", "Травень", "Червень", "Липень", "Серпень", "Вересень", "Жовтень", "Листопад", "Грудень"];
export const MONTHS_GEN = ["січня", "лютого", "березня", "квітня", "травня", "червня", "липня", "серпня", "вересня", "жовтня", "листопада", "грудня"];
export const MONTHS_SHORT = ["січ", "лют", "бер", "кві", "тра", "чер", "лип", "сер", "вер", "жов", "лис", "гру"];

export function emptyData(): WorkData {
  return { version: 1, places: [], days: {}, boss: {}, approved: {} };
}
export function newId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

/** Rate that applies on `date`: the latest entry with from <= date (or the earliest one). */
export function rateOn(place: Place | undefined, date: string): number {
  if (!place || !place.rates.length) return 0;
  const sorted = [...place.rates].sort((a, b) => (a.from < b.from ? -1 : 1));
  let best = sorted[0]; // days before the first rate use the first rate
  for (const r of sorted) if (r.from <= date) best = r;
  return best.rate;
}

export interface DayPay { date: string; place: Place | undefined; base: number; extra: number; total: number }
export function dayPay(d: WorkData, date: string): DayPay | null {
  const day = d.days[date];
  if (!day) return null;
  const place = d.places.find((p) => p.id === day.place);
  const base = rateOn(place, date);
  const extra = day.extra ?? place?.bonus ?? 0;
  return { date, place, base, extra, total: r2(base + extra) };
}

export interface PlaceTotal { place: Place | undefined; placeId: string; days: number; base: number; extra: number; total: number }
export interface Totals { days: number; base: number; extra: number; total: number; byPlace: PlaceTotal[] }

export function totals(d: WorkData, prefix: string): Totals {
  const by = new Map<string, PlaceTotal>();
  let days = 0, base = 0, extra = 0;
  for (const date of Object.keys(d.days)) {
    if (!date.startsWith(prefix)) continue;
    const p = dayPay(d, date)!;
    days++; base += p.base; extra += p.extra;
    const id = d.days[date].place;
    let t = by.get(id);
    if (!t) by.set(id, (t = { place: p.place, placeId: id, days: 0, base: 0, extra: 0, total: 0 }));
    t.days++; t.base += p.base; t.extra += p.extra; t.total += p.total;
  }
  const byPlace = [...by.values()].map((t) => ({ ...t, base: r2(t.base), extra: r2(t.extra), total: r2(t.total) })).sort((a, b) => b.total - a.total);
  return { days, base: r2(base), extra: r2(extra), total: r2(base + extra), byPlace };
}

/** Plan lines for mark-finance: one income line per workplace for every approved month. */
export interface PlanEntry { id: string; month: string; kind: "income"; title: string; amount: number; currency: "PLN"; status: "planned" | "confirmed"; meta?: Record<string, unknown> }
export function planEntries(d: WorkData): PlanEntry[] {
  const out: PlanEntry[] = [];
  for (const month of Object.keys(d.approved).filter((m) => d.approved[m]).sort()) {
    for (const t of totals(d, month).byPlace) {
      if (t.total <= 0) continue;
      const received = d.boss[month]?.[t.placeId];
      out.push({
        id: `${month}:${t.placeId}`,
        month,
        kind: "income",
        title: `${t.place?.name ?? "Робота"}: ${t.days} ${plural(t.days, "день", "дні", "днів")}`,
        amount: t.total,
        currency: "PLN",
        status: received !== undefined && received > 0 ? "confirmed" : "planned",
        meta: { days: t.days, base: t.base, extra: t.extra, received: received ?? null },
      });
    }
  }
  return out;
}

export function plural(n: number, one: string, few: string, many: string): string {
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
  return many;
}

/** Old HTML calendar: {"YYYY-MM-DD": true}. Returns the number of days added (existing days are kept). */
export function importLegacy(d: WorkData, json: string, placeId: string): number {
  const raw = JSON.parse(json) as Record<string, unknown>;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Очікується об'єкт {\"YYYY-MM-DD\": true}");
  let n = 0;
  for (const [k, v] of Object.entries(raw)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !v) continue;
    if (d.days[k]) continue;
    d.days[k] = { place: placeId };
    n++;
  }
  return n;
}

export function normalize(raw: unknown): WorkData {
  const d = emptyData();
  if (!raw || typeof raw !== "object") return d;
  const o = raw as Partial<WorkData>;
  d.places = (Array.isArray(o.places) ? o.places : []).filter((p) => p && p.id).map((p, i) => ({
    id: String(p.id), name: String(p.name || "Робота"), bonus: Number(p.bonus) || 0, color: p.color || PALETTE[i % PALETTE.length], archived: !!p.archived,
    rates: (Array.isArray(p.rates) ? p.rates : []).filter((r) => r && /^\d{4}-\d{2}-\d{2}$/.test(r.from)).map((r) => ({ from: r.from, rate: Number(r.rate) || 0 })).sort((a, b) => (a.from < b.from ? -1 : 1)),
  }));
  for (const [k, v] of Object.entries(o.days ?? {})) if (/^\d{4}-\d{2}-\d{2}$/.test(k) && v && (v as Day).place) d.days[k] = { place: String((v as Day).place), ...((v as Day).extra !== undefined ? { extra: Number((v as Day).extra) || 0 } : {}), ...((v as Day).note ? { note: String((v as Day).note) } : {}) };
  d.boss = typeof o.boss === "object" && o.boss ? o.boss : {};
  d.approved = typeof o.approved === "object" && o.approved ? o.approved : {};
  d.updatedAt = o.updatedAt;
  return d;
}

/** Reads and writes the data file through the vault API (so sync plugins see the changes). */
export class WorkStore {
  data: WorkData = emptyData();
  private lastWritten = "";
  constructor(private app: App, private path: () => string) {}

  async load(): Promise<void> {
    const p = normalizePath(this.path());
    try {
      if (await this.app.vault.adapter.exists(p)) this.data = normalize(JSON.parse(await this.app.vault.adapter.read(p)));
      else this.data = emptyData();
    } catch (e) {
      console.error("mark-workdays: cannot read", p, e);
      throw new Error(`Не вдалося прочитати «${p}». Файл не змінено.`);
    }
  }

  /** True when the file on disk differs from what this device wrote last (e.g. synced from the phone). */
  isForeignChange(text: string): boolean { return text !== this.lastWritten; }

  async save(): Promise<void> {
    this.data.updatedAt = new Date().toISOString();
    const text = JSON.stringify(this.data, null, 1);
    this.lastWritten = text;
    const p = normalizePath(this.path());
    const f = this.app.vault.getAbstractFileByPath(p);
    if (f instanceof TFile) await this.app.vault.modify(f, text);
    else {
      const parts = p.split("/").slice(0, -1);
      for (let i = 1; i <= parts.length; i++) {
        const dir = parts.slice(0, i).join("/");
        if (!this.app.vault.getAbstractFileByPath(dir)) await this.app.vault.createFolder(dir).catch(() => undefined);
      }
      await this.app.vault.create(p, text);
    }
  }
}
