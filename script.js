let currentLanguage = localStorage.getItem("language") || "zh";
let currentTheme = localStorage.getItem("theme") || "light";
let currentSlide = 0;
const COMMENTS_API = `${window.APP_CONFIG.apiDomain}/api/comments`;
function applyLanguage() {
  document.querySelectorAll("[data-zh][data-en]").forEach((element) => {
    element.innerText = element.dataset[currentLanguage];
  });
  document.querySelectorAll("[data-href-zh][data-href-en]").forEach((element) => {
    const href = currentLanguage === "zh" ? element.dataset.hrefZh : element.dataset.hrefEn;
    if (href) {
      element.setAttribute("href", href);
    }
  });
  const glitchTitle = document.querySelector(".glitch");
  if (glitchTitle) {
    glitchTitle.setAttribute("data-text", glitchTitle.dataset[currentLanguage]);
  }
  const langButton = document.getElementById("lang-btn");
  if (langButton) {
    langButton.innerText = currentLanguage === "zh" ? "English" : "中文";
  }
  const nameInput = document.getElementById("message-name");
  const messageInput = document.getElementById("message-input");
  if (nameInput) {
    nameInput.placeholder = currentLanguage === "zh" ? "你的名字 / Name" : "Your name";
  }
  if (messageInput) {
    messageInput.placeholder = currentLanguage === "zh" ? "想对稲葉曇说些什么？" : "Say something to Inabakumori...";
  }
  updateMessageLoadStatus();
  document.documentElement.lang = currentLanguage === "zh" ? "zh-CN" : "en";
  window.dispatchEvent(new Event("languagechange"));
  document.querySelectorAll(".floating-message").forEach((element) => {
    element.refreshLanguage?.();
  });
}
function toggleLanguage() {
  currentLanguage = currentLanguage === "zh" ? "en" : "zh";
  localStorage.setItem("language", currentLanguage);
  applyLanguage();
  if (typeof updateTagLanguage === "function") {
    updateTagLanguage();
  }
}
function applyTheme() {
  const themeButton = document.getElementById("theme-btn");
  document.body.classList.toggle("dark", currentTheme === "dark");
  if (themeButton) {
    themeButton.innerText = currentTheme === "dark" ? "☀" : "☾";
  }
}
function toggleTheme() {
  currentTheme = currentTheme === "light" ? "dark" : "light";
  localStorage.setItem("theme", currentTheme);
  applyTheme();
}
const HERO_IMAGE_FOLDER = "images/hero/";
const heroImages = ["images/hero/001.png", "images/hero/002.png", "images/hero/003.png", "images/hero/004.png", "images/hero/005.png", "images/hero/006.png", "images/hero/007.png", "images/hero/008.png", "images/hero/009.png", "images/hero/010.png", "images/hero/011.png", "images/hero/012.png", "images/hero/013.png", "images/hero/014.png", "images/hero/015.png", "images/hero/016.png", "images/hero/017.png", "images/hero/018.png", "images/hero/019.png", "images/hero/020.png", "images/hero/021.png", "images/hero/022.png", "images/hero/023.png", "images/hero/024.png", "images/hero/025.png", "images/hero/026.png", "images/hero/027.png", "images/hero/028.png", "images/hero/029.png", "images/hero/030.png", "images/hero/031.png", "images/hero/032.png", "images/hero/033.png", "images/hero/034.png", "images/hero/035.png", "images/hero/036.png", "images/hero/037.png", "images/hero/038.png", "images/hero/039.png", "images/hero/040.png", "images/hero/041.png", "images/hero/042.png", "images/hero/043.png", "images/hero/044.png", "images/hero/045.png", "images/hero/046.png", "images/hero/047.png", "images/hero/048.png", "images/hero/049.png", "images/hero/050.png", "images/hero/051.png", "images/hero/052.png", "images/hero/053.png", "images/hero/054.png", "images/hero/055.png", "images/hero/056.png", "images/hero/057.png", "images/hero/058.png", "images/hero/059.png"];
function preloadNextHeroImage() {
  const image = new Image();
  image.src = heroImages[(currentSlide + 1) % heroImages.length];
}
function discoverHeroImages() {
  preloadNextHeroImage();
}
function changeHeroSlide() {
  if (easterEggOpen) {
    return;
  }
  const heroSlide = document.getElementById("hero-slide");
  if (!heroSlide || !heroImages.length) {
    return;
  }
  if (heroImages.length === 1) {
    easterEggHeroComplete = true;
    return;
  }
  currentSlide = (currentSlide + 1) % heroImages.length;
  heroSlide.src = heroImages[currentSlide];
  preloadNextHeroImage();
  if (!easterEggHeroComplete && currentSlide === heroImages.length - 1) {
    easterEggHeroComplete = true;
  }
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
  if (status) {
    const text = { loading: ["正在加载留言…", "Loading messages…"], error: ["留言加载失败，请检查连接后重试。", "Could not load messages. Check your connection and retry."], empty: ["还没有留言，留下第一条讯息吧。", "No messages yet. Leave the first one."], ready: ["", ""], idle: ["", ""] };
    status.textContent = text[messageLoadState][currentLanguage === "zh" ? 0 : 1];
  }
  if (retry) retry.hidden = messageLoadState !== "error";
}
async function addMessage() {
  if (messageSubmitting) return;
  const nameInput = document.getElementById("message-name");
  const messageInput = document.getElementById("message-input");
  if (!nameInput || !messageInput) return;
  const nickname = nameInput.value.trim();
  const content = messageInput.value.trim();
  if (!nickname || !content) {
    alert(currentLanguage === "zh" ? !nickname ? "请输入昵称。" : "请输入留言内容。" : !nickname ? "Please enter your name." : "Please enter a message.");
    (!nickname ? nameInput : messageInput).focus();
    return;
  }
  const button = document.querySelector(".message-box button");
  const originalName = nameInput.value;
  const originalContent = messageInput.value;
  messageSubmitting = true;
  if (button) button.disabled = true;
  try {
    const response = await fetch(COMMENTS_API, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ nickname, content }) });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || (currentLanguage === "zh" ? "留言发布失败。" : "Failed to post your message."));
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
    window.dispatchEvent(new Event("commentposted"));
  } catch (error) {
    console.error("留言发布失败：", error);
    alert(error instanceof TypeError || error instanceof SyntaxError ? currentLanguage === "zh" ? "无法连接服务器或响应异常，请稍后重试。" : "The server is unavailable or returned an invalid response. Please try again." : error.message);
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
    const response = await fetch(COMMENTS_API, { credentials: "include" });
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
const messageTracks = [];
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
    const identity = message.isGuest === true ? currentLanguage === "zh" ? " [游客]" : " [Guest]" : message.isGuest === false ? currentLanguage === "zh" ? " [已登录]" : " [Member]" : "";
    element.textContent = (message.nickname || message.name || "Anonymous") + identity + "： " + (message.content || message.text || "");
    if (element.isConnected) element.refreshLayout();
  };
  element.refreshLayout = () => {
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
    animation.currentTime = progress * duration;
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
setInterval(removeExpiredMessages, 1e3);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) removeExpiredMessages();
});
window.addEventListener("resize", () => {
  document.querySelectorAll(".floating-message").forEach((element) => element.refreshLayout());
});
const OTHER_SINGER_TAG = "其他";
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
  return names.en || fallback || String(tag || "");
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
    const zhCount = new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(song.viewCount);
    const enCount = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(song.viewCount);
    views.dataset.zh = `YouTube · 约 ${zhCount} 次播放 · 统计于 ${song.viewsCheckedAt}`;
    views.dataset.en = `YouTube · ~${enCount} views · As of ${song.viewsCheckedAt}`;
    views.textContent = views.dataset[currentLanguage];
    const exactCount = song.viewCount.toLocaleString("en-US");
    views.title = `${exactCount} 次播放 / views · ${song.viewsCheckedAt}`;
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
function fuzzyTagMatches(queryToken, canonicalTag) {
  const queryText = normalizeTagSearchText(queryToken);
  const canonical = normalizeTag(canonicalTag);
  if (!queryText || !canonical) {
    return false;
  }
  if (normalizeTag(queryText) === canonical) {
    return true;
  }
  const searchTerms = new Set([canonical, getTagDisplayLabel(canonical), getTagInputLabel(canonical, canonical)]);
  Object.entries(TAG_ALIASES).forEach(([alias, target]) => {
    if (normalizeTag(target) === canonical) {
      searchTerms.add(alias);
    }
  });
  const needle = normalizeTagSearchText(queryText);
  return [...searchTerms].some((term) => normalizeTagSearchText(term).includes(needle));
}
function songMatchesTags(songTags, query) {
  const { plain, required } = query;
  const requiredMatched = required.every((queryToken) => songTags.some((songTag) => fuzzyTagMatches(queryToken, songTag)));
  if (!requiredMatched) {
    return false;
  }
  if (!plain.length) {
    return true;
  }
  return plain.some((queryToken) => songTags.some((songTag) => fuzzyTagMatches(queryToken, songTag)));
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
    const priority = new Map([[normalizeTag("ANTICYCLONE"), 0], [normalizeTag("WEATHER STATION"), 1], [normalizeTag("SINGLES"), 2]]);
    const aPriority = priority.has(a[0]) ? priority.get(a[0]) : 10;
    const bPriority = priority.has(b[0]) ? priority.get(b[0]) : 10;
    if (aPriority !== bPriority) {
      return aPriority - bPriority;
    }
    if (a[0] === normalizeTag(OTHER_SINGER_TAG)) {
      return 1;
    }
    if (b[0] === normalizeTag(OTHER_SINGER_TAG)) {
      return -1;
    }
    return a[1].localeCompare(b[1], currentLanguage === "zh" ? "zh-CN" : "en", { sensitivity: "base" });
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
  container.innerHTML = "";
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
    const matched = songMatchesSearch(link, query);
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
    count.textContent = currentLanguage === "zh" ? `显示 ${visibleSongs} / ${totalSongs} 首` : `Showing ${visibleSongs} / ${totalSongs} songs`;
  }
  renderTagSuggestions();
}
function updateTagLanguage() {
  const input = document.getElementById("tag-filter-input");
  if (input) {
    input.placeholder = currentLanguage === "zh" ? "搜索歌名或 TAG，例如：ラグ / 歌爱 / yuki" : "Search titles or tags, e.g. ラグ / yuki / weather";
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
  loadMessages();
  const heroBg = document.getElementById("hero-bg");
  if (heroBg) {
    heroBg.addEventListener("mousedown", (event) => {
      if (event.button === 0 || event.button === 2) {
        event.preventDefault();
        changeHeroSlide();
      }
    });
    heroBg.addEventListener("contextmenu", (event) => {
      event.preventDefault();
    });
  }
  console.log("✅ Fanswalll loaded");
});
const MEME_COUNT = 6;
const MEME_FOLDER = "images/memes/";
let easterEggOpen = false;
let easterEggCanClose = false;
let easterEggCloseTimer = null;
let easterEggHeroComplete = false;
let easterEggRelatedClicked = false;
let easterEggTriggered = false;
let easterEggPendingReturn = false;
let easterEggVisitorLeftPage = false;
function resetEasterEggProgress() {
  easterEggHeroComplete = false;
  easterEggRelatedClicked = false;
  easterEggTriggered = false;
  easterEggPendingReturn = false;
  easterEggVisitorLeftPage = false;
}
function showEasterEgg() {
  const overlay = document.getElementById("easter-egg-overlay");
  const image = document.getElementById("easter-egg-image");
  if (!overlay || !image) return;
  const randomNumber = Math.floor(Math.random() * MEME_COUNT) + 1;
  const filename = String(randomNumber).padStart(3, "0") + ".png";
  image.src = MEME_FOLDER + filename;
  image.alt = currentLanguage === "zh" ? `随机表情包 ${randomNumber}` : `Random meme ${randomNumber}`;
  easterEggOpen = true;
  easterEggCanClose = false;
  overlay.classList.add("show");
  overlay.setAttribute("aria-hidden", "false");
  createConfetti();
  clearTimeout(easterEggCloseTimer);
  easterEggCloseTimer = setTimeout(() => {
    easterEggCanClose = true;
  }, 650);
}
function createConfetti() {
  const layer = document.getElementById("confetti-layer");
  if (!layer) return;
  layer.innerHTML = "";
  const amount = 76;
  const colors = ["#ffffff", "#eeeeee", "#d8d8d8", "#f4cbd7", "#d9c7e8"];
  for (let i = 0; i < amount; i++) {
    const piece = document.createElement("div");
    piece.className = "confetti-piece";
    const angle = Math.random() * Math.PI * 2;
    const distance = 130 + Math.random() * 390;
    const x = Math.cos(angle) * distance;
    const y = Math.sin(angle) * distance;
    piece.style.setProperty("--x", `${x}px`);
    piece.style.setProperty("--y", `${y}px`);
    piece.style.setProperty("--rotate", `${Math.random() * 900 - 450}deg`);
    piece.style.setProperty("--delay", `${Math.random() * 0.12}s`);
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    const size = 7 + Math.random() * 8;
    piece.style.width = `${size}px`;
    piece.style.height = `${size * 1.45}px`;
    layer.appendChild(piece);
  }
  setTimeout(() => {
    layer.innerHTML = "";
  }, 2200);
}
function closeEasterEgg() {
  if (!easterEggOpen || !easterEggCanClose) return;
  const overlay = document.getElementById("easter-egg-overlay");
  if (!overlay) return;
  overlay.classList.remove("show");
  overlay.setAttribute("aria-hidden", "true");
  easterEggOpen = false;
  easterEggCanClose = false;
  currentSlide = 0;
  const heroSlide = document.getElementById("hero-slide");
  if (heroSlide && heroImages.length) {
    heroSlide.src = heroImages[0];
  }
  resetEasterEggProgress();
}
function initEasterEgg() {
  const overlay = document.getElementById("easter-egg-overlay");
  if (!overlay) return;
  overlay.addEventListener("click", closeEasterEgg);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && easterEggOpen) {
      easterEggCanClose = true;
      closeEasterEgg();
    }
  });
  document.querySelectorAll(".artist-links a").forEach((link) => {
    link.addEventListener("click", () => {
      if (!easterEggHeroComplete || easterEggTriggered) {
        return;
      }
      easterEggRelatedClicked = true;
    });
  });
  const songList = document.getElementById("song-list");
  if (songList) {
    songList.addEventListener("click", (event) => {
      const songLink = event.target.closest("a");
      if (!songLink || !songList.contains(songLink)) {
        return;
      }
      if (!easterEggHeroComplete || !easterEggRelatedClicked || easterEggTriggered || easterEggOpen) {
        return;
      }
      easterEggTriggered = true;
      easterEggPendingReturn = true;
      easterEggVisitorLeftPage = false;
    });
  }
  document.addEventListener("visibilitychange", () => {
    if (easterEggPendingReturn && document.hidden) {
      easterEggVisitorLeftPage = true;
      return;
    }
    if (easterEggPendingReturn && easterEggVisitorLeftPage && document.visibilityState === "visible" && !easterEggOpen) {
      easterEggPendingReturn = false;
      showEasterEgg();
    }
  });
  window.addEventListener("blur", () => {
    if (easterEggPendingReturn) {
      easterEggVisitorLeftPage = true;
    }
  });
  window.addEventListener("focus", () => {
    if (easterEggPendingReturn && easterEggVisitorLeftPage && document.visibilityState === "visible" && !easterEggOpen) {
      easterEggPendingReturn = false;
      showEasterEgg();
    }
  });
}
function playRandomSong() {
  const songs = Array.from(document.querySelectorAll("#song-list a[href]"));
  if (!songs.length) return;
  const song = songs[Math.floor(Math.random() * songs.length)];
  window.open(song.href, "_blank", "noopener,noreferrer");
}
