import { reactLibraryConfig } from "@arc0/eslint-config/react-library";
import expoConfig from "eslint-config-expo/flat";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...expoConfig,
  ...reactLibraryConfig,
  {
    ignores: ["dist/**", "android/**", "ios/**", ".expo/**"],
  },
  {
    rules: {
      "import/no-unresolved": "off", // TypeScript handles path resolution
    },
  },
];
