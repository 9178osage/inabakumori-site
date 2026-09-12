import SuperTokens from "supertokens-web-js";
import EmailPassword, {
  signIn,
  signUp
} from "supertokens-web-js/recipe/emailpassword";
import Session, {
  doesSessionExist,
  signOut
} from "supertokens-web-js/recipe/session";
SuperTokens.init({
  appInfo: {
    appName: "Inabakumori Fanswall",
    apiDomain: window.APP_CONFIG.apiDomain,
    websiteDomain: window.location.origin,
    apiBasePath: "/auth",
    websiteBasePath: "/auth"
  },
  recipeList: [
    EmailPassword.init(),
    Session.init({
      tokenTransferMethod: "cookie"
    })
  ]
});
let authMode = "signin";
async function updateAuthButton() {
  const button = document.getElementById("auth-btn");
  if (!button) {
    return;
  }
  try {
    const loggedIn = await doesSessionExist();
    if (loggedIn) {
      button.innerText = currentPageLanguage() === "zh" ? "退出登录" : "Sign Out";
    } else {
      button.innerText = currentPageLanguage() === "zh" ? "登录 / 注册" : "Sign In / Sign Up";
    }
  } catch (error) {
    console.error(
      "检查登录状态失败：",
      error
    );
  }
}
function currentPageLanguage() {
  return localStorage.getItem("language") || "zh";
}
async function openAuthModal() {
  const loggedIn = await doesSessionExist();
  if (loggedIn) {
    try {
      await signOut();
      await updateAuthButton();
      alert(
        currentPageLanguage() === "zh" ? "已退出登录。" : "Signed out."
      );
    } catch (error) {
      console.error(
        "退出失败：",
        error
      );
    }
    return;
  }
  authMode = "signin";
  updateAuthModal();
  const modal = document.getElementById(
    "auth-modal"
  );
  if (modal) {
    modal.classList.add("open");
  }
}
function closeAuthModal() {
  const modal = document.getElementById(
    "auth-modal"
  );
  if (modal) {
    modal.classList.remove("open");
  }
  clearAuthError();
}
function switchAuthMode() {
  authMode = authMode === "signin" ? "signup" : "signin";
  clearAuthError();
  updateAuthModal();
}
function updateAuthModal() {
  const title = document.getElementById(
    "auth-title"
  );
  const submit = document.getElementById(
    "auth-submit"
  );
  const switchButton = document.querySelector(
    ".auth-switch"
  );
  const language = currentPageLanguage();
  if (authMode === "signin") {
    if (title) {
      title.innerText = language === "zh" ? "登录" : "Sign In";
    }
    if (submit) {
      submit.innerText = language === "zh" ? "登录" : "Sign In";
    }
    if (switchButton) {
      switchButton.innerText = language === "zh" ? "没有账号？注册" : "No account? Sign up";
    }
  } else {
    if (title) {
      title.innerText = language === "zh" ? "注册" : "Sign Up";
    }
    if (submit) {
      submit.innerText = language === "zh" ? "注册" : "Sign Up";
    }
    if (switchButton) {
      switchButton.innerText = language === "zh" ? "已有账号？登录" : "Already have an account? Sign in";
    }
  }
}
function showAuthError(message) {
  const errorElement = document.getElementById(
    "auth-error"
  );
  if (errorElement) {
    errorElement.innerText = message;
  }
}
function clearAuthError() {
  showAuthError("");
}
async function submitAuth() {
  const emailInput = document.getElementById(
    "auth-email"
  );
  const passwordInput = document.getElementById(
    "auth-password"
  );
  if (!emailInput || !passwordInput) {
    return;
  }
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  clearAuthError();
  if (!email) {
    showAuthError(
      currentPageLanguage() === "zh" ? "请输入邮箱。" : "Please enter your email."
    );
    return;
  }
  if (!password) {
    showAuthError(
      currentPageLanguage() === "zh" ? "请输入密码。" : "Please enter your password."
    );
    return;
  }
  const submitButton = document.getElementById(
    "auth-submit"
  );
  if (submitButton) {
    submitButton.disabled = true;
  }
  try {
    let response;
    if (authMode === "signin") {
      response = await signIn({
        formFields: [
          {
            id: "email",
            value: email
          },
          {
            id: "password",
            value: password
          }
        ]
      });
      if (response.status === "WRONG_CREDENTIALS_ERROR") {
        showAuthError(
          currentPageLanguage() === "zh" ? "邮箱或密码错误。" : "Incorrect email or password."
        );
        return;
      }
    } else {
      response = await signUp({
        formFields: [
          {
            id: "email",
            value: email
          },
          {
            id: "password",
            value: password
          }
        ]
      });
      if (response.status === "EMAIL_ALREADY_EXISTS_ERROR") {
        showAuthError(
          currentPageLanguage() === "zh" ? "这个邮箱已经注册过了。" : "This email is already registered."
        );
        return;
      }
    }
    if (response.status === "FIELD_ERROR") {
      const message = response.formFields.map(
        (field) => field.error
      ).join(" ");
      showAuthError(message);
      return;
    }
    if (response.status === "SIGN_IN_NOT_ALLOWED" || response.status === "SIGN_UP_NOT_ALLOWED") {
      showAuthError(
        response.reason || (currentPageLanguage() === "zh" ? "暂时无法完成操作。" : "This action is currently not allowed.")
      );
      return;
    }
    if (response.status === "OK") {
      emailInput.value = "";
      passwordInput.value = "";
      closeAuthModal();
      await updateAuthButton();
      alert(
        authMode === "signup" ? currentPageLanguage() === "zh" ? "注册成功！你现在已经登录。" : "Account created! You are now signed in." : currentPageLanguage() === "zh" ? "登录成功！" : "Signed in successfully!"
      );
    }
  } catch (error) {
    console.error(
      "登录 / 注册失败：",
      error
    );
    showAuthError(
      currentPageLanguage() === "zh" ? "连接服务器失败，请确认后端正在运行。" : "Could not connect to the server."
    );
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
    }
  }
}
window.openAuthModal = openAuthModal;
window.closeAuthModal = closeAuthModal;
window.switchAuthMode = switchAuthMode;
window.submitAuth = submitAuth;
document.addEventListener(
  "DOMContentLoaded",
  async () => {
    await updateAuthButton();
    console.log(
      "✅ SuperTokens frontend initialized"
    );
  }
);
window.addEventListener("languagechange", () => {
  updateAuthButton();
  updateAuthModal();
});
