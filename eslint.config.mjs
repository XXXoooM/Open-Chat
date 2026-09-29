import js from '@eslint/js'
import { globalIgnores } from 'eslint/config'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/**
 * ESLint 扁平配置（自持）—— 替代平台预设 `@lark-apaas/coding-presets-react`。
 *
 * 规则集与平台预设**逐条对齐**：`js/recommended` + `typescript-eslint/recommended`
 * + `react-hooks/recommended`（按平台原样关闭 `exhaustive-deps`），以及平台显式
 * 放松的一批规则，使 lint 行为与改造前一致。
 *
 * 与平台预设的差异只有两处，均为「移除平台专有内容」：
 *
 * 1. 不再包含三条**平台脚手架路由约定**规则（`no-welcome-index-route` /
 *    `require-index-route` / `no-duplicate-route-component`）：它们约束的是平台
 *    模板里 app.tsx 的固定结构，且实现位于平台包内。
 * 2. 不再配置 `import/resolver` settings —— 那仅在被启用的 import 规则下生效，
 *    本配置本就没有启用任何 import 规则，因此也无需 eslint-plugin-import 依赖。
 */

/** 基础语法限制规则（与平台预设逐字一致） */
const restrictedSyntaxRules = [
  // 禁止 window.location.href 赋值
  {
    selector:
      'AssignmentExpression[left.object.object.name="window"][left.object.property.name="location"][left.property.name="href"]',
    message:
      "Don't use `window.location.href` to navigate. Use `useNavigate` from 'react-router-dom' instead.",
  },
  // 禁止 location.href 赋值
  {
    selector: 'AssignmentExpression[left.object.name="location"][left.property.name="href"]',
    message:
      "Don't use `location.href` to navigate. Use `useNavigate` from 'react-router-dom' instead.",
  },
  // 禁止 a 标签 href 使用相对路径
  {
    selector:
      "JSXOpeningElement[name.name='a']:has(JSXAttribute[name.name='href'][value.value=/^(?!https?:|\\u002F\\u002F|mailto:|tel:|#).+/])",
    message: "Don't use relative paths in <a> tags. Use NavLink from 'react-router-dom' instead.",
  },
  // Tailwind 4 arbitrary values 不能包含空格的 hsl()
  {
    selector: 'JSXAttribute[name.name="className"][value.value=/\\[hsl\\([^\\]]*\\s[^\\]]*\\)/]',
    message:
      'Tailwind 4 arbitrary values cannot contain spaces. Replace spaces with underscores in hsl() values.',
  },
  // Tailwind 4 arbitrary values 不能包含空格的 rgb()
  {
    selector: 'JSXAttribute[name.name="className"][value.value=/\\[rgb\\([^\\]]*\\s[^\\]]*\\)/]',
    message:
      'Tailwind 4 arbitrary values cannot contain spaces. Replace spaces with underscores in rgb() values.',
  },
]

export default [
  globalIgnores([
    'dist',
    'node_modules',
    '**/components/ui/**',
    '**/__tests__/**',
    '**/*.test.{js,jsx,ts,tsx}',
    '**/*.spec.{js,jsx,ts,tsx}',
  ]),
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    name: 'open-chat/client',
    languageOptions: {
      ecmaVersion: 2020,
      parser: tseslint.parser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      // React Hooks
      ...reactHooks.configs.recommended.rules,
      'react-hooks/exhaustive-deps': 'off',
      // TypeScript（宽松模式，与平台预设一致）
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-interface': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-redeclare': 'error',
      '@typescript-eslint/no-unsafe-function-type': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      // JavaScript 基础
      'no-undef': 'off',
      'no-empty': 'off',
      'no-unused-labels': 'off',
      'no-console': 'off',
      'prefer-const': 'off',
      'no-control-regex': 'off',
      'no-useless-escape': 'off',
      'no-case-declarations': 'off',
      'no-constant-binary-expression': 'off',
      // 禁止导入 next/link
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'next/link',
              message:
                "Importing from 'next/link' is prohibited. Use `Link` from 'react-router-dom' instead.",
            },
          ],
        },
      ],
      // 语法限制
      'no-restricted-syntax': ['error', ...restrictedSyntaxRules],
    },
  },
  {
    /**
     * SpaceUI 目录分区守卫（见 SPACEUI_INTEGRATION.md §1.2）。
     *
     * 两套无头原语（既有 Radix / 新增 Base UI）必须分区：SpaceUI 组件不得反向引用
     * 既有界面原语，否则会因 `asChild`（Radix）与 `render`（Base UI）语义不兼容而运行时报错。
     *
     * 注意：`no-restricted-imports` 在上方已全局启用于 `next/link`，且**文件级配置会整体
     * 覆盖全局配置**，因此这里必须把 `next/link` 的约束一并带上，否则 SpaceUI 目录会成为
     * 唯一可以导入 next/link 的豁免区。
     */
    name: 'open-chat/spaceui-boundary',
    files: ['src/components/spaceui/**/*.{ts,tsx}', 'src/components/orb/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'next/link',
              message:
                "Importing from 'next/link' is prohibited. Use `Link` from 'react-router-dom' instead.",
            },
          ],
          patterns: [
            {
              group: ['@/components/ui/*', '@/components/ui'],
              message:
                'SpaceUI 组件请使用改道原语 @/components/spaceui/ui/*，不要引用既有界面原语（两套无头库语义不兼容）。',
            },
          ],
        },
      ],
    },
  },
]
