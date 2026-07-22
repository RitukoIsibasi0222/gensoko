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

async function renderPage(): Promise<HTMLElement> {
  const target = document.createElement('div');
  document.body.appendChild(target);
  mounted = mount(PrivacyPage, { target });
  await tick();
  return target;
}

afterEach(async () => {
  if (mounted) {
    await unmount(mounted);
    mounted = null;
  }
  document.body.replaceChildren();
  document.head.replaceChildren();
});

describe('/privacy content contract', () => {
  it('最上位見出しを1つだけ表示し、必須sectionの安定IDを公開する', async () => {
    const target = await renderPage();
    const headings = target.querySelectorAll('h1');

    expect(headings).toHaveLength(1);
    expect(headings[0]?.textContent).toContain('プライバシーポリシー');
    for (const id of REQUIRED_SECTION_IDS) {
      expect(target.querySelector(`section#${id}`), id).not.toBeNull();
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
    const contact = target.querySelector('#contact');
    const contactLink = contact?.querySelector<HTMLAnchorElement>(
      'a[href="mailto:isibasiwork@gmail.com"]'
    );

    expect(scope).toContain('rituko.llink');
    expect(scope).toContain('2026年8月1日');
    expect(scope).toContain('1.0');
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
    }
  });

  it('改定時は本ページと制定日・発効日・versionを更新すると説明する', async () => {
    const target = await renderPage();
    const changes = target.querySelector('#changes')?.textContent ?? '';

    expect(changes).toContain('本ページ');
    expect(changes).toContain('制定日・発効日');
    expect(changes).toContain('バージョン');
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
