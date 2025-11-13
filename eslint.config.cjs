require('@rushstack/eslint-patch/modern-module-resolution');

const nextConfig = require('eslint-config-next');
const nextFlat = Array.isArray(nextConfig)
	? nextConfig
	: (nextConfig && nextConfig.default ? nextConfig.default : []);

const path = require('path');

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
			'.vercel/**',
			'**/*.min.*',
			'**/*.generated.*',
			'package-lock.json',
			'tsconfig.tsbuildinfo',
			'cleanup-orphaned-users.js',
			'scripts/check-server-api-usage.*',
			// Ignore data files
			'data/**',
			'eval/**',
			'reports/**',
			// Windows system directories that cause permission errors
			'**/AppData/**',
			'**/ElevatedDiagnostics/**',
			// Ignore anything outside the project root
			'../**',
			'../../**',
		],
	},
	...nextFlat,
	{
		files: ['**/*.{js,jsx,ts,tsx}'],
		languageOptions: {
			parser: require('@typescript-eslint/parser'),
			parserOptions: {
				ecmaVersion: 'latest',
				sourceType: 'module',
				ecmaFeatures: {
					jsx: true,
				},
			},
		},
		plugins: {
			'@typescript-eslint': require('@typescript-eslint/eslint-plugin'),
		},
		rules: {
			'no-console': ['warn', { allow: ['warn', 'error'] }],
			'no-unused-vars': 'off',
			'@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
			'react/jsx-key': 'off',
		},
	},
	// Guard against server-side fetch to internal API using a precise AST selector (no regex)
	{
		files: ['src/app/**/*.{ts,tsx}'],
		rules: {
			'no-restricted-syntax': [
				'warn',
				{
					// Match any fetch(...) call that includes a string literal argument starting with '/api/'
					selector: "CallExpression[callee.name='fetch'] Literal[value^='/api/']",
					message:
						"Do not fetch('/api/...') from server components or server code. Import and call server libs instead.",
				},
			],
		},
	},
		{
			files: ['src/**/*.{js,jsx,ts,tsx}'],
			rules: {
				'no-restricted-imports': [
					'error',
					{
						patterns: [
							{
								group: ['**/data/usda/*.json'],
								message: 'Do not import USDA data files directly. Use the server-only reader in lib/usda/reader.server.ts instead.',
							},
						],
					},
				],
			},
		},
	// Removed broad global fetch restrictions to prevent false positives; the targeted selector above is sufficient
	{
		files: ['scripts/**/*.{js,ts}', '**/*.test.{js,ts}', '**/*.spec.{js,ts}', 'prisma/**/*.js'],
		rules: {
			'no-console': 'off',
		},
	},
];


