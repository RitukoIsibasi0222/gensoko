import { describe, it, expect } from 'vitest';
import { parseErrorBody, parseErrorResponse, ApiError } from './errors';

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
