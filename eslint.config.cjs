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
			'.vercel/**',
			'**/*.min.*',
			'**/*.generated.*',
			'package-lock.json',
			'tsconfig.tsbuildinfo',
			'cleanup-orphaned-users.js',
			'scripts/check-server-api-usage.*',
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
	// Guard against server-side fetch to internal API without using regex in selector (avoid esquery regex crashes)
	{
		files: ['src/app/**/*.{ts,tsx}'],
		rules: {
			'no-restricted-syntax': [
				'warn',
				{
					selector: "CallExpression[callee.name='fetch'] > Literal:first-child",
					message:
						"Avoid fetch('/api/...') in server components. Use server libs instead (client components may call /api).",
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
	{
		files: ['src/app/**/*.{ts,tsx}'],
		rules: {
			'no-restricted-properties': [
				'warn',
				{
					object: 'globalThis',
					property: 'fetch',
					message: 'Avoid fetch("/api/...") in Server Components. Call server libs directly.',
				},
			],
			'no-restricted-imports': [
				'warn',
				{
					patterns: [
						{
							group: ['**/api/**'],
							message: 'Ensure API calls are not made from server components; import server libs instead.',
						},
					],
				},
			],
		},
	},
	{
		files: ['scripts/**/*.{js,ts}', '**/*.test.{js,ts}', '**/*.spec.{js,ts}', 'prisma/**/*.js'],
		rules: {
			'no-console': 'off',
		},
	},
];


