require('@rushstack/eslint-patch/modern-module-resolution');

const next = require('eslint-config-next');

/** @type {import('eslint').Linter.FlatConfig[]} */
module.exports = [
	{
		ignores: [
			'**/node_modules/**',
			'.next/**',
			'out/**',
			'dist/**',
			'build/**',
			'coverage/**',
			'**/*.min.*',
			'package-lock.json',
			'tsconfig.tsbuildinfo',
		],
	},
	...next,
	{
		rules: {
			'no-console': ['warn', { allow: ['warn', 'error'] }],
			'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
			'react/jsx-key': 'off',
		},
	},
];


