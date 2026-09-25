import SuperTokens from "supertokens-web-js";
import EmailPassword, { signIn, signUp, sendPasswordResetEmail, submitNewPassword } from "supertokens-web-js/recipe/emailpassword";
import Session, { doesSessionExist, signOut } from "supertokens-web-js/recipe/session";
let resetToken = "";
let resetTenantId = "public";
let resetLinkRequested = false;
if (window.location.search) {
  const url = new URL(window.location.href);
  if (url.searchParams.get("resetPassword") === "1") {
    resetLinkRequested = true;
    resetToken = url.searchParams.get("token") || "";
    resetTenantId = url.searchParams.get("tenantId") || "public";
    for (const key of ["resetPassword", "token", "tenantId"]) url.searchParams.delete(key);
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }
}
SuperTokens.init({
  appInfo: { appName: "Inabakumori Fanswall", apiDomain: window.APP_CONFIG.apiDomain, websiteDomain: window.location.origin, apiBasePath: "/auth", websiteBasePath: "/auth" },
  recipeList: [EmailPassword.init({ override: { functions: (original) => ({
    ...original,
    getResetPasswordTokenFromURL: (input) => resetLinkRequested ? resetToken : original.getResetPasswordTokenFromURL(input),
    getTenantIdFromURL: (input) => resetLinkRequested ? resetTenantId : original.getTenantIdFromURL(input)
  }) } }), Session.init({ tokenTransferMethod: "header" })]
});
let authMode = "signin";
let authSubmitting = false;
let authReturnFocus = null;
let authNotice = "";
let authErrorMessages = ["", ""];
function currentPageLanguage() {
  return localStorage.getItem("language") || "zh";
}
function authText(zh, en) {
  return window.siteText?.(zh, en) ?? (currentPageLanguage() === "zh" ? zh : en);
}
async function updateAuthButton() {
  const button = document.getElementById("auth-btn");
  if (!button) return;
  try {
    button.innerText = await doesSessionExist() ? authText("退出登录", "Sign Out") : authText("登录 / 注册", "Sign In / Sign Up");
  } catch (error) {
    console.error("检查登录状态失败：", error);
  }
}
function showAuthModal(mode) {
  authMode = mode;
  authNotice = "";
  clearAuthError();
  updateAuthModal();
  const modal = document.getElementById("auth-modal");
  if (modal) {
    authReturnFocus = document.activeElement;
    modal.classList.add("open");
    document.getElementById(mode === "reset" ? "auth-password" : "auth-email")?.focus?.();
  }
}
async function openAuthModal() {
  if (authSubmitting) return;
  if (resetToken) {
    showAuthModal("reset");
    return;
  }
  let loggedIn = false;
  try {
    loggedIn = await doesSessionExist();
  } catch (error) {
    console.error("检查登录状态失败：", error);
  }
  if (loggedIn) {
    try {
      await signOut();
      await updateAuthButton();
      window.dispatchEvent(new Event("authchange"));
      alert(authText("已退出登录。", "Signed out."));
    } catch (error) {
      console.error("退出失败：", error);
    }
    return;
  }
  showAuthModal("signin");
}
function clearAuthPasswords() {
  for (const id of ["auth-password", "auth-password-confirm"]) {
    const input = document.getElementById(id);
    if (input) input.value = "";
  }
}
function closeAuthModal() {
  const modal = document.getElementById("auth-modal");
  if (modal) {
    modal.classList.remove("open");
    authReturnFocus?.focus?.();
  }
  clearAuthPasswords();
  clearAuthError();
}
function switchAuthMode() {
  if (authSubmitting) return;
  if (authMode === "reset") resetToken = "";
  authMode = authMode === "signin" ? "signup" : "signin";
  authNotice = "";
  clearAuthPasswords();
  clearAuthError();
  updateAuthModal();
  document.getElementById("auth-email")?.focus?.();
}
function forgotPassword() {
  if (authSubmitting) return;
  authMode = "forgot";
  authNotice = "";
  resetToken = "";
  clearAuthPasswords();
  clearAuthError();
  updateAuthModal();
  document.getElementById("auth-email")?.focus?.();
}
function updateAuthModal() {
  const title = document.getElementById("auth-title");
  const submit = document.getElementById("auth-submit");
  const switchButton = document.querySelector(".auth-switch");
  const email = document.getElementById("auth-email");
  const password = document.getElementById("auth-password");
  const confirm = document.getElementById("auth-password-confirm");
  const forgot = document.getElementById("auth-forgot");
  const status = document.getElementById("auth-status");
  const reset = authMode === "reset";
  if (email) {
    email.hidden = reset;
    email.placeholder = authText("邮箱", "Email");
    email.setAttribute?.("aria-label", email.placeholder);
  }
  const close = document.getElementById("auth-close");
  close?.setAttribute?.("aria-label", authText("关闭", "Close"));
  const error = document.getElementById("auth-error");
  if (error) error.innerText = authText(...authErrorMessages);
  if (password) {
    password.hidden = authMode === "forgot";
    password.autocomplete = authMode === "signin" ? "current-password" : "new-password";
    password.placeholder = reset ? authText("新密码（至少 8 位，包含字母和数字）", "New password (8+ characters, letters and numbers)") : authText("密码", "Password");
    password.setAttribute?.("aria-label", reset ? authText("新密码", "New password") : authText("密码", "Password"));
  }
  if (confirm) {
    confirm.hidden = !reset;
    confirm.placeholder = authText("再次输入新密码", "Confirm new password");
    confirm.setAttribute?.("aria-label", authText("确认新密码", "Confirm new password"));
  }
  if (forgot) {
    forgot.hidden = !["signin", "reset"].includes(authMode);
    forgot.innerText = reset ? authText("重新获取重置邮件", "Request another reset email") : authText("忘记密码？", "Forgot password?");
  }
  const titles = {
    signin: authText("登录", "Sign In"), signup: authText("注册", "Sign Up"),
    forgot: authText("找回密码", "Forgot Password"), reset: authText("设置新密码", "Set a New Password")
  };
  if (title) title.innerText = titles[authMode];
  if (submit) submit.innerText = authMode === "forgot" ? authText("发送重置邮件", "Send Reset Email") : titles[authMode];
  if (switchButton) switchButton.innerText = authMode === "signin" ? authText("没有账号？注册", "No account? Sign up") : authMode === "signup" ? authText("已有账号？登录", "Already have an account? Sign in") : authText("返回登录", "Back to Sign In");
  if (status) status.innerText = authNotice === "resetSent" ? authText("如果这个邮箱已注册，我们会发送重置密码邮件。请检查收件箱和垃圾邮件文件夹。", "If this email is registered, a password reset email will be sent. Please check your inbox and spam folder.") : authNotice === "resetSuccess" ? authText("密码已更新，请使用新密码登录。", "Password updated. Please sign in with your new password.") : authMode === "forgot" ? authText("输入注册时使用的邮箱，获取重置密码链接。", "Enter your account email to request a password reset link.") : "";
}
function showAuthError(message, english = message) {
  authErrorMessages = [message, english];
  const errorElement = document.getElementById("auth-error");
  if (errorElement) errorElement.innerText = authText(...authErrorMessages);
}
function clearAuthError() {
  showAuthError("");
}
async function submitAuth() {
  if (authSubmitting) return;
  const emailInput = document.getElementById("auth-email");
  const passwordInput = document.getElementById("auth-password");
  if (!emailInput || !passwordInput) return;
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  const submittedMode = authMode;
  clearAuthError();
  if (submittedMode !== "reset" && !email) {
    showAuthError("请输入邮箱。", "Please enter your email.");
    return;
  }
  if (submittedMode !== "forgot" && !password) {
    showAuthError("请输入密码。", "Please enter your password.");
    return;
  }
  if (submittedMode === "reset") {
    if (!resetToken) {
      showAuthError("重置链接已失效，请重新获取重置邮件。", "This reset link is invalid. Please request another reset email.");
      return;
    }
    if (password.length < 8 || password.length > 99 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
      showAuthError("密码需要 8–99 位，并包含字母和数字。", "Use 8–99 characters, including letters and numbers.");
      return;
    }
    if (password !== document.getElementById("auth-password-confirm")?.value) {
      showAuthError("两次输入的密码不一致。", "The passwords do not match.");
      return;
    }
  }
  const submitButton = document.getElementById("auth-submit");
  authSubmitting = true;
  if (submitButton) submitButton.disabled = true;
  try {
    let response;
    if (submittedMode === "forgot") {
      response = await sendPasswordResetEmail({ formFields: [{ id: "email", value: email }] });
    } else if (submittedMode === "reset") {
      response = await submitNewPassword({ formFields: [{ id: "password", value: password }] });
    } else if (submittedMode === "signin") {
      response = await signIn({ formFields: [{ id: "email", value: email }, { id: "password", value: password }] });
      if (response.status === "WRONG_CREDENTIALS_ERROR") {
        showAuthError("邮箱或密码错误。", "Incorrect email or password.");
        return;
      }
    } else {
      response = await signUp({ formFields: [{ id: "email", value: email }, { id: "password", value: password }] });
      const emailAlreadyExists = response.status === "FIELD_ERROR" && response.formFields?.some((field) =>
        field.id === "email" && field.error === "This email already exists. Please sign in instead.");
      if (response.status === "EMAIL_ALREADY_EXISTS_ERROR" || emailAlreadyExists) {
        showAuthError("这个邮箱已经注册过了。", "This email is already registered.");
        return;
      }
    }
    if (response.status === "FIELD_ERROR") {
      const field = response.formFields?.[0]?.id;
      if (field === "email") showAuthError("请输入有效的邮箱地址。", "Please enter a valid email address.");
      else if (field === "password") showAuthError("密码需要 8–99 位，并包含字母和数字。", "Use 8–99 characters, including letters and numbers.");
      else showAuthError("输入内容不符合要求，请检查后重试。", "Please check your input and try again.");
      return;
    }
    if (response.status === "RESET_PASSWORD_INVALID_TOKEN_ERROR") {
      resetToken = "";
      clearAuthPasswords();
      showAuthError("重置链接已失效或已使用，请重新获取重置邮件。", "This reset link has expired or was already used. Please request another reset email.");
      return;
    }
    if (response.status !== "OK") {
      showAuthError("暂时无法完成操作，请稍后重试。", "This action is currently not available. Please try again later.");
      return;
    }
    if (submittedMode === "forgot") {
      authNotice = "resetSent";
      updateAuthModal();
    } else if (submittedMode === "reset") {
      resetToken = "";
      clearAuthPasswords();
      authMode = "signin";
      authNotice = "resetSuccess";
      updateAuthModal();
      document.getElementById("auth-email")?.focus?.();
      await updateAuthButton();
      window.dispatchEvent(new Event("authchange"));
    } else {
      emailInput.value = "";
      closeAuthModal();
      await updateAuthButton();
      window.dispatchEvent(new Event("authchange"));
      alert(submittedMode === "signup" ? authText("注册成功！你现在已经登录。", "Account created! You are now signed in.") : authText("登录成功！", "Signed in successfully!"));
    }
  } catch (error) {
    console.error("账号操作失败：", error);
    showAuthError("连接服务器失败，请稍后重试。", "Could not connect to the server. Please try again later.");
  } finally {
    authSubmitting = false;
    if (submitButton) submitButton.disabled = false;
  }
}
window.openAuthModal = openAuthModal;
window.closeAuthModal = closeAuthModal;
window.switchAuthMode = switchAuthMode;
window.forgotPassword = forgotPassword;
window.submitAuth = submitAuth;
window.hasCommentSession = () => doesSessionExist();
document.addEventListener("DOMContentLoaded", async () => {
  if (resetLinkRequested) {
    showAuthModal("reset");
    if (!resetToken) showAuthError("重置链接不完整，请重新获取重置邮件。", "The reset link is incomplete. Please request another reset email.");
  }
  await updateAuthButton();
});
window.addEventListener("languagechange", () => {
  updateAuthButton();
  updateAuthModal();
});
document.addEventListener("keydown", (event) => {
  const modal = document.getElementById("auth-modal");
  if (!modal?.classList.contains("open")) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeAuthModal();
    return;
  }
  if (event.key === "Enter" && !event.isComposing && ["auth-email", "auth-password", "auth-password-confirm"].includes(event.target.id)) {
    event.preventDefault();
    submitAuth();
    return;
  }
  if (event.key === "Tab") {
    const controls = [...modal.querySelectorAll("button:not(:disabled), input:not(:disabled)")].filter((control) => !control.hidden && !control.closest("[hidden]"));
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (!first) return;
    if (!controls.includes(document.activeElement)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
});
