import { afterEach, describe, expect, it } from 'vitest';
import { mount, tick, unmount } from '$lib/test/svelte-client';

import PrivacyPage from './+page.svelte';

const REQUIRED_SECTION_IDS = [
  'scope',
  'data-collected',
  'purposes',
  'browser-storage',
  'service-providers',
  'retention',
  'account-deletion',
  'security',
  'contact',
  'changes'
] as const;

const PROVIDER_PRIVACY_LINKS = [
  ['Vercel', 'https://vercel.com/legal/privacy-notice'],
  ['Cloudflare', 'https://www.cloudflare.com/policies/privacy/'],
  ['Supabase', 'https://supabase.com/privacy'],
  ['Resend', 'https://resend.com/legal/privacy-policy'],
  [
    'GitHub',
    'https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement'
  ]
] as const;

let mounted: ReturnType<typeof mount> | null = null;
let mountedHeadNodes: Node[] = [];
let existingTitleContents = new Map<HTMLTitleElement, string | null>();

async function renderPage(): Promise<HTMLElement> {
  const target = document.createElement('div');
  const existingHeadNodes = new Set(document.head.childNodes);
  existingTitleContents = new Map(
    Array.from(document.head.querySelectorAll('title')).map((title) => [title, title.textContent])
  );
  document.body.appendChild(target);
  try {
    mounted = mount(PrivacyPage, { target });
    await tick();
  } finally {
    mountedHeadNodes = Array.from(document.head.childNodes).filter(
      (node) => !existingHeadNodes.has(node)
    );
  }
  return target;
}

async function cleanupPage(): Promise<void> {
  if (mounted) {
    await unmount(mounted);
    mounted = null;
  }
  for (const node of mountedHeadNodes) {
    node.parentNode?.removeChild(node);
  }
  mountedHeadNodes = [];
  for (const [title, content] of existingTitleContents) {
    title.textContent = content;
  }
  existingTitleContents.clear();
  document.body.replaceChildren();
}

afterEach(cleanupPage);

describe('/privacy test isolation', () => {
  it('page metadataだけを片付け、既存のhead要素を保持する', async () => {
    const existingMeta = document.createElement('meta');
    existingMeta.setAttribute('charset', 'utf-8');
    const existingTitle = document.createElement('title');
    existingTitle.textContent = '既存タイトル';
    document.head.append(existingMeta, existingTitle);

    await renderPage();
    const privacyDescription = Array.from(
      document.head.querySelectorAll<HTMLMetaElement>('meta[name="description"]')
    ).find((meta) => meta.content.includes('Gensoko'));
    const privacyTitle = Array.from(document.head.querySelectorAll('title')).find((title) =>
      title.textContent?.includes('Gensoko')
    );

    expect(privacyDescription).toBeDefined();
    expect(privacyTitle).toBeDefined();

    await cleanupPage();

    expect(document.head.contains(existingMeta)).toBe(true);
    expect(document.head.contains(existingTitle)).toBe(true);
    expect(existingTitle.textContent).toBe('既存タイトル');
    expect(document.head.contains(privacyDescription ?? null)).toBe(false);
    expect(
      Array.from(document.head.querySelectorAll('title')).some((title) =>
        title.textContent?.includes('Gensoko')
      )
    ).toBe(false);
  });
});

describe('/privacy content contract', () => {
  it('最上位見出しを1つだけ表示し、目次から名前付きsectionへ移動できる', async () => {
    const target = await renderPage();
    const headings = target.querySelectorAll('h1');
    const tableOfContents = target.querySelector('nav[aria-label="プライバシーポリシーの目次"]');

    expect(headings).toHaveLength(1);
    expect(headings[0]?.textContent).toContain('プライバシーポリシー');
    for (const id of REQUIRED_SECTION_IDS) {
      const section = target.querySelector<HTMLElement>(`section#${id}`);
      const headingId = section?.getAttribute('aria-labelledby');
      const link = tableOfContents?.querySelector<HTMLAnchorElement>(`a[href="#${id}"]`);

      expect(section, id).not.toBeNull();
      expect(link, id).not.toBeNull();
      expect(section?.getAttribute('tabindex'), id).toBe('-1');
      expect(headingId, id).toBe(`${id}-heading`);
      expect(section?.querySelector(`#${headingId}`), id).not.toBeNull();

      section?.focus();
      expect(document.activeElement, id).toBe(section);
    }
  });

  it('収集情報をaccount・認証・学習・監査・request metadataに分けて説明する', async () => {
    const target = await renderPage();
    const content = target.querySelector('#data-collected')?.textContent ?? '';

    for (const expected of ['ユーザー名', 'メールアドレス', '認証', '学習', '監査', 'IPアドレス']) {
      expect(content).toContain(expected);
    }
  });

  it('sessionStorageとHttpOnly refresh Cookieの役割を区別する', async () => {
    const target = await renderPage();
    const content = target.querySelector('#browser-storage')?.textContent ?? '';

    expect(content).toContain('sessionStorage');
    expect(content).toContain('アクセストークン');
    expect(content).toContain('HttpOnly');
    expect(content).toContain('リフレッシュトークン');
  });

  it('監査・backup・稼働DB削除の保持境界を説明する', async () => {
    const target = await renderPage();
    const retention = target.querySelector('#retention')?.textContent ?? '';
    const deletion = target.querySelector('#account-deletion')?.textContent ?? '';

    expect(retention).toContain('365日');
    expect(retention).toContain('最長7日');
    expect(retention).toContain('期限切れ後は認証に使用できません');
    expect(retention).not.toContain('有効期限、利用、無効化、アカウント削除に応じて削除');
    expect(deletion).toContain('稼働DB');
    expect(deletion).toContain('物理削除');
  });

  it('placeholderを公開本文へ残さない', async () => {
    const target = await renderPage();
    const content = target.textContent ?? '';

    expect(content).not.toMatch(/TODO|TBD|example\.com|未確定|仮文言/i);
  });

  it('ownerが確定した運営主体・制定日・発効日・version・問い合わせ先を表示する', async () => {
    const target = await renderPage();
    const scope = target.querySelector('#scope')?.textContent ?? '';
    const effectiveDate = target.querySelector<HTMLTimeElement>(
      '#scope time[datetime="2026-08-01"]'
    );
    const contact = target.querySelector('#contact');
    const contactLink = contact?.querySelector<HTMLAnchorElement>(
      'a[href="mailto:isibasiwork@gmail.com"]'
    );

    expect(scope).toContain('rituko.llink');
    expect(scope).toContain('2026年8月1日');
    expect(scope).toContain('1.0');
    expect(effectiveDate).not.toBeNull();
    expect(effectiveDate?.textContent ?? '').toContain('2026年8月1日');
    expect(contactLink?.textContent).toContain('isibasiwork@gmail.com');
    expect(contact?.textContent).toContain('秘密情報');
  });

  it('利用予定providerの公式privacy pageへ識別可能なlinkを提供する', async () => {
    const target = await renderPage();
    const providers = target.querySelector('#service-providers');

    for (const [name, href] of PROVIDER_PRIVACY_LINKS) {
      const link = providers?.querySelector<HTMLAnchorElement>(`a[href="${href}"]`);
      expect(link, name).not.toBeNull();
      expect(link?.textContent, name).toContain(name);
      expect(link?.textContent, name).toContain('プライバシー');
      expect(link?.textContent, name).toContain('外部サイト');
      expect(new URL(link?.href ?? '').protocol, name).toBe('https:');
    }
  });

  it('改定時は制定日を維持し、本ページの改定日・発効日・versionを更新すると説明する', async () => {
    const target = await renderPage();
    const changes = target.querySelector('#changes')?.textContent ?? '';

    expect(changes).toContain('本ページ');
    expect(changes).toContain('改定日・発効日');
    expect(changes).toContain('バージョン');
    expect(changes).not.toContain('制定日・発効日とバージョンを更新');
  });

  it('本文中のlinkはdark themeでも通常文字のcontrastを満たすtokenを使う', async () => {
    const target = await renderPage();
    const links = target.querySelectorAll<HTMLAnchorElement>('a');

    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.classList.contains('text-action-text'), link.textContent ?? link.href).toBe(true);
      expect(link.classList.contains('text-action'), link.textContent ?? link.href).toBe(false);
    }
  });
});

describe('/privacy head metadata', () => {
  it('日本語titleとdescriptionを設定する', async () => {
    await renderPage();
    const description = document.head.querySelector<HTMLMetaElement>('meta[name="description"]');

    expect(document.title).toContain('プライバシーポリシー');
    expect(description?.content).toContain('Gensoko');
    expect(description?.content).toContain('個人情報');
  });
});
