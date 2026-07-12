import { describe, it, expect } from 'vitest';
import { parseErrorBody, parseErrorResponse, parseSuccessJsonResponse, ApiError } from './errors';

describe('parseErrorBody', () => {
  it('JSON レスポンスを正常にパースして返す', async () => {
    const response = new Response(JSON.stringify({ error: 'テストエラー' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
    const body = await parseErrorBody(response);
    expect(body).toEqual({ error: 'テストエラー' });
  });

  it('details 配列を含む JSON を正常にパースして返す', async () => {
    const response = new Response(
      JSON.stringify({ details: [{ message: 'バリデーションエラー' }] }),
      { status: 422 }
    );
    const body = await parseErrorBody(response);
    expect(body).toEqual({ details: [{ message: 'バリデーションエラー' }] });
  });

  it('非 JSON レスポンスの場合は null を返す', async () => {
    const response = new Response('Internal Server Error', {
      status: 500,
      headers: { 'Content-Type': 'text/html' }
    });
    const body = await parseErrorBody(response);
    expect(body).toBeNull();
  });

  it('空ボディのエラーレスポンスの場合は null を返す', async () => {
    const response = new Response(null, { status: 500 });
    const body = await parseErrorBody(response);
    expect(body).toBeNull();
  });
});

describe('parseErrorResponse', () => {
  it.each([
    [429, 'リクエストが多すぎます。しばらく待ってから再試行してください'],
    [503, '一時的に利用できません。しばらく待ってから再試行してください']
  ])(
    'レート制限系のJSON応答(%i)はstatus・日本語message・bodyを保持する',
    async (status, message) => {
      const body = { error: message };
      const response = new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' }
      });

      try {
        await parseErrorResponse(response, 'フォールバックメッセージ');
        expect.fail('ApiError が throw されるべき');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).status).toBe(status);
        expect((error as ApiError).message).toBe(message);
        expect((error as ApiError).body).toEqual(body);
      }
    }
  );

  it('非JSONの429応答は指定したfallbackとbody=nullを保持する', async () => {
    const response = new Response('Too Many Requests', {
      status: 429,
      headers: { 'Content-Type': 'text/plain' }
    });

    try {
      await parseErrorResponse(response, 'しばらく待ってから再試行してください');
      expect.fail('ApiError が throw されるべき');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(429);
      expect((error as ApiError).message).toBe('しばらく待ってから再試行してください');
      expect((error as ApiError).body).toBeNull();
    }
  });

  it('details[0].message を優先してメッセージにする', async () => {
    const response = new Response(
      JSON.stringify({ error: 'エラー', details: [{ message: 'バリデーションエラー詳細' }] }),
      { status: 400 }
    );
    await expect(parseErrorResponse(response)).rejects.toThrow('バリデーションエラー詳細');
  });

  it('details がない場合は error フィールドをメッセージにする', async () => {
    const response = new Response(JSON.stringify({ error: 'アカウントが見つかりません' }), {
      status: 404
    });
    await expect(parseErrorResponse(response)).rejects.toThrow('アカウントが見つかりません');
  });

  it('error も details もない場合はデフォルトの defaultMessage を使う', async () => {
    const response = new Response(JSON.stringify({}), { status: 500 });
    await expect(parseErrorResponse(response)).rejects.toThrow('エラーが発生しました');
  });

  it('カスタム defaultMessage を指定した場合はそれを使う', async () => {
    const response = new Response(JSON.stringify({}), { status: 500 });
    await expect(parseErrorResponse(response, 'カスタムエラーです')).rejects.toThrow(
      'カスタムエラーです'
    );
  });

  it('非 JSON レスポンスの場合は defaultMessage を使う', async () => {
    const response = new Response('Internal Server Error', { status: 500 });
    await expect(parseErrorResponse(response)).rejects.toThrow('エラーが発生しました');
  });

  it('throw される例外は ApiError インスタンスである', async () => {
    const response = new Response(JSON.stringify({ error: 'テスト' }), { status: 400 });
    await expect(parseErrorResponse(response)).rejects.toBeInstanceOf(ApiError);
  });

  it('ApiError の status が response.status と一致する', async () => {
    const response = new Response(JSON.stringify({ error: 'テスト' }), { status: 422 });
    try {
      await parseErrorResponse(response);
      expect.fail('ApiError が throw されるべき');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(422);
    }
  });

  it('ApiError の body にレスポンスボディが設定される', async () => {
    const bodyData = { error: 'テスト', details: [{ message: '詳細' }] };
    const response = new Response(JSON.stringify(bodyData), { status: 400 });
    try {
      await parseErrorResponse(response);
      expect.fail('ApiError が throw されるべき');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).body).toEqual(bodyData);
    }
  });
});

describe('parseSuccessJsonResponse', () => {
  it('JSON レスポンスを正常にパースして返す', async () => {
    const response = new Response(JSON.stringify({ message: '成功しました' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

    const body = await parseSuccessJsonResponse(response, 'レスポンス形式が不正です');

    expect(body).toEqual({ message: '成功しました' });
  });

  it('非 JSON レスポンスの場合は ApiError(500) と body=null を throw する', async () => {
    const response = new Response('OK', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' }
    });

    try {
      await parseSuccessJsonResponse(response, 'レスポンス形式が不正です');
      expect.fail('ApiError が throw されるべき');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(500);
      expect((error as ApiError).message).toBe('レスポンス形式が不正です');
      expect((error as ApiError).body).toBeNull();
    }
  });
});
