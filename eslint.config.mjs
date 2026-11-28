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
    files: ["script.js", "js/**/*.js", "网站海报/*.js", "tools/**/*.{js,mjs,cjs}", "backend/**/*.{js,mjs,cjs}", "eslint.config.mjs"],
    rules: {
      "no-undef": "error",
      "no-use-before-define": ["error", { variables: true, classes: true, functions: false }],
      "no-const-assign": "error",
      "no-dupe-keys": "error",
      "no-dupe-args": "error",
      "no-unreachable": "error",
      "valid-typeof": "error",
      "use-isnan": "error",
      "no-unsafe-negation": "error"
    }
  },
  {
    files: ["script.js", "js/**/*.js", "网站海报/*.js"],
    languageOptions: { sourceType: "script", globals: { ...globals.browser, ...pageGlobals } }
  },
  { files: ["tools/auth-src.js"], languageOptions: { sourceType: "module", globals: globals.browser } },
  {
    files: ["tools/**/*.{js,mjs,cjs}", "backend/**/*.{js,mjs,cjs}", "eslint.config.mjs"],
    ignores: ["tools/auth-src.js"],
    languageOptions: { globals: globals.node }
  }
];
