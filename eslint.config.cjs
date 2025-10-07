require('@rushstack/eslint-patch/modern-module-resolution');

const nextConfig = require('eslint-config-next');
const nextFlat = Array.isArray(nextConfig)
	? nextConfig
	: (nextConfig && nextConfig.default ? nextConfig.default : []);

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
	...nextFlat,
	{
		rules: {
			'no-console': ['warn', { allow: ['warn', 'error'] }],
			'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
			'react/jsx-key': 'off',
		},
	},
];


