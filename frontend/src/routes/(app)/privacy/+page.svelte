<script lang="ts">
  const providers = [
    {
      name: 'Vercel',
      role: 'フロントエンドの配信',
      data: '画面の配信に伴うリクエスト情報や、IPアドレスなどの通信情報を処理する場合があります。',
      privacyUrl: 'https://vercel.com/legal/privacy-notice'
    },
    {
      name: 'Cloudflare',
      role: 'API配信、エッジセキュリティ、レート制限',
      data: 'APIリクエスト、IPアドレスやUser-Agentなどの通信情報、期限付きのレート制限カウンターを処理する場合があります。',
      privacyUrl: 'https://www.cloudflare.com/policies/privacy/'
    },
    {
      name: 'Supabase',
      role: 'PostgreSQLデータベースのホスティング',
      data: 'アカウント、認証、学習・ゲーム、統計、監査に関するデータを保存します。',
      privacyUrl: 'https://supabase.com/privacy'
    },
    {
      name: 'Resend',
      role: '確認メールとパスワード再設定メールの配信',
      data: '宛先メールアドレス、メール本文、期限付きの確認・再設定URLを配送処理します。',
      privacyUrl: 'https://resend.com/legal/privacy-policy'
    },
    {
      name: 'GitHub Actions・Artifacts',
      role: '暗号化バックアップ処理',
      data: '暗号化したバックアップファイルと、その完全性を確認するチェックサムを処理します。',
      privacyUrl:
        'https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement'
    }
  ] as const;

  const tableOfContents = [
    { href: '#scope', label: '適用範囲' },
    { href: '#data-collected', label: '取り扱う情報' },
    { href: '#purposes', label: '利用目的' },
    { href: '#browser-storage', label: 'ブラウザ保存・Cookie' },
    { href: '#service-providers', label: '外部サービス' },
    { href: '#retention', label: '保持期間' },
    { href: '#account-deletion', label: 'アカウント削除' },
    { href: '#security', label: '安全管理措置' },
    { href: '#contact', label: 'お問い合わせ' },
    { href: '#changes', label: 'ポリシーの改定' }
  ] as const;
</script>

<svelte:head>
  <title>プライバシーポリシー | Gensoko</title>
  <meta
    name="description"
    content="Gensokoにおける個人情報、認証情報、学習データの取扱いを説明するプライバシーポリシーです。"
  />
</svelte:head>

<article class="mx-auto max-w-3xl space-y-10">
  <header class="space-y-3">
    <h1 class="text-text text-2xl font-bold sm:text-3xl">プライバシーポリシー</h1>
    <p class="text-text-muted leading-7">
      Gensokoをご利用になる方へ、サービスで取り扱う情報、その利用目的、保存・削除の範囲を説明します。
    </p>
  </header>

  <nav
    aria-label="プライバシーポリシーの目次"
    class="border-border-muted bg-surface rounded-lg border p-5"
  >
    <h2 class="text-text font-semibold">目次</h2>
    <ul class="mt-3 grid gap-2 text-sm sm:grid-cols-2">
      {#each tableOfContents as item (item.href)}
        <li>
          <a
            class="text-action focus:ring-focus inline-block rounded-sm hover:underline focus:ring-2 focus:ring-offset-2 focus:outline-none"
            href={item.href}
          >
            {item.label}
          </a>
        </li>
      {/each}
    </ul>
  </nav>

  <section id="scope" class="scroll-mt-24 space-y-3">
    <h2 class="text-text text-2xl font-semibold">1. 適用範囲</h2>
    <p class="text-text-muted leading-7">
      本ポリシーは、rituko.llinkが運営する元素記号学習Webアプリ「Gensoko」に適用されます。
    </p>
    <dl
      class="border-border-muted bg-surface grid gap-3 rounded-lg border p-5 text-sm sm:grid-cols-2"
    >
      <div>
        <dt class="text-text-subtle">運営主体</dt>
        <dd class="text-text mt-1 font-medium">rituko.llink</dd>
      </div>
      <div>
        <dt class="text-text-subtle">バージョン</dt>
        <dd class="text-text mt-1 font-medium">1.0</dd>
      </div>
      <div>
        <dt class="text-text-subtle">制定日・発効日</dt>
        <dd class="text-text mt-1 font-medium">2026年8月1日</dd>
      </div>
    </dl>
  </section>

  <section id="data-collected" class="scroll-mt-24 space-y-3">
    <h2 class="text-text text-2xl font-semibold">2. 取り扱う情報</h2>
    <p class="text-text-muted leading-7">Gensokoでは、次の情報を取り扱います。</p>
    <ul class="text-text-muted list-disc space-y-3 pl-6 leading-7">
      <li>
        <strong class="text-text">アカウント情報：</strong>
        ユーザー名、メールアドレス、ハッシュ化したパスワード、権限、メール確認・アカウント状態、登録・更新・最終ログインに関する日時
      </li>
      <li>
        <strong class="text-text">認証・セキュリティ情報：</strong>
        リフレッシュ、メール確認、パスワード再設定に用いるトークンのハッシュと有効期限、ログイン失敗回数、ロック期限
      </li>
      <li>
        <strong class="text-text">学習・ゲーム情報：</strong>
        苦手元素、問題と回答、正誤、スコア、回答時間、連続正解数、ゲーム履歴、統計
      </li>
      <li>
        <strong class="text-text">監査情報：</strong>
        セキュリティ上重要な操作、結果、内部の実行者・対象ID、権限、日時、限定された失敗理由。監査記録にはメールアドレスとユーザー名を保存しません。
      </li>
      <li>
        <strong class="text-text">リクエスト情報：</strong>
        外部サービスが処理する場合のあるIPアドレス、User-Agentなどの通信情報。アプリケーションのデータベースには加工前のIPアドレスを保存せず、レート制限では加工した識別子を利用します。
      </li>
    </ul>
  </section>

  <section id="purposes" class="scroll-mt-24 space-y-3">
    <h2 class="text-text text-2xl font-semibold">3. 利用目的</h2>
    <ul class="text-text-muted list-disc space-y-2 pl-6 leading-7">
      <li>アカウントの登録、本人確認、ログイン状態の維持</li>
      <li>メール確認、パスワード再設定、セキュリティ上必要な連絡</li>
      <li>元素記号の学習、ゲーム結果、苦手元素、ランキングなどの機能提供</li>
      <li>不正利用の抑止、アクセス制御、レート制限、セキュリティ監査</li>
      <li>障害の調査、サービスの安定運用、お問い合わせ対応</li>
    </ul>
  </section>

  <section id="browser-storage" class="scroll-mt-24 space-y-3">
    <h2 class="text-text text-2xl font-semibold">4. ブラウザ保存・Cookie</h2>
    <div class="space-y-4">
      <div class="border-border-muted bg-surface rounded-lg border p-5">
        <h3 class="text-text font-semibold">sessionStorage</h3>
        <p class="text-text-muted mt-2 leading-7">
          ログイン中のアクセストークンと、内部ID・ユーザー名・権限をブラウザのsessionStorageへ保存します。タブを閉じたとき、ログアウト、認証更新の失敗、アカウント削除時に削除されます。
        </p>
      </div>
      <div class="border-border-muted bg-surface rounded-lg border p-5">
        <h3 class="text-text font-semibold">HttpOnly Cookie</h3>
        <p class="text-text-muted mt-2 leading-7">
          ログイン状態を更新するためのリフレッシュトークンをHttpOnly
          Cookieで管理します。フロントエンドのJavaScriptからは読み取らず、有効期限、ログアウト、アカウント削除などの認証処理に従って無効化します。
        </p>
      </div>
    </div>
  </section>

  <section id="service-providers" class="scroll-mt-24 space-y-3">
    <h2 class="text-text text-2xl font-semibold">5. 外部サービス</h2>
    <p class="text-text-muted leading-7">
      Gensokoの提供に必要な範囲で、次の外部サービスを利用します。各社が独自に定める保持期間や処理については、リンク先のポリシーもご確認ください。
    </p>
    <ul class="space-y-4">
      {#each providers as provider (provider.name)}
        <li class="border-border-muted bg-surface rounded-lg border p-5">
          <h3 class="text-text font-semibold">{provider.name}</h3>
          <p class="text-text-muted mt-2 text-sm leading-6">
            <span class="text-text font-medium">役割：</span>{provider.role}
          </p>
          <p class="text-text-muted mt-1 text-sm leading-6">{provider.data}</p>
          <a
            href={provider.privacyUrl}
            class="text-action focus:ring-focus mt-3 inline-block rounded-sm text-sm hover:underline focus:ring-2 focus:ring-offset-2 focus:outline-none"
          >
            {provider.name}のプライバシーポリシー
          </a>
        </li>
      {/each}
    </ul>
  </section>

  <section id="retention" class="scroll-mt-24 space-y-3">
    <h2 class="text-text text-2xl font-semibold">6. 保持期間</h2>
    <ul class="text-text-muted list-disc space-y-3 pl-6 leading-7">
      <li>アカウントと学習データは、サービス利用中またはアカウント削除まで保持します。</li>
      <li>
        認証用トークンのハッシュは、有効期限、利用、無効化、アカウント削除に応じて削除します。
      </li>
      <li>
        セキュリティ上重要な操作の監査記録は、メールアドレスやユーザー名ではなく内部識別子を含む形で、アクセスを制限したうえで365日間保持します。
      </li>
      <li>暗号化バックアップには、削除済みデータが最長7日間残る場合があります。</li>
      <li>
        外部サービスが処理する情報には各社の保持方針が適用されます。Gensoko側の削除だけで外部サービス側の記録が直ちに消えることを保証するものではありません。
      </li>
    </ul>
  </section>

  <section id="account-deletion" class="scroll-mt-24 space-y-3">
    <h2 class="text-text text-2xl font-semibold">7. アカウント削除</h2>
    <p class="text-text-muted leading-7">
      設定画面からアカウントを削除すると、プロフィール情報、認証情報、学習・ゲームデータを稼働DBから物理削除し、削除前の認証情報ではログインできなくなります。削除後は、同じメールアドレスやユーザー名が利用可能であれば再登録できます。共有の元素マスターデータは削除対象ではありません。
    </p>
    <p class="text-text-muted leading-7">
      ただし、セキュリティ監査に必要な内部識別子は365日間、暗号化バックアップ内のデータは最長7日間保持される場合があります。バックアップから復元した場合の削除再反映には、現在の運用上の制約があります。また、メール配送や各外部サービスのログには、各社の方針に従って情報が残る場合があります。
    </p>
  </section>

  <section id="security" class="scroll-mt-24 space-y-3">
    <h2 class="text-text text-2xl font-semibold">8. 安全管理措置</h2>
    <p class="text-text-muted leading-7">
      Gensokoでは、パスワードの一方向ハッシュ化、認証用トークンのハッシュ保存、権限に基づくアクセス制御、暗号化バックアップなど、取り扱う情報に応じた安全管理措置を実施します。ただし、インターネット通信や電子的な保存について、絶対的な安全を保証するものではありません。
    </p>
  </section>

  <section id="contact" class="scroll-mt-24 space-y-3">
    <h2 class="text-text text-2xl font-semibold">9. お問い合わせ</h2>
    <p class="text-text-muted leading-7">
      本ポリシーやデータの取扱いに関するお問い合わせは、
      <a
        href="mailto:isibasiwork@gmail.com"
        class="text-action focus:ring-focus rounded-sm break-all hover:underline focus:ring-2 focus:ring-offset-2 focus:outline-none"
      >
        isibasiwork@gmail.com
      </a>
      までご連絡ください。
    </p>
    <p class="text-text-muted leading-7">
      お問い合わせには、パスワード、認証トークン、Cookie値などの秘密情報を記載しないでください。
    </p>
  </section>

  <section id="changes" class="scroll-mt-24 space-y-3">
    <h2 class="text-text text-2xl font-semibold">10. ポリシーの改定</h2>
    <p class="text-text-muted leading-7">
      本ポリシーを改定する場合は本ページを更新し、制定日・発効日とバージョンを更新して告知します。改定後の内容は、本ページに記載した発効日から適用します。
    </p>
  </section>
</article>
