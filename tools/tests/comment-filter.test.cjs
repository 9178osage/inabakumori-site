const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../../backend/services.mjs');

test('comment filter allows ordinary fan text that only looked like links, phones or ads', async () => {
  const { detectCommentSafetyIssue } = await load();
  for (const text of ['life.is good', 'love this.so much', 'wait.me too', 'contact me if u like rain lol',
    '50% discount on joy', 'promo of the new album', '用彩票的心情等新歌', '贷款也要买专辑', 'i listened 13812345678 times']) {
    assert.equal(detectCommentSafetyIssue(text), null, text);
  }
});

test('comment filter still blocks real links, contact details and advertising', async () => {
  const { detectCommentSafetyIssue } = await load();
  for (const text of ['see https://example.com', 'http://x.y', 'www.example.com', 'hxxp://evil', 'example(.)com',
    'Ｗｗｗ.example.com', 'example.com', 'bilibili.tv上看到的', 'go to evil.me/free', 'mail me a@b.com',
    '加一下我的微信', '他的qq: abc', '+86 13812345678', '138 1234 5678', '电话13812345678', '010-12345678',
    '无抵押贷款秒批', '彩票平台充值找我', 'use promo code RAIN', '50% off today', 'contact me on telegram', 'buy now']) {
    assert.notEqual(detectCommentSafetyIssue(text), null, text);
  }
});

test('comment validation rejects invisible-only text and bidi marks, keeps emoji joiners', async () => {
  const { validateCommentInput } = await load();
  for (const filler of ['\u3164', '\u115F\u1160', '\uFFA0', '\u2060', '\u00AD', '\u180E', '\u034F']) {
    assert.equal(validateCommentInput({ nickname: filler, content: 'hello' }).ok, false, `nickname ${filler.codePointAt(0).toString(16)}`);
    assert.equal(validateCommentInput({ nickname: 'rain', content: filler + filler }).ok, false, `content ${filler.codePointAt(0).toString(16)}`);
  }
  for (const mark of ['\u200E', '\u200F', '\u061C']) {
    assert.equal(validateCommentInput({ nickname: `a${mark}b`, content: 'hello' }).ok, false);
    assert.equal(validateCommentInput({ nickname: 'rain', content: `hi${mark}` }).ok, false);
  }
  assert.deepEqual(validateCommentInput({ nickname: '\u3164rain', content: '👨‍👩‍👧 好听\n第二行' }), { ok: true, nickname: '\u3164rain', content: '👨‍👩‍👧 好听\n第二行' });
});
