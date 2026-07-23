import { expect, type Page } from '@playwright/test';

export async function waitForHydratedLoginForm(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const form = document.querySelector<HTMLFormElement>('form');
    if (!form) {
      return false;
    }

    const event = new SubmitEvent('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(event);
    return event.defaultPrevented;
  });
  await expect(page.getByRole('alert')).toHaveText('メールアドレスを入力してください');
}
