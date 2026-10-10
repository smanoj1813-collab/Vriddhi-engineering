module.exports = {
  root: true,
  env: {
    es6: true,
    node: true,
  },
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: ["tsconfig.json", "tsconfig.dev.json"],
    sourceType: "module",
  },
  ignorePatterns: [
    "/lib/**/*",
    "/generated/**/*",
    "/test/**/*",
    "**/*.js",
  ],
  plugins: [
    "@typescript-eslint",
  ],
  rules: {
    "quotes": "off",
    "indent": "off",
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-var-requires": "off",
    "@typescript-eslint/no-unused-vars": ["warn", {
      "argsIgnorePattern": "^_",
      "varsIgnorePattern": "^_",
      "destructuredArrayIgnorePattern": "^_",
      "caughtErrorsIgnorePattern": "^_",
      "ignoreRestSiblings": true,
    }],
  },
};
