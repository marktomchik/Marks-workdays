import { App, Modal, Setting } from "obsidian";
import { Day, MONTHS_GEN, PALETTE, Place, WorkData, rateOn, zl } from "./store";

/** One day: workplace, extra (tips) for this day, note. */
export class DayModal extends Modal {
  constructor(app: App, private date: string, private data: WorkData, private defaultPlace: string, private done: (r: Day | "delete") => void | Promise<void>) {
    super(app);
  }
  onOpen(): void {
    const cur = this.data.days[this.date];
    const places = this.data.places.filter((p) => !p.archived || p.id === cur?.place);
    const v: Day = { place: cur?.place || this.defaultPlace || places[0]?.id || "", ...(cur?.extra !== undefined ? { extra: cur.extra } : {}), ...(cur?.note ? { note: cur.note } : {}) };
    const [y, m, d] = this.date.split("-");
    this.setTitle(`${Number(d)} ${MONTHS_GEN[Number(m) - 1]} ${y}`);
    const { contentEl } = this;
    const info = contentEl.createDiv({ cls: "mw-muted mw-small" });
    const showInfo = () => {
      const p = this.data.places.find((x) => x.id === v.place);
      const base = rateOn(p, this.date);
      const extra = v.extra ?? p?.bonus ?? 0;
      info.setText(`Ставка ${zl(base)} + доплата ${zl(extra)} = ${zl(base + extra)}`);
    };
    new Setting(contentEl).setName("Місце").addDropdown((dd) => {
      for (const p of places) dd.addOption(p.id, p.name);
      dd.setValue(v.place).onChange((x) => { v.place = x; extraText?.setPlaceholder(placeholder()); showInfo(); });
    });
    const placeholder = () => { const p = this.data.places.find((x) => x.id === v.place); return `${p?.bonus ?? 0} (як у місця)`; };
    let extraText: { setPlaceholder(s: string): unknown } | undefined;
    new Setting(contentEl).setName("Доплата за день, zł").setDesc("Чайові тощо. Порожньо — автодоплата місця.").addText((t) => {
      extraText = t;
      t.inputEl.type = "number"; t.inputEl.inputMode = "decimal"; t.inputEl.step = "0.01";
      t.setPlaceholder(placeholder()).setValue(v.extra !== undefined ? String(v.extra) : "").onChange((x) => {
        const n = Number(x.replace(",", "."));
        if (x.trim() === "" || !isFinite(n)) delete v.extra; else v.extra = n;
        showInfo();
      });
    });
    new Setting(contentEl).setName("Нотатка").addText((t) => t.setValue(v.note ?? "").onChange((x) => { if (x.trim()) v.note = x.trim(); else delete v.note; }));
    showInfo();
    const row = new Setting(contentEl);
    if (cur) row.addButton((b) => b.setButtonText("Не працював").setWarning().onClick(async () => { this.close(); await this.done("delete"); }));
    row.addButton((b) => b.setButtonText(cur ? "Зберегти" : "Працював").setCta().onClick(async () => {
      if (!v.place) return;
      this.close(); await this.done(v);
    }));
  }
  onClose(): void { this.contentEl.empty(); }
}

export interface PlaceEdit { name: string; bonus: number; color: string; rates: Place["rates"] }

/** Workplace: name, auto extra per day, colour and the history of daily rates. */
export class PlaceModal extends Modal {
  constructor(app: App, private place: Place | null, private data: WorkData, private done: (r: PlaceEdit | "archive") => void | Promise<void>) {
    super(app);
  }
  onOpen(): void {
    const p = this.place;
    const today = new Date().toISOString().slice(0, 10);
    const v: PlaceEdit = { name: p?.name ?? "", bonus: p?.bonus ?? 0, color: p?.color ?? PALETTE[this.data.places.length % PALETTE.length], rates: [...(p?.rates ?? [])] };
    this.setTitle(p ? p.name : "Нове місце роботи");
    const { contentEl } = this;
    new Setting(contentEl).setName("Назва").addText((t) => { t.setPlaceholder("Аптека на Długiej").setValue(v.name).onChange((x) => { v.name = x; }); if (!p) window.setTimeout(() => t.inputEl.focus(), 50); });
    new Setting(contentEl).setName("Автодоплата за день, zł").setDesc("Додається до кожного дня тут (чайові). Для окремого дня можна змінити.")
      .addText((t) => { t.inputEl.type = "number"; t.inputEl.inputMode = "decimal"; t.setValue(String(v.bonus || "")).setPlaceholder("0").onChange((x) => { v.bonus = Number(x.replace(",", ".")) || 0; }); });
    new Setting(contentEl).setName("Колір").addDropdown((d) => {
      PALETTE.forEach((c, i) => d.addOption(c, `Колір ${i + 1}`));
      d.setValue(v.color).onChange((x) => { v.color = x; swatch.style.background = x; });
    });
    const swatch = contentEl.createDiv("mw-swatch"); swatch.style.background = v.color;

    contentEl.createEl("h4", { text: "Ставка за день" });
    const list = contentEl.createDiv("mw-rates");
    const draw = () => {
      list.empty();
      if (!v.rates.length) list.createDiv({ cls: "mw-muted mw-small", text: "Ставки ще немає." });
      v.rates.sort((a, b) => (a.from < b.from ? -1 : 1)).forEach((r, i) => {
        const row = list.createDiv("mw-rate-row");
        row.createSpan({ text: `з ${r.from}` });
        row.createSpan({ cls: "mw-num", text: zl(r.rate) });
        const del = row.createEl("button", { cls: "mw-link", text: "×", attr: { "aria-label": "Видалити ставку" } });
        del.onclick = () => { v.rates.splice(i, 1); draw(); };
      });
    };
    draw();
    const add = { from: v.rates.length ? today.slice(0, 8) + "01" : "2020-01-01", rate: 0 };
    new Setting(contentEl).setName(v.rates.length ? "Нова ставка з дати" : "Ставка (діє для всіх днів)").setDesc("Старі дні рахуються за старою ставкою.")
      .addText((t) => { t.inputEl.type = "date"; t.setValue(add.from).onChange((x) => { add.from = x; }); })
      .addText((t) => { t.inputEl.type = "number"; t.inputEl.inputMode = "decimal"; t.setPlaceholder("zł/день").onChange((x) => { add.rate = Number(x.replace(",", ".")) || 0; }); })
      .addButton((b) => b.setButtonText("Додати").onClick(() => {
        if (!(add.rate > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(add.from)) return;
        v.rates = v.rates.filter((r) => r.from !== add.from).concat({ ...add });
        draw();
      }));

    const row = new Setting(contentEl);
    if (p) {
      const used = Object.values(this.data.days).some((d) => d.place === p.id);
      row.addButton((b) => b.setButtonText(used ? "Сховати місце" : "Видалити").setWarning().onClick(async () => { this.close(); await this.done("archive"); }));
    }
    row.addButton((b) => b.setButtonText("Зберегти").setCta().onClick(async () => {
      if (!v.name.trim()) { b.setButtonText("Вкажіть назву"); return; }
      if (add.rate > 0 && !v.rates.some((r) => r.from === add.from)) v.rates.push({ ...add }); // typed but not «Додати»
      v.name = v.name.trim();
      this.close(); await this.done(v);
    }));
  }
  onClose(): void { this.contentEl.empty(); }
}
