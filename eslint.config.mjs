import antfu from '@antfu/eslint-config'

export default antfu({
  formatters: true,
  rules: {
    'no-console': 'off',
    'no-unused-vars': 'off',
    'unused-imports/no-unused-vars': 'off',
    'no-async-promise-executor': 'off',
    'e18e/prefer-object-has-own': 'off',
    'e18e/prefer-static-regex': 'off',
  },
})
