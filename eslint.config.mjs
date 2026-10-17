import globals from "globals";

// Classic browser scripts share these explicitly declared bindings through index.html.
const pageGlobals = {
  SONGS: "readonly", NKNK_GALLERY: "readonly", currentLanguage: "readonly",
  getSongThumbnailUrl: "readonly", updateTagFilter: "readonly",
  enforceCommentFieldLimits: "readonly", unicodeLength: "readonly",
  wallStatic: "writable", reducedMotionQuery: "readonly"
};

export default [
  { ignores: ["**/node_modules/**", "dist/**", "js/auth.js", "inabakumori-site-all-code/**", "artifacts/**"] },
  {
    files: ["script.js", "js/**/*.js", "tools/**/*.{js,mjs,cjs}", "backend/**/*.{js,mjs,cjs}", "eslint.config.mjs"],
    rules: {
      "no-undef": "error",
      "no-use-before-define": ["error", { variables: true, classes: true, functions: false }]
    }
  },
  {
    files: ["script.js", "js/**/*.js"],
    languageOptions: { sourceType: "script", globals: { ...globals.browser, ...pageGlobals } }
  },
  { files: ["tools/auth-src.js"], languageOptions: { sourceType: "module", globals: globals.browser } },
  {
    files: ["tools/**/*.{js,mjs,cjs}", "backend/**/*.{js,mjs,cjs}", "eslint.config.mjs"],
    ignores: ["tools/auth-src.js"],
    languageOptions: { globals: globals.node }
  }
];
