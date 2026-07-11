import { afterEach, describe, expect, it, vi } from 'vitest';

import { mount, tick, unmount } from '$lib/test/svelte-client';
import AdminDialog from './AdminDialog.svelte';

type DialogProps = {
  open: boolean;
  title: string;
  description?: string;
  isBusy?: boolean;
  returnFocus?: HTMLElement | null;
  fallbackFocus?: HTMLElement | null;
  onClose: () => void;
};

let mounted: ReturnType<typeof mount> | null = null;

function renderDialog(overrides: Partial<DialogProps> = {}): HTMLElement {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const props: DialogProps = {
    open: true,
    title: 'ユーザー詳細',
    description: '選択したユーザーの詳細情報',
    onClose: vi.fn(),
    ...overrides
  };
  mounted = mount(AdminDialog, { target, props });
  return target;
}

afterEach(async () => {
  if (mounted) {
    await unmount(mounted);
    mounted = null;
  }
  document.body.replaceChildren();
  document.body.style.overflow = '';
});

describe('AdminDialog', () => {
  it('dialog semanticsとlabel/descriptionを関連付け、body scrollを固定する', async () => {
    const target = renderDialog();
    const dialog = target.querySelector('[role=dialog]');

    await tick();

    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.getAttribute('aria-labelledby')).toBe('admin-dialog-title');
    expect(dialog?.getAttribute('aria-describedby')).toBe('admin-dialog-description');
    expect(target.querySelector('#admin-dialog-title')?.textContent).toContain('ユーザー詳細');
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('open後に閉じるボタンへ初期focusする', async () => {
    const target = renderDialog();

    await tick();

    expect(document.activeElement).toBe(target.querySelector('[data-dialog-close]'));
  });

  it('未送信時はEscとbackdropでcloseする', () => {
    const onClose = vi.fn();
    const target = renderDialog({ onClose });
    const dialog = target.querySelector('[role=dialog]') as HTMLElement;
    const backdrop = target.querySelector('[data-dialog-backdrop]') as HTMLElement;

    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    backdrop.click();

    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('処理中はEsc・backdrop・closeを無効化する', () => {
    const onClose = vi.fn();
    const target = renderDialog({ isBusy: true, onClose });
    const dialog = target.querySelector('[role=dialog]') as HTMLElement;
    const backdrop = target.querySelector('[data-dialog-backdrop]') as HTMLElement;
    const closeButton = target.querySelector('[data-dialog-close]') as HTMLButtonElement;

    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    backdrop.click();
    closeButton.click();

    expect(dialog.getAttribute('aria-busy')).toBe('true');
    expect(closeButton.disabled).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('TabとShift+Tabをdialog内へtrapする', async () => {
    const target = renderDialog();
    const dialog = target.querySelector('[role=dialog]') as HTMLElement;
    const closeButton = target.querySelector('[data-dialog-close]') as HTMLButtonElement;
    const lastButton = document.createElement('button');
    dialog.append(lastButton);
    await tick();

    lastButton.focus();
    lastButton.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    );
    expect(document.activeElement).toBe(closeButton);

    closeButton.focus();
    closeButton.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true,
        cancelable: true
      })
    );
    expect(document.activeElement).toBe(lastButton);
  });

  it('unmount時にbody scroll lockを解除する', async () => {
    renderDialog();
    await tick();
    expect(document.body.style.overflow).toBe('hidden');

    await unmount(mounted!);
    mounted = null;

    expect(document.body.style.overflow).toBe('');
  });

  it('close時にtriggerへfocusを戻し、triggerが消えた場合はfallbackへ戻す', () => {
    const trigger = document.createElement('button');
    const fallback = document.createElement('h2');
    fallback.tabIndex = -1;
    document.body.append(trigger, fallback);
    const target = renderDialog({ returnFocus: trigger, fallbackFocus: fallback });
    const closeButton = target.querySelector('[data-dialog-close]') as HTMLButtonElement;

    closeButton.click();
    expect(document.activeElement).toBe(trigger);

    trigger.remove();
    closeButton.click();
    expect(document.activeElement).toBe(fallback);
  });
});
