import { setIcon } from "obsidian";
import type MarkWorkdaysPlugin from "./main";
import { MONTHS, MONTHS_SHORT, PALETTE, dayPay, newId, r2, totals, zl, Place } from "./store";
import { DayModal, PlaceModal } from "./modals";

const WEEK = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"];
const pad = (n: number) => String(n).padStart(2, "0");
export const todayKey = (): string => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const nextMonth = (m: string): string => { let [y, mo] = m.split("-").map(Number); mo++; if (mo > 12) { mo = 1; y++; } return `${y}-${pad(mo)}`; };
export const prevMonth = (m: string): string => { let [y, mo] = m.split("-").map(Number); mo--; if (mo < 1) { mo = 12; y--; } return `${y}-${pad(mo)}`; };

export interface PanelOptions {
  /** Own view: month arrows, year picker and «Сьогодні». Inside Finance the finance header drives the month. */
  canNavigate: boolean;
}

/** The whole workdays UI, rendered into any container (own view or a Finance tab). */
export class WorkdaysPanel {
  month: string;
  private editMode = false;

  constructor(private plugin: MarkWorkdaysPlugin, private el: HTMLElement, month: string, private opts: PanelOptions) {
    this.month = month;
    this.el.addClass("mw-root");
  }

  setMonth(m: string): void { if (m !== this.month) { this.month = m; this.render(); } }

  render(): void {
    const el = this.el;
    const scroll = el.closest(".mf-scroll, .mw-view-scroll") as HTMLElement | null;
    const keep = scroll?.scrollTop ?? 0;
    el.empty();
    const d = this.plugin.store.data;
    if (this.plugin.loadError) { el.createDiv({ cls: "mw-card mw-warn", text: this.plugin.loadError }); return; }
    if (this.opts.canNavigate) this.renderNav(el);
    if (!d.places.filter((p) => !p.archived).length) { this.renderOnboarding(el); return; }
    this.renderPlaces(el);
    this.renderGrid(el);
    this.renderSummary(el);
    this.renderBoss(el);
    this.renderApprove(el);
    this.renderYear(el);
    if (scroll) scroll.scrollTop = keep;
  }

  // ---------- month navigation (own view) ----------
  private renderNav(el: HTMLElement): void {
    const row = el.createDiv("mw-nav");
    const prev = row.createEl("button", { cls: "mw-round", attr: { "aria-label": "Попередній місяць" } });
    setIcon(prev, "chevron-left");
    prev.onclick = () => this.setMonth(prevMonth(this.month));
    const mid = row.createDiv("mw-nav-mid");
    const sel = mid.createEl("select", { cls: "mw-select" });
    MONTHS.forEach((n, i) => sel.createEl("option", { text: n, value: pad(i + 1) }));
    sel.value = this.month.slice(5);
    sel.onchange = () => this.setMonth(`${this.month.slice(0, 4)}-${sel.value}`);
    const yr = mid.createEl("select", { cls: "mw-select" });
    const y0 = new Date().getFullYear();
    for (let y = y0 - 5; y <= y0 + 2; y++) yr.createEl("option", { text: String(y), value: String(y) });
    yr.value = this.month.slice(0, 4);
    yr.onchange = () => this.setMonth(`${yr.value}-${this.month.slice(5)}`);
    const next = row.createEl("button", { cls: "mw-round", attr: { "aria-label": "Наступний місяць" } });
    setIcon(next, "chevron-right");
    next.onclick = () => this.setMonth(nextMonth(this.month));
    const today = el.createEl("button", { cls: "mw-chip mw-today-btn", text: "Сьогодні" });
    today.onclick = () => this.setMonth(todayKey().slice(0, 7));
  }

  // ---------- first run ----------
  private renderOnboarding(el: HTMLElement): void {
    const card = el.createDiv("mw-card");
    card.createDiv({ cls: "mw-card-title", text: "Додайте місце роботи" });
    card.createDiv({ cls: "mw-muted mw-small", text: "Наприклад, аптеку: назва, оплата за день і автоматична доплата (чайові) за кожен день." });
    const b = card.createEl("button", { cls: "mod-cta mw-wide", text: "+ Місце роботи" });
    b.onclick = () => this.editPlace(null);
  }

  // ---------- places ----------
  private renderPlaces(el: HTMLElement): void {
    const d = this.plugin.store.data;
    const row = el.createDiv("mw-chips");
    const active = this.plugin.activePlace();
    for (const p of d.places.filter((x) => !x.archived)) {
      const c = row.createEl("button", { cls: "mw-chip" + (p.id === active?.id ? " is-active" : "") });
      c.createSpan({ cls: "mw-dot" }).style.background = p.color || PALETTE[0];
      c.createSpan({ text: p.name });
      c.onclick = () => { if (p.id === active?.id) this.editPlace(p); else { this.plugin.setActivePlace(p.id); this.render(); } };
    }
    const add = row.createEl("button", { cls: "mw-chip", attr: { "aria-label": "Додати місце роботи" } });
    setIcon(add, "plus");
    add.onclick = () => this.editPlace(null);
    const edit = row.createEl("button", { cls: "mw-chip" + (this.editMode ? " is-active" : ""), attr: { "aria-label": "Режим деталей дня" } });
    setIcon(edit.createSpan(), "pencil");
    edit.createSpan({ text: "Деталі" });
    edit.onclick = () => { this.editMode = !this.editMode; this.render(); };
    el.createDiv({ cls: "mw-muted mw-small mw-hint", text: this.editMode
      ? "Торкніться дня, щоб змінити місце, доплату чи нотатку."
      : `Торкніться дня — «працював» у «${active?.name ?? "—"}». Утримуйте день (або «Деталі») — змінити доплату. Повторний тап по активному місцю — налаштування.` });
  }

  private editPlace(p: Place | null): void {
    new PlaceModal(this.plugin.app, p, this.plugin.store.data, async (res) => {
      const d = this.plugin.store.data;
      if (res === "archive" && p) { p.archived = true; }
      else if (res !== "archive") {
        if (p) Object.assign(p, res);
        else { const np = { ...res, id: newId("pl"), color: res.color || PALETTE[d.places.length % PALETTE.length] }; d.places.push(np); this.plugin.setActivePlace(np.id); }
      }
      await this.plugin.commit();
    }).open();
  }

  // ---------- calendar ----------
  private renderGrid(el: HTMLElement): void {
    const d = this.plugin.store.data;
    const card = el.createDiv("mw-card mw-cal");
    const head = card.createDiv("mw-week");
    WEEK.forEach((w, i) => head.createDiv({ cls: "mw-wd" + (i >= 5 ? " is-weekend" : ""), text: w }));
    const grid = card.createDiv("mw-grid");
    const [y, m] = this.month.split("-").map(Number);
    const first = new Date(y, m - 1, 1);
    const offset = (first.getDay() + 6) % 7;
    const count = new Date(y, m, 0).getDate();
    const today = todayKey();
    for (let i = 0; i < offset; i++) grid.createDiv("mw-day is-empty");
    for (let day = 1; day <= count; day++) {
      const key = `${this.month}-${pad(day)}`;
      const pay = dayPay(d, key);
      const wd = (offset + day - 1) % 7;
      const cell = grid.createEl("button", { cls: "mw-day" + (pay ? " is-worked" : "") + (key === today ? " is-today" : "") + (wd >= 5 ? " is-weekend" : "") });
      cell.createDiv({ cls: "mw-num", text: String(day) });
      if (pay) {
        cell.style.setProperty("--mw-c", pay.place?.color || PALETTE[0]);
        cell.createDiv({ cls: "mw-amt", text: String(Math.round(pay.total)) });
        if (pay.extra > 0) cell.createDiv({ cls: "mw-extra", text: `+${Math.round(pay.extra)}` });
        if (d.days[key].note) cell.addClass("has-note");
        cell.setAttribute("aria-label", `${day}: ${pay.place?.name ?? ""}, ${zl(pay.total)}`);
      }
      this.bindDay(cell, key);
    }
  }

  private bindDay(cell: HTMLElement, key: string): void {
    let timer = 0, long = false;
    const start = () => { long = false; timer = window.setTimeout(() => { long = true; this.openDay(key); }, 480); };
    const cancel = () => window.clearTimeout(timer);
    cell.addEventListener("touchstart", start, { passive: true });
    cell.addEventListener("touchend", cancel);
    cell.addEventListener("touchmove", cancel, { passive: true });
    cell.addEventListener("contextmenu", (e) => { e.preventDefault(); cancel(); if (!long) this.openDay(key); long = true; });
    cell.addEventListener("click", () => {
      if (long) { long = false; return; }
      if (this.editMode) { this.openDay(key); return; }
      void this.toggle(key);
    });
  }

  private async toggle(key: string): Promise<void> {
    const d = this.plugin.store.data;
    if (d.days[key]) delete d.days[key];
    else { const p = this.plugin.activePlace(); if (!p) return; d.days[key] = { place: p.id }; }
    await this.plugin.commit();
  }

  private openDay(key: string): void {
    const d = this.plugin.store.data;
    new DayModal(this.plugin.app, key, d, this.plugin.activePlace()?.id ?? "", async (res) => {
      if (res === "delete") delete d.days[key];
      else d.days[key] = res;
      await this.plugin.commit();
    }).open();
  }

  // ---------- totals ----------
  private renderSummary(el: HTMLElement): void {
    const t = totals(this.plugin.store.data, this.month);
    const card = el.createDiv("mw-card mw-hero");
    card.createDiv({ cls: "mw-muted mw-small", text: `${MONTHS[Number(this.month.slice(5)) - 1]} ${this.month.slice(0, 4)}` });
    card.createDiv({ cls: "mw-hero-value", text: zl(t.total) });
    const cells = card.createDiv("mw-cells");
    const cell = (label: string, value: string) => { const c = cells.createDiv("mw-cell"); c.createDiv({ cls: "mw-muted mw-small", text: label }); c.createDiv({ cls: "mw-num", text: value }); };
    cell("Днів", String(t.days));
    cell("Ставки", zl(t.base));
    cell("Доплати", zl(t.extra));
    if (t.byPlace.length > 1) {
      const list = card.createDiv("mw-places");
      for (const p of t.byPlace) {
        const r = list.createDiv("mw-place-row");
        r.createSpan({ cls: "mw-dot" }).style.background = p.place?.color || PALETTE[0];
        r.createSpan({ cls: "mw-place-name", text: `${p.place?.name ?? "?"} · ${p.days} дн.` });
        r.createSpan({ cls: "mw-num", text: zl(p.total) });
      }
    }
  }

  // ---------- what to ask the boss / what was paid ----------
  private renderBoss(el: HTMLElement): void {
    const d = this.plugin.store.data;
    const t = totals(d, this.month);
    if (!t.days) return;
    const card = el.createDiv("mw-card");
    card.createDiv({ cls: "mw-card-title", text: "Розрахунок з босом" });
    for (const p of t.byPlace) {
      const box = card.createDiv("mw-boss");
      const top = box.createDiv("mw-boss-top");
      top.createSpan({ cls: "mw-dot" }).style.background = p.place?.color || PALETTE[0];
      top.createSpan({ cls: "mw-place-name", text: p.place?.name ?? "?" });
      top.createSpan({ cls: "mw-muted mw-small", text: "попросити" });
      top.createSpan({ cls: "mw-num mw-ask", text: zl(p.total) });
      const row = box.createDiv("mw-boss-row");
      row.createSpan({ cls: "mw-muted mw-small", text: "Отримано від боса" });
      const input = row.createEl("input", { type: "number", cls: "mw-input", attr: { inputmode: "decimal", step: "0.01", placeholder: "0" } });
      const got = d.boss[this.month]?.[p.placeId];
      if (got !== undefined) input.value = String(got);
      const diff = row.createSpan({ cls: "mw-diff" });
      const showDiff = (v: number | undefined) => {
        diff.empty(); diff.className = "mw-diff";
        if (v === undefined) return;
        const x = r2(v - p.total);
        diff.addClass(Math.abs(x) < 0.01 ? "is-ok" : x > 0 ? "is-plus" : "is-minus");
        diff.setText(Math.abs(x) < 0.01 ? "✓ збігається" : `${x > 0 ? "+" : "−"}${zl(Math.abs(x))}`);
      };
      showDiff(got);
      input.onchange = async () => {
        const v = input.value.trim() === "" ? undefined : Number(input.value.replace(",", "."));
        const m = (d.boss[this.month] ??= {});
        if (v === undefined || !isFinite(v)) delete m[p.placeId]; else m[p.placeId] = r2(v);
        if (!Object.keys(m).length) delete d.boss[this.month];
        showDiff(v !== undefined && isFinite(v) ? v : undefined);
        await this.plugin.commit(false);
      };
    }
  }

  // ---------- approve → finance plan ----------
  private renderApprove(el: HTMLElement): void {
    const d = this.plugin.store.data;
    const t = totals(d, this.month);
    const approved = !!d.approved[this.month];
    if (!t.days && !approved) return;
    const card = el.createDiv("mw-card mw-approve" + (approved ? " is-approved" : ""));
    const api = this.plugin.financeApi();
    if (approved) {
      card.createDiv({ cls: "mw-card-title", text: "✓ Місяць затверджено" });
      card.createDiv({ cls: "mw-muted mw-small", text: api
        ? `У «Плануванні» Фінансів: очікуваний дохід ${zl(t.total)}. Зміни днів оновлюють запис одразу.`
        : "Фінанси зараз не підключені — запис з'явиться в їхньому плані, щойно вони увімкнуться." });
      const b = card.createEl("button", { cls: "mw-link", text: "Прибрати з плану" });
      b.onclick = async () => { delete d.approved[this.month]; await this.plugin.commit(true, true); };
    } else {
      const b = card.createEl("button", { cls: "mod-cta mw-wide", text: `Затвердити місяць → у план (${zl(t.total)})` });
      b.onclick = async () => { d.approved[this.month] = true; await this.plugin.commit(); };
      if (!api) card.createDiv({ cls: "mw-muted mw-small", text: "Плагін «Фінанси Марка» не знайдено: затвердження збережеться і потрапить у план, коли він з'явиться." });
    }
  }

  // ---------- year ----------
  private renderYear(el: HTMLElement): void {
    const d = this.plugin.store.data;
    const year = this.month.slice(0, 4);
    const y = totals(d, year);
    const card = el.createDiv("mw-card");
    card.createDiv({ cls: "mw-card-title", text: `${year} рік` });
    const cells = card.createDiv("mw-cells");
    const cell = (label: string, value: string) => { const c = cells.createDiv("mw-cell"); c.createDiv({ cls: "mw-muted mw-small", text: label }); c.createDiv({ cls: "mw-num", text: value }); };
    cell("Днів", String(y.days));
    cell("Доплати", zl(y.extra));
    cell("Разом", zl(y.total));
    const months = Array.from({ length: 12 }, (_, i) => `${year}-${pad(i + 1)}`).map((m) => ({ m, t: totals(d, m) }));
    const max = Math.max(1, ...months.map((x) => x.t.total));
    const list = card.createDiv("mw-year");
    for (const { m, t } of months) {
      const r = list.createDiv("mw-year-row" + (m === this.month ? " is-sel" : ""));
      r.createSpan({ cls: "mw-year-m", text: MONTHS_SHORT[Number(m.slice(5)) - 1] });
      const track = r.createDiv("mw-track");
      track.createDiv("mw-fill").style.width = `${(t.total / max) * 100}%`;
      r.createSpan({ cls: "mw-muted mw-small mw-year-d", text: t.days ? `${t.days} дн.` : "" });
      r.createSpan({ cls: "mw-num", text: t.total ? zl(t.total) : "—" });
      if (d.approved[m]) r.addClass("is-approved");
      if (this.opts.canNavigate) r.onclick = () => this.setMonth(m);
    }
  }
}
