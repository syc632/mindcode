import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";

export default [
  js.configs.recommended,
  {
    ignores: ["dist/**", "node_modules/**", ".claude/**", "src/.claude/**"],
  },
  {
    files: ["**/*.{js,jsx,mjs,cjs}"],
    plugins: {
      react,
    },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "react/jsx-uses-react": "warn",
      "react/jsx-uses-vars": "warn",
    },
    settings: {
      react: {
        version: "detect",
      },
    },
  },
];
