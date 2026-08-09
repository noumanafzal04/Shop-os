import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      // `const { [p.id]: _drop, ...rest } = drafts` is how this codebase removes
      // a key without mutating, and `({ _key, ...v }) => v` is how it strips a
      // client-only field before POSTing. The binding is meant to go unread —
      // that IS the idiom — so an underscore marks intent, not an oversight.
      // Without this the rule fires on correct code, and a lint gate that is
      // permanently red is a gate nobody reads.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    // `declare module "*.svg?react"` has to reach React with import-equals
    // syntax; there is no ESM spelling of it inside an ambient declaration. A
    // .d.ts emits nothing, so the hazard this rule guards against — a CommonJS
    // require surviving into the bundle — cannot occur here.
    files: ['**/*.d.ts'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
)
