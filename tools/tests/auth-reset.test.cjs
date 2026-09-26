const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync("tools/auth-src.js", "utf8").replace(/^import .*;\n/gm, "");
test("updated mail transport composes SuperTokens reset emails without sending real mail", async () => {
  const nodemailer = require("../../backend/node_modules/nodemailer");
  const { getServiceImplementation } = require("../../backend/node_modules/supertokens-node/lib/build/recipe/emailpassword/emaildelivery/services/smtp/serviceImplementation");
  const { getPasswordResetEmailHTML } = require("../../backend/node_modules/supertokens-node/lib/build/recipe/emailpassword/emaildelivery/services/smtp/passwordReset");
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true });
  const send = transport.sendMail.bind(transport);
  let delivered;
  transport.sendMail = async options => { delivered = await send(options); return delivered; };
  const service = getServiceImplementation(transport, { name: "Station", email: "station@example.com" });
  const link = "https://9178osage.github.io/inabakumori-site/?resetPassword=1&token=test-token";
  const body = getPasswordResetEmailHTML("Station", "reader@example.com", link);
  assert.ok(body.includes(link));
  await service.sendRawEmail({ toEmail: "reader@example.com", subject: "Password reset instructions", body, isHtml: true, userContext: {} });
  assert.deepEqual(delivered.envelope.to, ["reader@example.com"]);
  assert.equal(delivered.envelope.from, "station@example.com");
  assert.match(delivered.message.toString(), /Content-Type: text\/html/);
  assert.match(delivered.message.toString(), /Subject: Password reset instructions/);
  await assert.rejects(send({ from: "station@example.com", to: "reader@example.com", disableFileAccess: true, raw: { path: "/tmp/should-not-be-read.eml" } }), /File access rejected/i);
  transport.close();
});
function setup(url = "http://localhost:5500/") {
  const elements = {}, listeners = {}, events = [], calls = [];
  let language = "zh";
  const session = {};
  const context = {
    URL, Event, console: { error() {} },
    localStorage: { getItem: () => language },
    SuperTokens: { init() {} },
    EmailPassword: { init(config) { calls.push(config); } },
    Session: { init(config) { session.config = config; } },
    doesSessionExist: async () => false,
    signIn: async () => ({ status: "OK" }), signUp: async () => ({ status: "OK" }), signOut: async () => {},
    sendPasswordResetEmail: async () => ({ status: "OK" }), submitNewPassword: async () => ({ status: "OK" }),
    alert() {},
    window: {
      APP_CONFIG: { apiDomain: "http://localhost:3001" }, location: new URL(url),
      history: { state: { unchanged: true }, replaceState(state, _, next) { calls.push({ state, next }); } },
      addEventListener(name, handler) { listeners[name] = handler; },
      dispatchEvent(event) { events.push(event.type); }
    },
    document: {
      getElementById: id => elements[id],
      querySelector: () => elements["auth-switch"],
      addEventListener(name, handler) { listeners[name] = handler; }
    }
  };
  for (const id of ["auth-btn", "auth-title", "auth-email", "auth-password", "auth-password-confirm", "auth-submit", "auth-switch", "auth-forgot", "auth-status", "auth-error", "auth-close"]) {
    elements[id] = {
      id, value: "", hidden: false, disabled: false,
      focus() { context.document.activeElement = this; },
      setAttribute() {}, closest() { return this.hidden ? this : null; }
    };
  }
  const modalClasses = new Set();
  elements["auth-modal"] = {
    classList: { add: name => modalClasses.add(name), remove: name => modalClasses.delete(name), contains: name => modalClasses.has(name) },
    querySelectorAll: () => ["auth-close", "auth-email", "auth-password", "auth-password-confirm", "auth-submit", "auth-switch", "auth-forgot"].map(id => elements[id]).filter(el => !el.disabled)
  };
  context.document.activeElement = elements["auth-btn"];
  vm.createContext(context);
  vm.runInContext(fs.readFileSync("js/i18n.js", "utf8"), context);
  vm.runInContext(source, context);
  return { context, elements, listeners, events, calls, session, run: code => vm.runInContext(code, context), language(value) { language = value; listeners.languagechange(); } };
}
test("cross-site sessions use header authentication", () => {
  const app = setup();
  assert.equal(app.session.config.tokenTransferMethod, "header");
});
test("reset link token is scrubbed from URL but remains available to the SDK", async () => {
  const app = setup("http://localhost:5500/?resetPassword=1&token=fake-token&tenantId=demo&keep=1#songs");
  assert.equal(app.calls[0].next, "/?keep=1#songs");
  assert.equal(app.calls[0].state.unchanged, true);
  const recipe = app.calls[1].override.functions({});
  assert.equal(recipe.getResetPasswordTokenFromURL({}), "fake-token");
  assert.equal(recipe.getTenantIdFromURL({}), "demo");
  await app.listeners.DOMContentLoaded();
  assert.equal(app.elements["auth-email"].hidden, true);
  assert.equal(app.elements["auth-password-confirm"].hidden, false);
  assert.equal(app.context.document.activeElement.id, "auth-password");
});
test("reset email requests need only email, avoid duplicates, and show private bilingual feedback", async () => {
  const app = setup();
  app.run("forgotPassword()");
  app.elements["auth-email"].value = "person@example.com";
  let resolve, requests = 0;
  app.context.sendPasswordResetEmail = input => {
    requests++;
    assert.equal(input.formFields.length, 1);
    assert.equal(input.formFields[0].value, "person@example.com");
    return new Promise(done => { resolve = done; });
  };
  const pending = app.run("submitAuth()");
  await app.run("submitAuth()");
  app.run("switchAuthMode()");
  assert.equal(requests, 1);
  assert.equal(app.run("authMode"), "forgot");
  assert.equal(app.elements["auth-submit"].disabled, true);
  resolve({ status: "OK" });
  await pending;
  assert.equal(app.elements["auth-submit"].disabled, false);
  assert.match(app.elements["auth-status"].innerText, /如果这个邮箱已注册/);
  app.language("en");
  assert.match(app.elements["auth-status"].innerText, /If this email is registered/);
});
test("new passwords are validated before submitting, cleared on success, and the token is discarded", async () => {
  const app = setup("http://localhost:5500/?resetPassword=1&token=fake-token");
  await app.listeners.DOMContentLoaded();
  let requests = 0;
  app.context.submitNewPassword = async input => {
    requests++;
    assert.equal(input.formFields[0].value, "Password123");
    return { status: "OK" };
  };
  app.elements["auth-password"].value = "short";
  app.elements["auth-password-confirm"].value = "short";
  await app.run("submitAuth()");
  assert.equal(requests, 0);
  assert.match(app.elements["auth-error"].innerText, /8–99/);
  app.elements["auth-password"].value = "Password123";
  await app.run("submitAuth()");
  assert.equal(requests, 0);
  assert.match(app.elements["auth-error"].innerText, /不一致/);
  app.elements["auth-password-confirm"].value = "Password123";
  await app.run("submitAuth()");
  assert.equal(requests, 1);
  assert.equal(app.run("resetToken"), "");
  assert.equal(app.run("authMode"), "signin");
  assert.equal(app.elements["auth-password"].value, "");
  assert.equal(app.elements["auth-password-confirm"].value, "");
  assert.match(app.elements["auth-status"].innerText, /密码已更新/);
});
test("invalid reset links show recovery action while network failures allow retry", async () => {
  const app = setup("http://localhost:5500/?resetPassword=1&token=fake-token");
  await app.listeners.DOMContentLoaded();
  app.elements["auth-password"].value = app.elements["auth-password-confirm"].value = "Password123";
  app.context.submitNewPassword = async () => { throw new Error("offline"); };
  await app.run("submitAuth()");
  assert.equal(app.elements["auth-submit"].disabled, false);
  assert.equal(app.run("resetToken"), "fake-token");
  assert.match(app.elements["auth-error"].innerText, /连接服务器失败/);
  app.context.submitNewPassword = async () => ({ status: "RESET_PASSWORD_INVALID_TOKEN_ERROR" });
  await app.run("submitAuth()");
  assert.equal(app.run("resetToken"), "");
  assert.equal(app.elements["auth-password"].value, "");
  assert.equal(app.elements["auth-forgot"].hidden, false);
  assert.match(app.elements["auth-error"].innerText, /失效或已使用/);
  app.run("forgotPassword()");
  assert.equal(app.elements["auth-email"].hidden, false);
});
test("focus trapping skips hidden password controls and returns focus when closed", async () => {
  const app = setup();
  await app.run("openAuthModal()");
  app.run("forgotPassword()");
  app.elements["auth-switch"].focus();
  let prevented = false;
  app.listeners.keydown({ key: "Tab", preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(app.context.document.activeElement.id, "auth-close");
  app.elements["auth-password"].value = "sensitive";
  app.listeners.keydown({ key: "Escape", preventDefault() {} });
  assert.equal(app.context.document.activeElement.id, "auth-btn");
  assert.equal(app.elements["auth-password"].value, "");
});
test("successful sign-in and sign-out notify the personal comment list", async () => {
  const app = setup();
  app.elements["auth-email"].value = "person@example.com";
  app.elements["auth-password"].value = "Password123";
  await app.run("submitAuth()");
  assert.deepEqual(app.events, ["authchange"]);
  app.context.doesSessionExist = async () => true;
  await app.run("openAuthModal()");
  assert.deepEqual(app.events, ["authchange", "authchange"]);
});
test("auth placeholders and existing server errors follow the selected language", async () => {
  const app = setup();
  app.run("showAuthModal('signin')");
  assert.equal(app.elements['auth-email'].placeholder, '邮箱');
  assert.equal(app.elements['auth-password'].placeholder, '密码');
  app.elements['auth-email'].value = 'invalid';
  app.elements['auth-password'].value = 'password123';
  app.context.signIn = async () => ({ status: 'FIELD_ERROR', formFields: [{ id: 'email', error: 'RAW ENGLISH SERVER ERROR' }] });
  await app.run('submitAuth()');
  assert.equal(app.elements['auth-error'].innerText, '请输入有效的邮箱地址。');
  app.language('en');
  assert.equal(app.elements['auth-email'].placeholder, 'Email');
  assert.equal(app.elements['auth-password'].placeholder, 'Password');
  assert.equal(app.elements['auth-password-confirm'].placeholder, 'Confirm new password');
  assert.equal(app.elements['auth-error'].innerText, 'Please enter a valid email address.');
  app.context.signIn = async () => ({ status: 'SIGN_IN_NOT_ALLOWED', reason: 'RAW SERVER REASON' });
  await app.run('submitAuth()');
  assert.match(app.elements['auth-error'].innerText, /currently not available/);
  app.language('zh');
  assert.equal(app.elements['auth-error'].innerText, '暂时无法完成操作，请稍后重试。');
});

test("signup distinguishes the SDK's duplicate-email field error from invalid email in all languages", async () => {
  const app = setup();
  app.run('showAuthModal("signup")');
  app.elements["auth-email"].value = "person@example.com";
  app.elements["auth-password"].value = "Password123";
  for (const [language, duplicateMessage, invalidMessage] of [
    ["zh", "这个邮箱已经注册过了。", "请输入有效的邮箱地址。"],
    ["en", "This email is already registered.", "Please enter a valid email address."],
    ["ja", "このメールアドレスはすでに登録されています。", "有効なメールアドレスを入力してください。"]
  ]) {
    app.language(language);
    app.context.signUp = async () => ({
      status: "FIELD_ERROR",
      formFields: [{ id: "email", error: "This email already exists. Please sign in instead." }]
    });
    await app.run("submitAuth()");
    assert.equal(app.elements["auth-error"].innerText, duplicateMessage);
    assert.equal(app.run("authMode"), "signup");
    assert.equal(app.elements["auth-submit"].disabled, false);

    app.context.signUp = async () => ({
      status: "FIELD_ERROR",
      formFields: [{ id: "email", error: "Email is invalid" }]
    });
    await app.run("submitAuth()");
    assert.equal(app.elements["auth-error"].innerText, invalidMessage);
  }
});

test("Japanese authentication covers validation, reset instructions, and language changes", async () => {
  const app = setup();
  app.language("ja");
  app.run('showAuthModal("signin")');
  assert.equal(app.elements["auth-title"].innerText, "ログイン");
  await app.run("submitAuth()");
  assert.equal(app.elements["auth-error"].innerText, "メールアドレスを入力してください。");
  app.run("forgotPassword()");
  assert.equal(app.elements["auth-submit"].innerText, "再設定メールを送信");
  assert.match(app.elements["auth-status"].innerText, /登録したメールアドレス/);
  app.language("en");
  assert.equal(app.elements["auth-submit"].innerText, "Send Reset Email");
});
