import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
    // 不检查的目录
    { ignores: ['dist/**', 'out/**', 'node_modules/**','src/hello/**']},

    // 基础规则
    js.configs.recommended,

    // TypeScript 规则
    ...tseslint.configs.recommended,

    // 自己的调整
    {
        files: ['**/*.{ts,tsx}'],
        plugins: {'react-hooks': reactHooks},
        rules: {
            ...reactHooks.configs.recommended.rules,
            'no-undef': 'off',

            // 项目场景模板表使用了any
            '@typescript-eslint/no-explicit-any': 'warn',
        },
    },
)