const pageLanguages = ["zh", "en", "ja"];
let currentLanguage = pageLanguages.includes((window.siteStorage || localStorage).getItem("language")) ? (window.siteStorage || localStorage).getItem("language") : "zh";
function pageText(zh, en) {
  return window.siteText?.(zh, en, currentLanguage) ?? (currentLanguage === "zh" ? zh : en);
}
function commentErrorMessage(data, response) {
  const messages = {
    PROMOTIONAL_CONTENT: ["留言内容不能包含链接、邮箱、电话号码或广告联系方式", "Messages cannot contain links, email addresses, phone numbers, or promotional contact details."],
    DUPLICATE_COMMENT: ["相同内容请稍后再留言", "Please wait before posting the same message again."],
    GUEST_RATE_LIMITED: ["游客每小时最多留言 3 条，请稍后再试", "Guests can post up to 3 messages per hour. Please try again later."],
    RATE_LIMITED: ["留言发送过于频繁，请稍后再试", "Messages are being sent too quickly. Please try again later."],
    MEMBER_RATE_LIMITED: ["登录用户每小时最多留言 20 条，请稍后再试", "Signed-in members can post up to 20 messages per hour. Please try again later."],
    MEMBER_COMMENT_CAP: ["每个账号最多保留 100 条留言，请先删除旧留言", "Each account can keep up to 100 messages. Please delete some older ones first."]
  };
  const message = messages[data?.code];
  if (message) return pageText(message[0], message[1]);
  if (currentLanguage === "ja") {
    return response.status === 429 ? "投稿が多すぎます。しばらくしてから再試行してください。" : response.status === 400 || response.status === 413 ? "入力内容または文字数を確認して、もう一度お試しください。" : pageText("留言发布失败。", "Failed to post your message.");
  }
  if (currentLanguage === "en") {
    return response.status === 400 || response.status === 413 ? "Please check your input and message length." : "Failed to post your message. Please try again.";
  }
  return data?.error || pageText("留言发布失败。", "Failed to post your message.");
}
let currentTheme = document.documentElement?.dataset?.theme || (window.siteStorage || localStorage).getItem("theme") || "light";
let currentSlide = 0;
const COMMENTS_API = `${window.APP_CONFIG.apiDomain}/api/comments`;
function applyLanguage() {
  document.querySelectorAll("[data-zh][data-en]").forEach((element) => {
    element.innerText = element.dataset[currentLanguage] ?? pageText(element.dataset.zh, element.dataset.en);
  });
  document.querySelectorAll("[data-href-zh][data-href-en]").forEach((element) => {
    const href = currentLanguage === "ja" ? (element.dataset.hrefJa || element.dataset.hrefEn) : currentLanguage === "zh" ? element.dataset.hrefZh : element.dataset.hrefEn;
    if (href) {
      element.setAttribute("href", href);
    }
  });
  const glitchTitle = document.querySelector(".glitch");
  if (glitchTitle) {
    glitchTitle.setAttribute("data-text", glitchTitle.dataset[currentLanguage] || glitchTitle.dataset.zh);
  }
  const langButton = document.getElementById("lang-btn");
  if (langButton) {
    langButton.innerText = { zh: "English", en: "日本語", ja: "中文" }[currentLanguage];
    langButton.setAttribute("aria-label", { zh: "切换语言，当前：中文", en: "Switch language, current: English", ja: "言語を切り替え、現在：日本語" }[currentLanguage]);
  }
  const nameInput = document.getElementById("message-name");
  const messageInput = document.getElementById("message-input");
  if (nameInput) {
    nameInput.placeholder = pageText("你的名字 / Name", "Your name");
  }
  if (messageInput) {
    messageInput.placeholder = pageText("想对稲葉曇说些什么？", "Say something to Inabakumori...");
  }
  document.title = { zh: "气象观测站 · 稲葉曇", en: "Weather Observation Station · Inabakumori", ja: "気象観測所 · 稲葉曇" }[currentLanguage];
  const description = document.querySelector('meta[name="description"]');
  if (description) {
    description.content = { zh: "稲葉曇的气象观测站：歌曲、MV、创作链接与留言墙。", en: "A weather observation station for Inabakumori songs, videos, links, and messages.", ja: "稲葉曇さんの楽曲、MV、リンク、メッセージを集めた観測所です。" }[currentLanguage];
  }
  document.querySelector(".site-controls")?.setAttribute("aria-label", currentLanguage === "ja" ? "ページ設定" : currentLanguage === "en" ? "Page controls" : "页面设置");
  document.querySelector(".hero-content nav")?.setAttribute("aria-label", currentLanguage === "ja" ? "メインナビゲーション" : currentLanguage === "en" ? "Main navigation" : "主导航");
  document.querySelector(".section-nav")?.setAttribute("aria-label", currentLanguage === "ja" ? "セクションナビ" : currentLanguage === "en" ? "Section navigation" : "章节导航");
  document.getElementById("tag-suggestions")?.setAttribute("aria-label", currentLanguage === "ja" ? "選択できるタグ" : currentLanguage === "en" ? "Available tags" : "可选标签");
  document.getElementById("floating-wall")?.setAttribute("aria-label", currentLanguage === "ja" ? "メッセージ" : currentLanguage === "en" ? "Messages" : "留言");
  document.querySelector(".skip-link")?.replaceChildren(document.createTextNode({ zh: "跳到主要内容", en: "Skip to content", ja: "メインコンテンツへ" }[currentLanguage]));
  updateConnectivityStatus();
  updateMessageLoadStatus();
  if (document.body) applyTheme();
  document.documentElement.lang = { zh: "zh-CN", en: "en", ja: "ja" }[currentLanguage];
  window.dispatchEvent(new Event("languagechange"));
  document.querySelectorAll(".floating-message").forEach((element) => {
    element.refreshLanguage?.();
  });
}
function updateConnectivityStatus() {
  const status = document.getElementById("site-status");
  if (!status) return;
  const online = typeof navigator === "undefined" || navigator.onLine !== false;
  status.hidden = online;
  if (!online) {
    status.textContent = { zh: "当前处于离线状态，留言和登录功能暂时不可用。", en: "You are offline. Messages and sign-in are temporarily unavailable.", ja: "現在オフラインです。メッセージとログインは一時的に利用できません。" }[currentLanguage];
  }
}
function toggleLanguage() {
  currentLanguage = pageLanguages[(pageLanguages.indexOf(currentLanguage) + 1) % pageLanguages.length];
  (window.siteStorage || localStorage).setItem("language", currentLanguage);
  applyLanguage();
  if (typeof updateTagLanguage === "function") {
    updateTagLanguage();
  }
}
function applyTheme() {
  const themeButton = document.getElementById("theme-btn");
  document.body.classList.toggle("dark", currentTheme === "dark");
  if (document.documentElement.dataset) document.documentElement.dataset.theme = currentTheme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", currentTheme === "dark" ? "#171b1f" : "#c4c4c0");
  if (themeButton) {
    themeButton.innerText = currentTheme === "dark" ? "☀" : "☾";
    themeButton.setAttribute("aria-label", currentTheme === "dark" ? pageText("切换浅色主题", "Switch to light theme") : pageText("切换深色主题", "Switch to dark theme"));
    themeButton.setAttribute("aria-pressed", String(currentTheme === "dark"));
  }
}
function toggleTheme() {
  currentTheme = currentTheme === "light" ? "dark" : "light";
  (window.siteStorage || localStorage).setItem("theme", currentTheme);
  applyTheme();
}
const desktopHeroImages = ["images/optimized/hero/001.webp", "images/optimized/hero/002.webp", "images/optimized/hero/003.webp", "images/optimized/hero/004.webp", "images/optimized/hero/005.webp", "images/optimized/hero/006.webp", "images/optimized/hero/007.webp", "images/optimized/hero/008.webp", "images/optimized/hero/009.webp", "images/optimized/hero/010.webp", "images/optimized/hero/011.webp", "images/optimized/hero/012.webp", "images/optimized/hero/013.webp", "images/optimized/hero/014.webp", "images/optimized/hero/015.webp", "images/optimized/hero/016.webp", "images/optimized/hero/017.webp", "images/optimized/hero/018.webp", "images/optimized/hero/019.webp", "images/optimized/hero/020.webp", "images/optimized/hero/021.webp", "images/optimized/hero/022.webp", "images/optimized/hero/023.webp", "images/optimized/hero/024.webp", "images/optimized/hero/025.webp", "images/optimized/hero/026.webp", "images/optimized/hero/027.webp", "images/optimized/hero/028.webp", "images/optimized/hero/029.webp", "images/optimized/hero/030.webp", "images/optimized/hero/031.webp", "images/optimized/hero/032.webp", "images/optimized/hero/033.webp", "images/optimized/hero/034.webp", "images/optimized/hero/035.webp", "images/optimized/hero/036.webp", "images/optimized/hero/037.webp", "images/optimized/hero/038.webp", "images/optimized/hero/039.webp", "images/optimized/hero/040.webp", "images/optimized/hero/041.webp", "images/optimized/hero/042.webp", "images/optimized/hero/043.webp", "images/optimized/hero/044.webp", "images/optimized/hero/045.webp", "images/optimized/hero/046.webp", "images/optimized/hero/047.webp", "images/optimized/hero/048.webp", "images/optimized/hero/049.webp", "images/optimized/hero/050.webp", "images/optimized/hero/051.webp", "images/optimized/hero/052.webp", "images/optimized/hero/053.webp", "images/optimized/hero/054.webp", "images/optimized/hero/055.webp", "images/optimized/hero/056.webp", "images/optimized/hero/057.webp", "images/optimized/hero/058.webp", "images/optimized/hero/059.webp"];
let heroImages = desktopHeroImages;
let heroLoadVersion = 0;
const mobileHeroQuery = window.matchMedia?.("(max-width: 700px), (pointer: coarse) and (max-width: 1000px)");
const loadedHeroImages = new Map();
let heroSwitchVersion = 0;
function loadHeroImage(path, retry = true) {
  if (loadedHeroImages.has(path)) return loadedHeroImages.get(path);
  const request = new Promise(resolve => {
    const image = new Image();
    image.decoding = "async";
    let timer;
    const finish = value => {
      clearTimeout(timer);
      image.onload = image.onerror = null;
      resolve(value);
    };
    timer = setTimeout(() => finish(null), 12000);
    image.onload = () => finish(image);
    image.onerror = () => finish(null);
    image.src = path;
  }).then(async image => {
    if (!image) {
      loadedHeroImages.delete(path);
      if (retry && !document.hidden) return loadHeroImage(path, false);
    }
    return image;
  });
  // Keep a small decoded-image cache rather than retaining every full-size background.
  if (loadedHeroImages.size >= 3) loadedHeroImages.delete(loadedHeroImages.keys().next().value);
  loadedHeroImages.set(path, request);
  return request;
}
function setHeroSource(slide, path) {
  slide.src = path;
  const mobileSource = document.getElementById("hero-mobile-source");
  if (mobileSource) mobileSource.srcset = path;
}
function preloadNextHeroImage() {
  if (heroImages.length && !document.hidden && !(typeof navigator !== "undefined" && navigator.connection?.saveData)) void loadHeroImage(heroImages[(currentSlide + 1) % heroImages.length]);
}
async function loadMobileHeroImage(path) {
  const image = await loadHeroImage(path);
  return Boolean(image && image.naturalHeight > image.naturalWidth);
}
async function discoverHeroImages() {
  const version = ++heroLoadVersion;
  ++heroSwitchVersion;
  const slide = document.getElementById("hero-slide");
  currentSlide = 0;
  heroImages = mobileHeroQuery?.matches ? [] : desktopHeroImages;
  if (slide) {
    if (heroImages.length) setHeroSource(slide, heroImages[0]);
    else slide.removeAttribute("src");
    slide.hidden = !heroImages.length;
  }
  if (!mobileHeroQuery?.matches) {
    return;
  }
  const config = window.MOBILE_BACKGROUNDS;
  if (!config) return;
  if (config.lazy && Array.isArray(config.files)) {
    heroImages = config.files.map(file => `${config.folder}${file}`);
    if (slide && heroImages.length) {
      setHeroSource(slide, heroImages[0]);
      slide.hidden = false;
    }
    return;
  }
  if (Array.isArray(config.files)) {
    const paths = config.files.map(file => `${config.folder}${file}`);
    const available = new Set();
    for (const path of paths) {
      const loaded = await loadMobileHeroImage(path);
      if (version !== heroLoadVersion) return;
      if (!loaded) continue;
      available.add(path);
      const selected = heroImages[currentSlide];
      heroImages = paths.filter(candidate => available.has(candidate));
      currentSlide = selected ? heroImages.indexOf(selected) : 0;
      if (!selected && slide) {
        setHeroSource(slide, heroImages[0]);
        slide.hidden = false;
      }
    }
    return;
  }
  for (let number = 1; number <= config.maxImages; number++) {
    let found = false;
    for (const extension of config.extensions) {
      const path = `${config.folder}${String(number).padStart(3, "0")}.${extension}`;
      const loaded = await loadMobileHeroImage(path);
      if (version !== heroLoadVersion) return;
      if (!loaded) continue;
      heroImages.push(path);
      if (heroImages.length === 1 && slide) {
        setHeroSource(slide, path);
        slide.hidden = false;
      }
      found = true;
      break;
    }
    if (!found) break;
  }
}
mobileHeroQuery?.addEventListener("change", discoverHeroImages);
async function changeHeroSlide() {
  if (easterEggOpen) return;
  const heroSlide = document.getElementById("hero-slide");
  if (!heroSlide || !heroImages.length) {
    return;
  }
  if (heroImages.length === 1) {
    return;
  }
  const request = ++heroSwitchVersion;
  const next = (currentSlide + 1) % heroImages.length;
  const path = heroImages[next];
  const image = await loadHeroImage(path);
  if (!image || request !== heroSwitchVersion) return;
  currentSlide = next;
  setHeroSource(heroSlide, path);
  preloadNextHeroImage();
}
let messageSubmitting = false;
let wallRevision = 0;
let messageLoadId = 0;
let messageLoadState = "idle";
const pendingWallMessages = new Map();
const deletedWallMessages = new Set();
window.removeWallMessage = (id) => {
  deletedWallMessages.add(id);
  pendingWallMessages.delete(id);
  document.querySelectorAll(".floating-message").forEach(element => {
    if (Number(element.dataset.commentId) === id) element.disposeMessage();
  });
  if (messageLoadState === "ready" && !document.querySelectorAll(".floating-message").length) {
    messageLoadState = "empty";
    updateMessageLoadStatus();
  }
};
function updateMessageLoadStatus() {
  const status = document.getElementById("message-load-status");
  const retry = document.getElementById("message-retry");
  const wall = document.getElementById("floating-wall");
  if (status) {
    const text = { loading: ["正在加载留言…", "Loading messages…"], error: ["留言加载失败，请检查连接后重试。", "Could not load messages. Check your connection and retry."], empty: ["还没有留言，留下第一条讯息吧。", "No messages yet. Leave the first one."], ready: ["", ""], idle: ["", ""] };
    status.textContent = pageText(...text[messageLoadState]);
  }
  if (retry) retry.hidden = messageLoadState !== "error";
  wall?.setAttribute?.("aria-busy", String(messageLoadState === "loading"));
}
const MAX_NICKNAME_LENGTH = 30;
const MAX_COMMENT_LENGTH = 500;
function unicodeLength(value) {
  return Array.from(String(value ?? "")).length;
}
function enforceCommentFieldLimits(nameInput, messageInput) {
  if (nameInput && unicodeLength(nameInput.value) > MAX_NICKNAME_LENGTH) {
    nameInput.value = Array.from(nameInput.value).slice(0, MAX_NICKNAME_LENGTH).join("");
  }
  if (messageInput && unicodeLength(messageInput.value) > MAX_COMMENT_LENGTH) {
    messageInput.value = Array.from(messageInput.value).slice(0, MAX_COMMENT_LENGTH).join("");
  }
}
async function addMessage() {
  if (messageSubmitting) return;
  const nameInput = document.getElementById("message-name");
  const messageInput = document.getElementById("message-input");
  if (!nameInput || !messageInput) return;
  enforceCommentFieldLimits(nameInput, messageInput);
  const nickname = nameInput.value.trim();
  const content = messageInput.value.trim();
  if (!nickname || !content) {
    showMessageFeedback(!nickname ? pageText("请输入昵称。", "Please enter your name.") : pageText("请输入留言内容。", "Please enter a message."));
    (!nickname ? nameInput : messageInput).focus();
    return;
  }
  if (unicodeLength(nickname) > MAX_NICKNAME_LENGTH) {
    showMessageFeedback(pageText(`昵称不能超过 ${MAX_NICKNAME_LENGTH} 个字符。`, `Names cannot exceed ${MAX_NICKNAME_LENGTH} characters.`));
    nameInput.focus();
    return;
  }
  if (unicodeLength(content) > MAX_COMMENT_LENGTH) {
    showMessageFeedback(pageText(`留言不能超过 ${MAX_COMMENT_LENGTH} 个字符。`, `Messages cannot exceed ${MAX_COMMENT_LENGTH} characters.`));
    messageInput.focus();
    return;
  }
  const button = document.getElementById("message-submit") || document.querySelector(".message-box button");
  const originalName = nameInput.value;
  const originalContent = messageInput.value;
  messageSubmitting = true;
  showMessageFeedback(pageText("正在发送…", "Posting…"), false);
  if (button) button.disabled = true;
  try {
    const response = await (window.siteFetch || fetch)(COMMENTS_API, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ nickname, content }) });
    const data = await response.json();
    if (!response.ok) {
      const failure = new Error("Comment rejected");
      failure.userMessage = commentErrorMessage(data, response);
      throw failure;
    }
    if (!data.comment || !Number.isSafeInteger(data.comment.id)) {
      throw new SyntaxError("Invalid comment response");
    }
    if (nameInput.value === originalName) nameInput.value = "";
    if (messageInput.value === originalContent) messageInput.value = "";
    wallRevision++;
    pendingWallMessages.set(data.comment.id, { revision: wallRevision, message: data.comment });
    if (messageLoadState === "empty") messageLoadState = "ready";
    updateMessageLoadStatus();
    createFloatingMessage(data.comment, false);
    showMessageFeedback(pageText("留言已贴到墙上。", "Your message is on the wall."), false);
    window.dispatchEvent(new Event("commentposted"));
  } catch (error) {
    console.error("留言发布失败：", error);
    // Only show text we localized ourselves; never surface a raw Error message.
    const networkFailure = error instanceof TypeError || error instanceof SyntaxError || error?.name === "TimeoutError" || error?.name === "AbortError";
    showMessageFeedback(typeof error?.userMessage === "string" && error.userMessage ? error.userMessage : networkFailure ? pageText("无法连接服务器或响应异常，请稍后重试。", "The server is unavailable or returned an invalid response. Please try again.") : pageText("留言发布失败。", "Failed to post your message."));
  } finally {
    messageSubmitting = false;
    if (button) button.disabled = false;
  }
}
async function loadMessages() {
  const revision = wallRevision;
  const loadId = ++messageLoadId;
  messageLoadState = "loading";
  updateMessageLoadStatus();
  try {
    const response = await (window.siteFetch || fetch)(COMMENTS_API, { credentials: "include", cache: "no-store" });
    if (!response.ok) throw new Error("无法读取留言");
    const data = await response.json();
    if (!Array.isArray(data.comments)) throw new Error("留言响应格式不正确");
    if (loadId !== messageLoadId) return;
    const wall = document.getElementById("floating-wall");
    if (!wall) return;
    document.querySelectorAll(".floating-message").forEach((element) => element.disposeMessage());
    messageTracks.length = 0;
    const merged = new Map(data.comments.map((message) => [message.id, message]));
    pendingWallMessages.forEach((entry) => {
      if (entry.revision > revision) merged.set(entry.message.id, entry.message);
    });
    const comments = [...merged.values()].filter((message) => !deletedWallMessages.has(message.id) && (!message.expiresAt || Date.parse(message.expiresAt) > Date.now()));
    comments.forEach((message) => createFloatingMessage(message, true));
    pendingWallMessages.clear();
    messageLoadState = comments.length ? "ready" : "empty";
    updateMessageLoadStatus();
  } catch (error) {
    if (loadId !== messageLoadId) return;
    console.error("留言读取失败：", error);
    messageLoadState = "error";
    updateMessageLoadStatus();
  }
}
function showMessageFeedback(message, error = true) {
  const status = document.getElementById("message-submit-status");
  if (!status) { if (error) alert(message); return; }
  status.textContent = message;
  status.dataset.error = String(error);
}
const messageTracks = [];
let wallInView = true;
let wallStatic = false;
const MAX_OVERLAP = 0.4;
function getVerticalOverlapRatio(y1, h1, y2, h2) {
  const top = Math.max(y1, y2);
  const bottom = Math.min(y1 + h1, y2 + h2);
  const overlap = Math.max(0, bottom - top);
  const smallerHeight = Math.min(h1, h2);
  if (smallerHeight <= 0) {
    return 0;
  }
  return overlap / smallerHeight;
}
function findSafeY(messageHeight, wallHeight) {
  const padding = 15;
  const maxY = wallHeight - messageHeight - padding;
  for (let attempt = 0; attempt < 100; attempt++) {
    const y = padding + Math.random() * Math.max(1, maxY - padding);
    let safe = true;
    for (const other of messageTracks) {
      const overlapRatio = getVerticalOverlapRatio(y, messageHeight, other.y, other.height);
      if (overlapRatio > MAX_OVERLAP) {
        safe = false;
        break;
      }
    }
    if (safe) {
      messageTracks.push({ y, height: messageHeight });
      return y;
    }
  }
  let bestY = padding;
  let bestScore = Infinity;
  for (let y = padding; y <= maxY; y += 5) {
    let worstOverlap = 0;
    for (const other of messageTracks) {
      const ratio = getVerticalOverlapRatio(y, messageHeight, other.y, other.height);
      worstOverlap = Math.max(worstOverlap, ratio);
    }
    if (worstOverlap < bestScore) {
      bestScore = worstOverlap;
      bestY = y;
    }
  }
  messageTracks.push({ y: bestY, height: messageHeight });
  return bestY;
}
function createFloatingMessage(message, startInside = false) {
  const wall = document.getElementById("floating-wall");
  const expiresAt = message.expiresAt ? Date.parse(message.expiresAt) : NaN;
  if (!wall || Number.isFinite(expiresAt) && expiresAt <= Date.now()) return;
  const element = document.createElement("div");
  element.dataset.commentId = String(message.id);
  element.className = message.isGuest === true ? "floating-message guest-message" : "floating-message user-message";
  if (Number.isFinite(expiresAt)) element.dataset.expiresAt = String(expiresAt);
  let track;
  let animation;
  element.refreshLanguage = () => {
    const identity = message.isGuest === true ? pageText(" [游客]", " [Guest]") : message.isGuest === false ? pageText(" [已登录]", " [Member]") : "";
    element.textContent = (message.nickname || message.name || "Anonymous") + identity + "： " + (message.content || message.text || "");
    if (element.isConnected) element.refreshLayout();
  };
  element.updateMotion = () => {
    if (!animation) return;
    if (document.hidden || reducedMotionQuery?.matches || wallStatic || !wallInView) animation.pause?.();
    else animation.play?.();
  };
  element.refreshLayout = () => {
    if (wallStatic || reducedMotionQuery?.matches) {
      animation?.cancel();
      animation = null;
      if (track) { const index = messageTracks.indexOf(track); if (index >= 0) messageTracks.splice(index, 1); track = null; }
      return;
    }
    const progress = animation ? animation.currentTime / animation.effect.getTiming().duration % 1 : startInside ? Math.random() : 0;
    if (animation) animation.cancel();
    if (track) {
      const index = messageTracks.indexOf(track);
      if (index >= 0) messageTracks.splice(index, 1);
    }
    const y = findSafeY(element.offsetHeight, wall.clientHeight);
    track = messageTracks[messageTracks.length - 1];
    const startX = wall.clientWidth + 30;
    const endX = -element.offsetWidth - 30;
    const duration = (startX - endX) / 70 * 1e3;
    animation = element.animate([{ transform: `translate(${startX}px, ${y}px)` }, { transform: `translate(${endX}px, ${y}px)` }], { duration, iterations: Infinity, easing: "linear" });
    animation.currentTime = reducedMotionQuery?.matches ? duration * Math.max(0.15, Math.min(0.85, progress)) : progress * duration;
    element.updateMotion();
  };
  element.disposeMessage = () => {
    if (animation) animation.cancel();
    const index = messageTracks.indexOf(track);
    if (index >= 0) messageTracks.splice(index, 1);
    element.remove();
  };
  element.refreshLanguage();
  element.style.left = "0";
  element.style.top = "0";
  wall.appendChild(element);
  element.refreshLayout();
}
function removeExpiredMessages() {
  document.querySelectorAll(".floating-message[data-expires-at]").forEach((element) => {
    if (Number(element.dataset.expiresAt) <= Date.now()) element.disposeMessage();
  });
}
const reducedMotionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
function updateMotionState() {
  document.documentElement.classList?.toggle("page-hidden", Boolean(document.hidden));
  document.querySelectorAll(".floating-message").forEach(element => element.updateMotion?.());
}
reducedMotionQuery?.addEventListener("change", () => {
  document.querySelectorAll(".floating-message").forEach(element => element.refreshLayout());
});
setInterval(() => { if (!document.hidden) removeExpiredMessages(); }, 1000);
document.addEventListener("visibilitychange", () => {
  updateMotionState();
  if (!document.hidden) removeExpiredMessages();
});
let wallResizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(wallResizeTimer);
  wallResizeTimer = setTimeout(() => document.querySelectorAll(".floating-message").forEach(element => element.refreshLayout()), 150);
});
const OTHER_SINGER_TAG = "其他";
const TAG_PRIORITY = new Map([
  ["anticyclone", 0],
  ["weather station", 1],
  ["singles", 2]
]);
let singerTagCounts = new Map();
function buildSingerTagCounts() {
  const counts = new Map();
  SONGS.forEach(({ singers }) => {
    const uniqueSingers = new Set(singers.map((singer) => normalizeTag(singer)));
    uniqueSingers.forEach((singer) => {
      counts.set(singer, (counts.get(singer) || 0) + 1);
    });
  });
  singerTagCounts = counts;
}
function isSingleSongSinger(tag) {
  return (singerTagCounts.get(normalizeTag(tag)) || 0) === 1;
}
const TAG_ALIASES = { "other": "其他", "反气旋": "anticyclone", "anticyclone": "anticyclone", "气象站": "weather station", "weather station": "weather station", "单曲": "singles", "single": "singles", "singles": "singles", "yuki": "歌爱雪", "kaai yuki": "歌爱雪", "歌爱雪 / kaai yuki": "歌爱雪", "miku": "初音未来", "hatsune miku": "初音未来", "初音未来 / hatsune miku": "初音未来", "hime": "鸣花hime", "meika hime": "鸣花hime", "鸣花hime / meika hime": "鸣花hime", "maki": "弦卷真纪", "tsurumaki maki": "弦卷真纪", "弦卷真纪 / tsurumaki maki": "弦卷真纪", "sekai": "星界", "星界 / sekai": "星界", "rime": "里命", "里命 / rime": "里命", "una": "音街鳗", "otomachi una": "音街鳗", "音街鳗 / otomachi una": "音街鳗", "nagi beta": "nagiβ", "nagiβ": "nagiβ", "kazehiki": "カゼヒキβ", "kazehiki beta": "カゼヒキβ", "kazehiki β": "カゼヒキβ", "カゼヒキβ / kazehiki β": "カゼヒキβ", "shuo": "彩澄しゅお", "ayazumi shuo": "彩澄しゅお", "彩澄しゅお / ayazumi shuo": "彩澄しゅお", "ririse": "彩澄りりせ", "ayazumi ririse": "彩澄りりせ", "彩澄りりせ / ayazumi ririse": "彩澄りりせ" };
const TAG_DISPLAY_NAMES = { "anticyclone": { zh: "反气旋", en: "ANTICYCLONE" }, "weather station": { zh: "气象站", en: "WEATHER STATION" }, "singles": { zh: "单曲", en: "SINGLES" }, "歌爱雪": { zh: "歌爱雪 / Kaai Yuki", en: "Kaai Yuki" }, "初音未来": { zh: "初音未来 / Hatsune Miku", en: "Hatsune Miku" }, "鸣花hime": { zh: "鸣花Hime / MEIKA Hime", en: "MEIKA Hime" }, "弦卷真纪": { zh: "弦卷真纪 / Tsurumaki Maki", en: "Tsurumaki Maki" }, "星界": { zh: "星界 / SEKAI", en: "SEKAI" }, "里命": { zh: "里命 / RIME", en: "RIME" }, "音街鳗": { zh: "音街鳗 / Otomachi Una", en: "Otomachi Una" }, "nagiβ": { zh: "nagiβ", en: "nagiβ" }, "カゼヒキβ": { zh: "カゼヒキβ / Kazehiki β", en: "Kazehiki β" }, "彩澄しゅお": { zh: "彩澄しゅお / Ayazumi Shuo", en: "Ayazumi Shuo" }, "彩澄りりせ": { zh: "彩澄りりせ / Ayazumi Ririse", en: "Ayazumi Ririse" }, "其他": { zh: "其他", en: "Other" } };

TAG_DISPLAY_NAMES["镜音连"] = { zh: "镜音连 / Kagamine Len", en: "Kagamine Len", ja: "鏡音レン" };
TAG_ALIASES["鏡音レン"] = "镜音连";
TAG_ALIASES["kagamine len"] = "镜音连";
TAG_ALIASES["len"] = "镜音连";
TAG_DISPLAY_NAMES["镜音铃"] = { zh: "镜音铃 / Kagamine Rin", en: "Kagamine Rin", ja: "鏡音リン" };
TAG_ALIASES["鏡音リン"] = "镜音铃";
TAG_ALIASES["kagamine rin"] = "镜音铃";
TAG_ALIASES["rin"] = "镜音铃";
TAG_DISPLAY_NAMES["anticyclone"].ja = "ANTICYCLONE";
TAG_ALIASES["anticyclone"] = "anticyclone";
TAG_DISPLAY_NAMES["weather station"].ja = "WEATHER STATION";
TAG_ALIASES["weather station"] = "weather station";
TAG_DISPLAY_NAMES["singles"].ja = "シングル";
TAG_ALIASES["シングル"] = "singles";
TAG_DISPLAY_NAMES["歌爱雪"].ja = "歌愛ユキ";
TAG_ALIASES["歌愛ユキ"] = "歌爱雪";
TAG_DISPLAY_NAMES["初音未来"].ja = "初音ミク";
TAG_ALIASES["初音ミク"] = "初音未来";
TAG_DISPLAY_NAMES["鸣花hime"].ja = "鳴花ヒメ";
TAG_ALIASES["鳴花ヒメ"] = "鸣花hime";
TAG_DISPLAY_NAMES["弦卷真纪"].ja = "弦巻マキ";
TAG_ALIASES["弦巻マキ"] = "弦卷真纪";
TAG_DISPLAY_NAMES["星界"].ja = "星界";
TAG_ALIASES["星界"] = "星界";
TAG_DISPLAY_NAMES["里命"].ja = "裏命";
TAG_ALIASES["裏命"] = "里命";
TAG_DISPLAY_NAMES["音街鳗"].ja = "音街ウナ";
TAG_ALIASES["音街ウナ"] = "音街鳗";
TAG_DISPLAY_NAMES["nagiβ"].ja = "nagiβ";
TAG_ALIASES["nagiβ"] = "nagiβ";
TAG_DISPLAY_NAMES["カゼヒキβ"].ja = "カゼヒキβ";
TAG_ALIASES["カゼヒキβ"] = "カゼヒキβ";
TAG_DISPLAY_NAMES["彩澄しゅお"].ja = "彩澄しゅお";
TAG_ALIASES["彩澄しゅお"] = "彩澄しゅお";
TAG_DISPLAY_NAMES["彩澄りりせ"].ja = "彩澄りりせ";
TAG_ALIASES["彩澄りりせ"] = "彩澄りりせ";
TAG_DISPLAY_NAMES["其他"].ja = "その他";
TAG_ALIASES["その他"] = "其他";
function getTagDisplayLabel(tag) {
  const normalized = normalizeTag(tag);
  const names = TAG_DISPLAY_NAMES[normalized];
  if (!names) {
    return String(tag || "");
  }
  return names[currentLanguage] || names.zh || String(tag || "");
}
function getTagInputLabel(tag, fallback = "") {
  const normalized = normalizeTag(tag);
  const names = TAG_DISPLAY_NAMES[normalized];
  if (!names) {
    return fallback || String(tag || "");
  }
  if (currentLanguage === "zh") {
    return String(names.zh || fallback).split(" / ")[0].trim();
  }
  return names[currentLanguage] || names.en || fallback || String(tag || "");
}
function normalizeTag(tag) {
  const normalized = String(tag || "").trim().toLowerCase().replace(/\s+/g, " ");
  return TAG_ALIASES[normalized] || normalized;
}
function getCleanSongTitle(link) {
  const raw = link.dataset.songTitle || link.textContent || "";
  return raw.replace(/^\s*\d+\s*[　\s]+/, "").trim();
}
function renderSongs() {
  const list = document.getElementById("song-list");
  if (!list) return;
  list.replaceChildren();
  SONGS.forEach((song, index) => {
    const link = document.createElement("a");
    link.href = song.youtube;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.dataset.album = song.album;
    link.dataset.songTitle = song.title;
    link._songData = song;
    link.textContent = String(index + 1).padStart(2, "0") + "　" + song.title;
    list.appendChild(link);
  });
}
function prepareSongTags() {
  buildSingerTagCounts();
  document.querySelectorAll(".song-scroll a").forEach((link) => {
    const title = getCleanSongTitle(link);
    const albumTitle = String(link.dataset.album || "").trim();
    link.dataset.songTitle = title;
    const htmlTags = String(link.dataset.tags || "").split(",").map((tag) => tag.trim()).filter(Boolean);
    const singers = link._songData?.singers || [];
    const hasSingleSongSinger = singers.some(isSingleSongSinger);
    const rawFilterTags = [albumTitle, ...htmlTags, ...singers, ...hasSingleSongSinger ? [OTHER_SINGER_TAG] : []];
    const seen = new Set();
    const filterTags = rawFilterTags.filter((tag) => {
      const normalized = normalizeTag(tag);
      if (!normalized || seen.has(normalized)) {
        return false;
      }
      seen.add(normalized);
      return true;
    });
    link._songTags = filterTags.map(normalizeTag);
    const rawDisplayTags = [albumTitle, ...singers, ...htmlTags];
    const displaySeen = new Set();
    link._songTagLabels = rawDisplayTags.filter((tag) => {
      const normalized = normalizeTag(tag);
      if (!normalized || displaySeen.has(normalized)) {
        return false;
      }
      displaySeen.add(normalized);
      return true;
    });
    renderInlineSongTags(link);
  });
}
function getSongThumbnailUrl(href) {
  try {
    const url = new URL(href);
    const host = url.hostname.toLowerCase();
    let id;
    if (host === "youtu.be") {
      id = url.pathname.split("/")[1];
    } else if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(host)) {
      id = url.searchParams.get("v");
      if (!id && /^\/(embed|shorts)\//.test(url.pathname)) {
        id = url.pathname.split("/")[2];
      }
    }
    return /^[A-Za-z0-9_-]{11}$/.test(id || "") ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : null;
  } catch {
    return null;
  }
}
function formatChineseViews(count) {
  const units = [[100000000, "亿"], [1000000, "百万"], [10000, "万"]];
  const unit = units.find(([minimum]) => count >= minimum);
  if (!unit) return count.toLocaleString("zh-CN");
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(count / unit[0]) + unit[1];
}
function renderInlineSongTags(link) {
  if (link.classList.contains("tag-ready")) return;
  const originalText = link.textContent.trim();
  link.textContent = "";
  const thumbnail = document.createElement("span");
  thumbnail.className = "song-thumbnail";
  thumbnail.setAttribute("aria-hidden", "true");
  const placeholder = document.createElement("span");
  placeholder.className = "song-thumbnail-placeholder";
  placeholder.textContent = "♪";
  thumbnail.appendChild(placeholder);
  const thumbnailUrl = getSongThumbnailUrl(link.href);
  if (thumbnailUrl) {
    const image = document.createElement("img");
    image.alt = "";
    image.width = 320;
    image.height = 180;
    image.loading = "lazy";
    image.decoding = "async";
    image.addEventListener("error", () => image.remove(), { once: true });
    image.src = thumbnailUrl;
    thumbnail.appendChild(image);
  }
  link.appendChild(thumbnail);
  const details = document.createElement("span");
  details.className = "song-details";
  const title = document.createElement("span");
  title.className = "song-title-text";
  title.textContent = originalText;
  details.appendChild(title);
  const song = link._songData;
  if (Number.isSafeInteger(song?.viewCount) && song.viewCount >= 0) {
    const views = document.createElement("span");
    views.className = "song-views";
    const zhCount = formatChineseViews(song.viewCount);
    const enCount = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(song.viewCount);
    views.dataset.zh = `YouTube · ${zhCount} 次播放 · 统计于 ${song.viewsCheckedAt}`;
    views.dataset.en = `YouTube · ${enCount} views · As of ${song.viewsCheckedAt}`;
    views.dataset.ja = `YouTube · ${new Intl.NumberFormat("ja-JP", { notation: "compact", maximumFractionDigits: 1 }).format(song.viewCount)} 回視聴 · ${song.viewsCheckedAt} 時点`;
    views.textContent = views.dataset[currentLanguage];
    const exactCount = song.viewCount.toLocaleString("en-US");
    views.title = `${exactCount} 次播放 / views / 回視聴 · ${song.viewsCheckedAt}`;
    details.appendChild(views);
  }
  const tagList = document.createElement("span");
  tagList.className = "song-tag-list";
  (link._songTagLabels || []).forEach((tag) => {
    const tagElement = document.createElement("span");
    tagElement.className = "song-inline-tag";
    tagElement.dataset.rawTag = tag;
    tagElement.textContent = getTagDisplayLabel(tag);
    tagList.appendChild(tagElement);
  });
  details.appendChild(tagList);
  link.appendChild(details);
  link.classList.add("tag-ready");
}
function parseTagQuery(value) {
  const plain = [];
  const required = [];
  String(value || "").split(/[,，]+/).map((item) => item.trim()).filter(Boolean).forEach((item) => {
    const isRequired = item.startsWith("+");
    const raw = isRequired ? item.slice(1).trim() : item;
    if (!raw) {
      return;
    }
    const token = normalizeTag(raw);
    if (!token) {
      return;
    }
    if (isRequired) {
      required.push(token);
    } else {
      plain.push(token);
    }
  });
  return { plain: [...new Set(plain)], required: [...new Set(required)] };
}
function normalizeTagSearchText(value) {
  return String(value || "").normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}
const tagSearchTermsCache = new Map();
function fuzzyTagMatches(queryToken, canonicalTag) {
  const queryText = normalizeTagSearchText(queryToken);
  const canonical = normalizeTag(canonicalTag);
  if (!queryText || !canonical) {
    return false;
  }
  if (normalizeTag(queryText) === canonical) {
    return true;
  }
  const cacheKey = `${currentLanguage}:${canonical}`;
  let searchTerms = tagSearchTermsCache.get(cacheKey);
  if (!searchTerms) {
    const terms = new Set([canonical, getTagDisplayLabel(canonical), getTagInputLabel(canonical, canonical)]);
    Object.entries(TAG_ALIASES).forEach(([alias, target]) => {
      if (normalizeTag(target) === canonical) {
        terms.add(alias);
      }
    });
    searchTerms = [...terms].map(normalizeTagSearchText);
    tagSearchTermsCache.set(cacheKey, searchTerms);
  }
  const needle = normalizeTagSearchText(queryText);
  return searchTerms.some((term) => term.includes(needle));
}
function getAvailableTags() {
  const labels = new Map();
  document.querySelectorAll(".song-scroll a").forEach((link) => {
    const normalizedTags = link._songTags || [];
    normalizedTags.forEach((normalized) => {
      if ((singerTagCounts.get(normalized) || 0) === 1) {
        return;
      }
      if (!labels.has(normalized)) {
        labels.set(normalized, getTagDisplayLabel(normalized));
      }
    });
  });
  return [...labels.entries()].sort((a, b) => {
    const aPriority = TAG_PRIORITY.has(a[0]) ? TAG_PRIORITY.get(a[0]) : 10;
    const bPriority = TAG_PRIORITY.has(b[0]) ? TAG_PRIORITY.get(b[0]) : 10;
    if (aPriority !== bPriority) {
      return aPriority - bPriority;
    }
    if (a[0] === normalizeTag(OTHER_SINGER_TAG)) {
      return 1;
    }
    if (b[0] === normalizeTag(OTHER_SINGER_TAG)) {
      return -1;
    }
    return a[1].localeCompare(b[1], { zh: "zh-CN", en: "en", ja: "ja" }[currentLanguage], { sensitivity: "base" });
  });
}
function renderTagSuggestions() {
  const container = document.getElementById("tag-suggestions");
  const input = document.getElementById("tag-filter-input");
  if (!container || !input) {
    return;
  }
  const query = parseTagQuery(input.value);
  const selected = new Set([...query.plain, ...query.required]);
  container.replaceChildren();
  getAvailableTags().forEach(([normalized, label]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tag-chip";
    button.textContent = label;
    button.dataset.tag = normalized;
    const active = selected.has(normalized);
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
    button.addEventListener("click", () => {
      toggleTagInInput(normalized, getTagInputLabel(normalized, label));
    });
    container.appendChild(button);
  });
}
function toggleTagInInput(normalizedTag, displayTag) {
  const input = document.getElementById("tag-filter-input");
  if (!input) {
    return;
  }
  const parts = String(input.value || "").split(/[,，]+/).map((item) => item.trim()).filter(Boolean);
  const existsAt = parts.findIndex((part) => normalizeTag(part.replace(/^\+/, "")) === normalizedTag);
  if (existsAt >= 0) {
    parts.splice(existsAt, 1);
  } else {
    parts.push(displayTag);
  }
  input.value = parts.join(", ");
  updateTagFilter();
  input.focus();
}
function songMatchesTitle(title, query) {
  return normalizeTagSearchText(title).includes(normalizeTagSearchText(query));
}
function songMatchesSearch(link, query) {
  const matches = (token) => songMatchesTitle(getCleanSongTitle(link), token) || (link._songTags || []).some((tag) => fuzzyTagMatches(token, tag));
  return query.required.every(matches) && (!query.plain.length || query.plain.some(matches));
}
function updateTagFilter() {
  const input = document.getElementById("tag-filter-input");
  const library = document.querySelector(".song-library");
  const emptyState = document.getElementById("tag-empty-state");
  const count = document.getElementById("tag-result-count");
  if (!input || !library) {
    return;
  }
  const query = parseTagQuery(input.value);
  const filtering = query.plain.length > 0 || query.required.length > 0;
  let visibleSongs = 0;
  let totalSongs = 0;
  document.querySelectorAll(".song-scroll a").forEach((link) => {
    totalSongs++;
    const matched = songMatchesSearch(link, query) && (window.includeFavoriteSong?.(link) ?? true);
    link.hidden = !matched;
    if (matched) {
      visibleSongs++;
    }
  });
  library.classList.toggle("tag-filtering", filtering);
  if (emptyState) {
    emptyState.hidden = visibleSongs !== 0;
  }
  if (count) {
    count.textContent = currentLanguage === "ja" ? `${totalSongs} 曲中 ${visibleSongs} 曲を表示` : currentLanguage === "zh" ? `显示 ${visibleSongs} / ${totalSongs} 首` : `Showing ${visibleSongs} / ${totalSongs} songs`;
  }
  renderTagSuggestions();
  const random = document.getElementById("random-song-button");
  if (random) random.disabled = visibleSongs === 0;
  window.dispatchEvent?.(new Event("songsfiltered"));
}
function updateTagLanguage() {
  const input = document.getElementById("tag-filter-input");
  if (input) {
    input.placeholder = pageText("搜索歌名或 TAG，例如：ラグ / 歌爱 / yuki", "Search titles or tags, e.g. ラグ / yuki / weather");
  }
  document.querySelectorAll(".song-inline-tag[data-raw-tag]").forEach((tagElement) => {
    tagElement.textContent = getTagDisplayLabel(tagElement.dataset.rawTag);
  });
  updateTagFilter();
}
function initTagFilter() {
  const input = document.getElementById("tag-filter-input");
  const clear = document.getElementById("tag-filter-clear");
  if (!input) {
    return;
  }
  renderSongs();
  prepareSongTags();
  input.addEventListener("input", updateTagFilter);
  if (clear) {
    clear.addEventListener("click", () => {
      input.value = "";
      updateTagFilter();
      input.focus();
    });
  }
  updateTagLanguage();
}
document.addEventListener("DOMContentLoaded", () => {
  applyLanguage();
  applyTheme();
  discoverHeroImages();
  initEasterEgg();
  initTagFilter();
  // Bind controls in JS so CSP can omit script-src 'unsafe-inline'.
  document.getElementById("lang-btn")?.addEventListener("click", toggleLanguage);
  document.getElementById("theme-btn")?.addEventListener("click", toggleTheme);
  document.getElementById("auth-btn")?.addEventListener("click", () => window.openAuthModal?.());
  document.getElementById("auth-close")?.addEventListener("click", () => window.closeAuthModal?.());
  document.getElementById("auth-submit")?.addEventListener("click", () => window.submitAuth?.());
  document.getElementById("auth-switch")?.addEventListener("click", () => window.switchAuthMode?.());
  document.getElementById("auth-forgot")?.addEventListener("click", () => window.forgotPassword?.());
  document.getElementById("random-song-button")?.addEventListener("click", playRandomSong);
  document.getElementById("message-retry")?.addEventListener("click", loadMessages);
  document.getElementById("message-submit")?.addEventListener("click", addMessage);
  const messagesSection = document.getElementById("messages");
  if (typeof IntersectionObserver !== "undefined" && messagesSection) {
    const loader = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      loader.disconnect();
      loadMessages();
    }, { rootMargin: "400px" });
    loader.observe(messagesSection);
    const wallObserver = new IntersectionObserver(entries => {
      wallInView = entries[0].isIntersecting;
      updateMotionState();
    });
    wallObserver.observe(messagesSection);
  } else loadMessages();
  const nameInput = document.getElementById("message-name");
  const messageInput = document.getElementById("message-input");
  const trimCommentFields = () => enforceCommentFieldLimits(nameInput, messageInput);
  nameInput?.addEventListener("input", trimCommentFields);
  messageInput?.addEventListener("input", trimCommentFields);
  const heroBg = document.getElementById("hero-bg");
  if (heroBg) {
    heroBg.addEventListener("click", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      changeHeroSlide();
    });
  }
});
window.addEventListener?.("online", updateConnectivityStatus);
window.addEventListener?.("offline", updateConnectivityStatus);
const MEME_COUNT = 6;
const MEME_FOLDER = "images/memes/";
// Intrinsic sizes keep the dialog from jumping while a meme loads (index = number - 1).
const MEME_SIZES = [[259, 224], [616, 532], [370, 320], [628, 542], [116, 139], [110, 59]];
let easterEggOpen = false;
let easterEggCanClose = false;
let easterEggPreviousFocus = null;
let easterEggInertState = [];
function showEasterEgg() {
  const overlay = document.getElementById("easter-egg-overlay");
  const image = document.getElementById("easter-egg-image");
  if (!overlay || !image || easterEggOpen) return;
  const randomNumber = Math.floor(Math.random() * MEME_COUNT) + 1;
  const filename = String(randomNumber).padStart(3, "0") + ".png";
  const [memeWidth, memeHeight] = MEME_SIZES[randomNumber - 1] || [];
  if (memeWidth && memeHeight) {
    image.width = memeWidth;
    image.height = memeHeight;
  }
  image.src = MEME_FOLDER + filename;
  image.alt = currentLanguage === "ja" ? `ランダム画像 ${randomNumber}` : currentLanguage === "zh" ? `随机表情包 ${randomNumber}` : `Random meme ${randomNumber}`;
  easterEggOpen = true;
  easterEggCanClose = true;
  easterEggPreviousFocus = document.activeElement;
  easterEggInertState = [...document.body.children].filter(node => node !== overlay && node.tagName !== "SCRIPT").map(node => [node, node.inert]);
  easterEggInertState.forEach(([node]) => { node.inert = true; });
  document.body.classList.add("easter-egg-open");
  overlay.classList.add("show");
  overlay.setAttribute("aria-hidden", "false");
  createConfetti();
  document.getElementById("easter-egg-close")?.focus();
}
function createConfetti() {
  const layer = document.getElementById("confetti-layer");
  if (!layer) return;
  layer.replaceChildren();
  if (reducedMotionQuery?.matches || document.hidden) return;
  const amount = window.innerWidth < 700 ? 22 : 42;
  const symbols = ["☁", "☆", "☂", "☺"];
  for (let i = 0; i < amount; i++) {
    const piece = document.createElement("div");
    const card = i % 3 === 0;
    piece.className = card ? "forecast-particle forecast-card" : "forecast-particle forecast-symbol";
    if (card) {
      const song = SONGS[Math.floor(Math.random() * SONGS.length)];
      const number = document.createElement("small");
      number.textContent = `FM · ${String(i + 1).padStart(2, "0")}`;
      const title = document.createElement("strong");
      title.textContent = song.title;
      const album = document.createElement("small");
      album.textContent = song.album;
      piece.append(number, title, album);
    } else piece.textContent = symbols[i % symbols.length];
    piece.style.setProperty("--left", `${Math.random() * 100}%`);
    piece.style.setProperty("--drift", `${Math.random() * 180 - 90}px`);
    piece.style.setProperty("--turn", `${Math.random() * 100 - 50}deg`);
    piece.style.setProperty("--duration", `${10 + Math.random() * 10}s`);
    piece.style.setProperty("--delay", `${-Math.random() * 20}s`);
    layer.appendChild(piece);
  }
}
function closeEasterEgg() {
  if (!easterEggOpen || !easterEggCanClose) return;
  const overlay = document.getElementById("easter-egg-overlay");
  if (!overlay) return;
  overlay.classList.remove("show");
  overlay.setAttribute("aria-hidden", "true");
  document.getElementById("confetti-layer")?.replaceChildren();
  document.body.classList.remove("easter-egg-open");
  easterEggInertState.forEach(([node, wasInert]) => { node.inert = wasInert; });
  easterEggInertState = [];
  easterEggPreviousFocus?.focus?.({ preventScroll: true });
  easterEggOpen = false;
  easterEggCanClose = false;
}
function initEasterEgg() {
  const overlay = document.getElementById("easter-egg-overlay");
  if (!overlay) return;
  overlay.addEventListener("click", event => { if (event.target === overlay) closeEasterEgg(); });
  const closeButton = document.getElementById("easter-egg-close");
  closeButton?.addEventListener("click", closeEasterEgg);
  let taps = 0, lastTap = 0;
  document.getElementById("easter-egg-trigger")?.addEventListener("click", () => {
    const now = Date.now();
    taps = now - lastTap <= 1500 ? taps + 1 : 1;
    lastTap = now;
    if (taps >= 5) { taps = 0; showEasterEgg(); }
  });
  document.addEventListener("visibilitychange", () => {
    overlay.classList.toggle("motion-paused", document.hidden);
  });
  reducedMotionQuery?.addEventListener?.("change", () => { if (easterEggOpen) createConfetti(); });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Tab" && easterEggOpen) {
      event.preventDefault();
      closeButton?.focus();
    }
    if (event.key === "Escape" && easterEggOpen) {
      easterEggCanClose = true;
      closeEasterEgg();
    }
  });
}
function playRandomSong() {
  const songs = Array.from(document.querySelectorAll("#song-list a[href]")).filter(song => !song.hidden);
  if (!songs.length) return;
  const song = songs[Math.floor(Math.random() * songs.length)];
  window.open(song.href, "_blank", "noopener,noreferrer");
}
