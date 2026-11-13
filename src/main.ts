import { App, ItemView, Notice, Plugin, PluginSettingTab, Setting, TAbstractFile, TFile, WorkspaceLeaf, debounce, normalizePath } from "obsidian";
import { WorkStore, importLegacy, planEntries, newId, PALETTE } from "./store";
import { WorkdaysPanel, todayKey } from "./ui";

const VIEW_TYPE = "mark-workdays-view";
const SOURCE_ID = "mark-workdays";

interface Settings { dataPath: string; activePlace: string }
const DEFAULTS: Settings = { dataPath: "Фінанси/workdays.json", activePlace: "" };

/** Subset of the mark-finance Extensions API (EXTENSIONS.md, version 1). */
interface FinanceApi {
  version: number;
  registerTab(tab: { id: string; title: string; icon: string; order?: number; render(el: HTMLElement, ctx: { month: string; onMonthChange(cb: (m: string) => void): unknown }): void | (() => void) }): void;
  unregisterTab(id: string): void;
  setPlanEntries(sourceId: string, entries: unknown[]): Promise<void>;
  getPlanEntries(sourceId: string): unknown[];
}

export default class MarkWorkdaysPlugin extends Plugin {
  settings!: Settings;
  store!: WorkStore;
  loadError = "";
  /** Set after the data file has been read once; nothing is published before that. */
  private loaded = false;
  private panels = new Set<WorkdaysPanel>();
  private api: FinanceApi | null = null;

  async onload(): Promise<void> {
    this.settings = Object.assign({}, DEFAULTS, await this.loadData());
    this.store = new WorkStore(this.app, () => this.settings.dataPath);
    this.registerView(VIEW_TYPE, (leaf) => new WorkdaysView(leaf, this));
    this.addRibbonIcon("calendar-check", "Робочі дні", () => void this.openView());
    this.addCommand({ id: "open", name: "Відкрити робочі дні", callback: () => void this.openView() });
    this.addCommand({ id: "mark-today", name: "Відмітити сьогодні як робочий день", callback: () => void this.markToday() });
    this.addSettingTab(new WorkdaysSettingTab(this.app, this));

    // Data synced from another device → reload and redraw.
    const reload = debounce(async () => {
      const f = this.app.vault.getAbstractFileByPath(normalizePath(this.settings.dataPath));
      if (!(f instanceof TFile) || !this.store.isForeignChange(await this.app.vault.read(f))) return;
      await this.reload();
      await this.publish();
    }, 1200, true);
    const watch = (f: TAbstractFile) => { if (f.path === normalizePath(this.settings.dataPath)) reload(); };
    this.registerEvent(this.app.vault.on("modify", watch));
    this.registerEvent(this.app.vault.on("create", watch));

    // mark-finance: attach whenever it (re)loads; also if it was already loaded.
    this.registerEvent((this.app.workspace as unknown as { on(n: string, cb: (api: FinanceApi) => void): ReturnType<Plugin["app"]["workspace"]["on"]> }).on("mark-finance:ready", (api) => void this.attach(api)));
    this.app.workspace.onLayoutReady(async () => {
      await this.reload();
      const api = this.findFinance();
      if (api) await this.attach(api);
    });
  }

  onunload(): void {
    // Only the tab goes away; plan lines stay in Finance (history is kept).
    try { this.findFinance()?.unregisterTab(SOURCE_ID); } catch { /* finance already gone */ }
    this.panels.clear();
  }

  private findFinance(): FinanceApi | null {
    const api = (this.app as unknown as { plugins?: { plugins?: Record<string, { api?: FinanceApi }> } }).plugins?.plugins?.["mark-finance"]?.api;
    return api && api.version === 1 ? api : null;
  }
  financeApi(): FinanceApi | null { return this.api && this.findFinance() === this.api ? this.api : this.findFinance(); }

  private async attach(api: FinanceApi): Promise<void> {
    if (!api || api.version !== 1) return;
    this.api = api;
    api.registerTab({
      id: SOURCE_ID, title: "Робочі дні", icon: "calendar-check", order: 10,
      render: (el, ctx) => {
        const panel = new WorkdaysPanel(this, el, ctx.month, { canNavigate: false });
        this.panels.add(panel);
        panel.render();
        ctx.onMonthChange((m) => panel.setMonth(m));
        return () => { this.panels.delete(panel); };
      },
    });
    await this.publish();
  }

  async reload(): Promise<void> {
    try { await this.store.load(); this.loadError = ""; this.loaded = true; }
    catch (e) { this.loadError = e instanceof Error ? e.message : String(e); }
    this.redraw();
  }

  redraw(): void { for (const p of this.panels) p.render(); }
  addPanel(p: WorkdaysPanel): void { this.panels.add(p); }
  removePanel(p: WorkdaysPanel): void { this.panels.delete(p); }

  activePlace() {
    const live = this.store.data.places.filter((p) => !p.archived);
    return live.find((p) => p.id === this.settings.activePlace) ?? live[0];
  }
  setActivePlace(id: string): void { this.settings.activePlace = id; void this.saveData(this.settings); }

  /** Save the data file, redraw every panel and update Finance's plan. */
  async commit(redraw = true, allowEmptyPlan = false): Promise<void> {
    if (this.loadError || !this.loaded) { new Notice(this.loadError || "Дані ще завантажуються, спробуйте за мить."); return; }
    await this.store.save();
    if (redraw) this.redraw();
    await this.publish(allowEmptyPlan);
  }

  /**
   * Approved months → mark-finance plan. Only writes when the lines actually changed (no sync churn).
   * Never replaces existing lines with an empty list unless the user removed the last approval
   * (protects the history when the data file has not synced yet or failed to load).
   */
  async publish(allowEmpty = false): Promise<void> {
    const api = this.financeApi();
    if (!api || !this.loaded || this.loadError) return;
    const next = planEntries(this.store.data);
    try {
      const cur = api.getPlanEntries(SOURCE_ID);
      if (!next.length && cur.length && !allowEmpty) return;
      if (JSON.stringify(cur) !== JSON.stringify(next)) await api.setPlanEntries(SOURCE_ID, next);
    } catch (e) {
      console.error("mark-workdays: cannot update the finance plan", e);
    }
  }

  async markToday(): Promise<void> {
    const p = this.activePlace();
    if (!p) { new Notice("Спершу додайте місце роботи."); return; }
    const k = todayKey();
    if (this.store.data.days[k]) { new Notice("Сьогодні вже відмічено."); return; }
    this.store.data.days[k] = { place: p.id };
    await this.commit();
    new Notice(`Сьогодні відмічено: ${p.name}`);
  }

  async openView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    const leaf = existing ?? this.app.workspace.getLeaf("tab");
    if (!existing) await leaf.setViewState({ type: VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }
}

/** Standalone view (works without mark-finance). */
class WorkdaysView extends ItemView {
  private panel: WorkdaysPanel | null = null;
  constructor(leaf: WorkspaceLeaf, private plugin: MarkWorkdaysPlugin) { super(leaf); }
  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return "Робочі дні"; }
  getIcon(): string { return "calendar-check"; }
  async onOpen(): Promise<void> {
    this.contentEl.addClass("mw-view");
    const scroll = this.contentEl.createDiv("mw-view-scroll");
    this.panel = new WorkdaysPanel(this.plugin, scroll.createDiv(), todayKey().slice(0, 7), { canNavigate: true });
    this.plugin.addPanel(this.panel);
    this.panel.render();
  }
  async onClose(): Promise<void> { if (this.panel) this.plugin.removePanel(this.panel); }
}

class WorkdaysSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: MarkWorkdaysPlugin) { super(app, plugin); }
  display(): void {
    const { containerEl } = this;
    const s = this.plugin.settings;
    containerEl.empty();
    new Setting(containerEl).setName("Файл даних").setDesc("Звичайний файл у сховищі: синхронізується між пристроями і лишається, навіть якщо плагін вимкнути.")
      .addText((t) => t.setValue(s.dataPath).onChange(async (v) => { s.dataPath = v.trim() || DEFAULTS.dataPath; await this.plugin.saveData(s); await this.plugin.reload(); }));

    new Setting(containerEl).setName("Імпорт зі старого календаря").setHeading();
    const help = containerEl.createDiv({ cls: "setting-item-description mw-help" });
    help.createDiv({ text: "1) Відкрийте старий kalendarz-finanse.html у тому ж браузері, натисніть F12 → Console і виконайте:" });
    help.createEl("code", { text: "copy(localStorage.getItem('kalendarz_finanse_data'))" });
    help.createDiv({ text: "2) Вставте скопійоване нижче, оберіть місце і натисніть «Імпортувати». Наявні дні не змінюються." });
    const ta = containerEl.createEl("textarea", { cls: "mw-import", attr: { rows: "5", placeholder: '{"2026-09-01": true, "2026-09-02": true}' } });
    let place = this.plugin.activePlace()?.id ?? "";
    let newRate = 0;
    const live = this.plugin.store.data.places.filter((p) => !p.archived);
    const row = new Setting(containerEl).setName("Місце для імпортованих днів");
    if (live.length) row.addDropdown((d) => { for (const p of live) d.addOption(p.id, p.name); d.setValue(place).onChange((v) => { place = v; }); });
    else row.setDesc("Місць ще немає — буде створено «Робота» з цією ставкою (стара ставка: localStorage 'kalendarz_finanse_rate').")
      .addText((t) => { t.inputEl.type = "number"; t.setPlaceholder("zł/день").onChange((v) => { newRate = Number(v.replace(",", ".")) || 0; }); });
    new Setting(containerEl).addButton((b) => b.setButtonText("Імпортувати").setCta().onClick(async () => {
      try {
        const d = this.plugin.store.data;
        if (!place) {
          const p = { id: newId("pl"), name: "Робота", bonus: 0, color: PALETTE[0], rates: [{ from: "2000-01-01", rate: newRate }] };
          d.places.push(p); place = p.id; this.plugin.setActivePlace(p.id);
        }
        const n = importLegacy(d, ta.value.trim(), place);
        await this.plugin.commit();
        new Notice(`Імпортовано днів: ${n}`);
        ta.value = "";
        this.display();
      } catch (e) {
        new Notice(`Не вдалося імпортувати: ${e instanceof Error ? e.message : String(e)}`);
      }
    }));
  }
}
