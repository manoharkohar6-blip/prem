import { ITEMS } from '../game/items';
import { MAX_DAYS } from '../game/levels';
import type { GameSession } from '../game/session';
import type { HunterId, ItemId } from '../game/types';

export type PanelName = 'start' | 'briefing' | 'caught' | 'end' | 'pause' | 'error';
export type ToastTone = 'good' | 'bad' | 'warn' | 'info';

const KIND_LABEL: Record<string, string> = {
  key: 'Key',
  tool: 'Tool',
  fuse: 'Fuse',
  relic: 'Relic',
  trap: 'Trap',
};

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`HUD element #${id} is missing from index.html`);
  return node as T;
}

/** All DOM chrome: day counter, objectives, satchel, prompts, toasts and panels. */
export class Hud {
  private root = el<HTMLDivElement>('hud');
  private overlay = el<HTMLDivElement>('overlay');
  private panels: Record<PanelName, HTMLElement> = {
    start: el('panel-start'),
    briefing: el('panel-briefing'),
    caught: el('panel-caught'),
    end: el('panel-end'),
    pause: el('panel-pause'),
    error: el('panel-error'),
  };

  private dayValue = el<HTMLSpanElement>('day');
  private securityValue = el<HTMLSpanElement>('security');
  private levelName = el<HTMLParagraphElement>('level-name');
  private levelSub = el<HTMLParagraphElement>('level-sub');
  private objectiveList = el<HTMLUListElement>('objectives');
  private inventory = el<HTMLDivElement>('inventory');
  private staminaFill = el<HTMLDivElement>('stamina-fill');
  private prompt = el<HTMLDivElement>('prompt');
  private toasts = el<HTMLDivElement>('toasts');
  private help = el<HTMLDivElement>('help');

  private briefSubtitle = el<HTMLParagraphElement>('brief-subtitle');
  private briefTitle = el<HTMLHeadingElement>('brief-title');
  private briefList = el<HTMLUListElement>('brief-list');
  private briefDay = el<HTMLParagraphElement>('brief-day');
  private caughtEyebrow = el<HTMLParagraphElement>('caught-eyebrow');
  private caughtTitle = el<HTMLHeadingElement>('caught-title');
  private caughtText = el<HTMLParagraphElement>('caught-text');
  private endEyebrow = el<HTMLParagraphElement>('end-eyebrow');
  private endTitle = el<HTMLHeadingElement>('end-title');
  private endText = el<HTMLParagraphElement>('end-text');
  private errorText = el<HTMLParagraphElement>('error-text');

  private objectiveSignature = '';
  private inventorySignature = '';
  private promptText = '';
  private toastsShown = 0;

  constructor() {
    el('days-max').textContent = String(MAX_DAYS);
    this.showPanel('start');
    this.setVisible(false);
  }

  setVisible(visible: boolean): void {
    this.root.classList.toggle('hidden', !visible);
  }

  showPanel(name: PanelName | null): void {
    for (const key of Object.keys(this.panels) as PanelName[]) {
      this.panels[key].classList.toggle('hidden', key !== name);
    }
    this.overlay.classList.toggle('hidden', name === null);
  }

  showError(message: string): void {
    this.errorText.textContent = message;
    this.setVisible(false);
    this.showPanel('error');
  }

  setBriefing(session: GameSession): void {
    const level = session.level;
    this.briefSubtitle.textContent = level.subtitle;
    this.briefTitle.textContent = level.name;
    this.briefList.replaceChildren(
      ...level.brief.map((line) => {
        const li = document.createElement('li');
        li.textContent = line;
        return li;
      }),
    );
    this.briefDay.textContent = `Day ${session.day} of ${MAX_DAYS} · Security ${session.security} · Satchel holds 3 items`;
  }

  setCaught(hunter: HunterId, day: number, lost: boolean): void {
    const label = hunter === 'granny' ? 'Granny' : 'Mundiya';
    this.caughtEyebrow.textContent = lost ? 'Day 5 · no more days' : `Day ${day} ends`;
    this.caughtTitle.textContent = hunter === 'granny' ? 'Granny found you.' : 'Mundiya folded the dark around you.';
    this.caughtText.textContent = lost
      ? `${label} has you, and there is no day left to wake up in.`
      : hunter === 'granny'
        ? 'She drags you back to the cages. When you wake, the asylum has rearranged itself and the locks are tighter.'
        : 'You come to on cold stone with no memory of the walk. Every door you opened is somewhere else now.';
  }

  setEnd(won: boolean, session: GameSession): void {
    if (won) {
      this.endEyebrow.textContent = `Escaped on day ${session.day}`;
      this.endTitle.textContent = 'You walk out under the storm.';
      this.endText.textContent =
        'The gate swings shut behind you and the clocktower keeps ticking. Whatever Granny and Mundiya were keeping in there, it is still awake.';
      return;
    }
    this.endEyebrow.textContent = `Day ${MAX_DAYS} · run over`;
    this.endTitle.textContent = 'The asylum keeps you.';
    this.endText.textContent =
      'Five days gone, and the corridors have learned your footsteps. Somewhere below, a rusted key turns in a lock you will never reach.';
  }

  toast(message: string, tone: ToastTone = 'info'): void {
    if (!message) return;
    const node = document.createElement('div');
    node.className = `toast ${tone}`;
    node.textContent = message;
    this.toasts.appendChild(node);
    this.toastsShown += 1;
    while (this.toasts.childElementCount > 4) this.toasts.firstElementChild?.remove();
    window.setTimeout(() => {
      node.style.opacity = '0';
      window.setTimeout(() => node.remove(), 400);
    }, 3600);
  }

  update(session: GameSession, prompt: string | null, threat: number): void {
    this.dayValue.textContent = String(session.day);
    this.securityValue.textContent = String(session.security);
    this.levelName.textContent = session.level.name;
    this.levelSub.textContent = session.level.subtitle;

    const objectives = session.objectiveList;
    const objectiveSignature = objectives.map((o) => `${o.id}:${o.done ? 1 : 0}`).join('|');
    if (objectiveSignature !== this.objectiveSignature) {
      this.objectiveSignature = objectiveSignature;
      this.objectiveList.replaceChildren(
        ...objectives.map((objective) => {
          const li = document.createElement('li');
          li.textContent = objective.done ? objective.label : `${objective.label} — ${objective.hint}`;
          li.className = objective.done ? 'done' : '';
          return li;
        }),
      );
    }

    const slots = session.inventory.snapshot();
    const inventorySignature = slots.map((item) => item ?? '-').join('|');
    if (inventorySignature !== this.inventorySignature) {
      this.inventorySignature = inventorySignature;
      this.inventory.replaceChildren(
        ...slots.map((item: ItemId | null, index: number) => {
          const slot = document.createElement('div');
          slot.className = item ? 'slot' : 'slot empty';
          const key = document.createElement('span');
          key.className = 'slot-key';
          key.textContent = String(index + 1);
          const name = document.createElement('span');
          name.className = 'slot-name';
          name.textContent = item ? ITEMS[item].name : 'empty';
          const kind = document.createElement('span');
          kind.className = 'slot-kind';
          kind.textContent = item ? KIND_LABEL[ITEMS[item].kind] ?? ITEMS[item].kind : '—';
          slot.append(key, name, kind);
          return slot;
        }),
      );
    }

    this.staminaFill.style.width = `${Math.round(session.player.stamina * 100)}%`;
    this.root.classList.toggle('danger', threat > 0.55);

    const nextPrompt = prompt ?? '';
    if (nextPrompt !== this.promptText) {
      this.promptText = nextPrompt;
      this.prompt.classList.toggle('hidden', !nextPrompt);
      if (nextPrompt) {
        this.prompt.innerHTML = '';
        const key = document.createElement('b');
        key.textContent = 'E';
        this.prompt.append(key, document.createTextNode(nextPrompt));
      }
    }
  }

  toggleHelp(): boolean {
    const visible = this.help.classList.toggle('hidden');
    return !visible;
  }

  clearToasts(): void {
    this.toasts.replaceChildren();
    this.toastsShown = 0;
  }
}
