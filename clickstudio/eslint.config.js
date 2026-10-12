import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import sonarjs from 'eslint-plugin-sonarjs';
import tseslint from 'typescript-eslint';

export default defineConfig([
    {
        ignores: [
            '**/dist/**',
            '**/node_modules/**',
            '**/playwright-report/**',
            '**/test-results/**',
            '**/vendor/**',
            '**/.vercel/**',
            '**/.core-build/**',
            '**/.workspace-build/**',
        ],
    },
    {
        linterOptions: {
            reportUnusedDisableDirectives: 'error',
        },
    },
    {
        files: ['**/*.{js,mjs,cjs,ts,tsx}'],
        extends: [js.configs.recommended, tseslint.configs.recommended],
        plugins: {
            '@stylistic': stylistic,
            sonarjs,
        },
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.node,
            },
        },
        rules: {
            '@stylistic/max-len': [
                'error',
                {
                    code: 100,
                    tabWidth: 4,
                    ignoreUrls: true,
                    ignoreStrings: true,
                    ignoreTemplateLiterals: true,
                    ignoreRegExpLiterals: true,
                },
            ],
            'max-depth': ['error', 6],
            'max-params': ['error', 8],
            'no-empty': ['error', { allowEmptyCatch: true }],
            'no-nested-ternary': 'error',
            'sonarjs/cognitive-complexity': ['error', 25],
            'no-useless-escape': 'off',
            'prefer-const': 'off',
            '@typescript-eslint/no-unused-vars': [
                'error',
                {
                    argsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                },
            ],
        },
    },
    {
        files: ['**/*.{ts,tsx}'],
        languageOptions: {
            parserOptions: {
                project: [
                    './tsconfig.json',
                    './tsconfig.server.json',
                    './tsconfig.e2e.json',
                    './tsconfig.eslint.json',
                ],
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            '@typescript-eslint/consistent-type-imports': [
                'error',
                {
                    disallowTypeAnnotations: false,
                    fixStyle: 'separate-type-imports',
                    prefer: 'type-imports',
                },
            ],
            '@typescript-eslint/no-unsafe-type-assertion': 'error',
            '@typescript-eslint/no-floating-promises': [
                'error',
                {
                    allowForKnownSafeCalls: [
                        {
                            from: 'package',
                            name: 'test',
                            package: 'node:test',
                        },
                    ],
                },
            ],
            '@typescript-eslint/no-misused-promises': 'error',
        },
    },
    {
        files: [
            'src/backend/**/*.{ts,tsx}',
            'src/shared/**/*.{ts,tsx}',
            'scripts/**/*.{js,mjs,cjs,ts,tsx}',
        ],
        rules: {
            complexity: ['error', 50],
            'max-lines-per-function': [
                'error',
                { max: 300, skipBlankLines: true, skipComments: true },
            ],
        },
    },
    {
        files: ['src/frontend/**/*.{ts,tsx}'],
        plugins: {
            'react-hooks': reactHooks,
        },
        rules: {
            complexity: ['error', 50],
            'max-lines-per-function': [
                'error',
                { max: 300, skipBlankLines: true, skipComments: true },
            ],
            'react-hooks/rules-of-hooks': 'error',
            'react-hooks/exhaustive-deps': 'error',
        },
    },
    {
        files: ['src/backend/**/*.{ts,tsx}'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: ['**/frontend/**'],
                            message: 'Backend code can import backend and shared modules.',
                        },
                    ],
                },
            ],
        },
    },
    {
        files: ['src/shared/**/*.{ts,tsx}'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: ['**/frontend/**', '**/backend/**', 'node:*'],
                            message: 'Shared code must work in both the browser and the server.',
                        },
                    ],
                },
            ],
        },
    },
    {
        files: ['src/frontend/**/*.{ts,tsx}'],
        ignores: ['src/frontend/app/main.tsx'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: ['**/backend/**', 'node:*'],
                            message: 'Frontend code can import frontend and shared modules.',
                        },
                        {
                            group: ['**/*.css'],
                            message:
                                'Import application styles through src/frontend/ui/styles/main.css to keep cascade order explicit.',
                        },
                    ],
                },
            ],
        },
    },
]);
