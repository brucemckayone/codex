
// this file is generated — do not edit it


/// <reference types="@sveltejs/kit" />

/**
 * Environment variables [loaded by Vite](https://vitejs.dev/guide/env-and-mode.html#env-files) from `.env` files and `process.env`. Like [`$env/dynamic/private`](https://svelte.dev/docs/kit/$env-dynamic-private), this module cannot be imported into client-side code. This module only includes variables that _do not_ begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) _and do_ start with [`config.kit.env.privatePrefix`](https://svelte.dev/docs/kit/configuration#env) (if configured).
 * 
 * _Unlike_ [`$env/dynamic/private`](https://svelte.dev/docs/kit/$env-dynamic-private), the values exported from this module are statically injected into your bundle at build time, enabling optimisations like dead code elimination.
 * 
 * ```ts
 * import { API_KEY } from '$env/static/private';
 * ```
 * 
 * Note that all environment variables referenced in your code should be declared (for example in an `.env` file), even if they don't have a value until the app is deployed:
 * 
 * ```
 * MY_FEATURE_FLAG=""
 * ```
 * 
 * You can override `.env` values from the command line like so:
 * 
 * ```sh
 * MY_FEATURE_FLAG="enabled" npm run dev
 * ```
 */
declare module '$env/static/private' {
	export const npm_package_scripts_test_e2e: string;
	export const NoDefaultCurrentDirectoryInExePath: string;
	export const VSCODE_CRASH_REPORTER_PROCESS_TYPE: string;
	export const CLAUDE_CODE_ENTRYPOINT: string;
	export const NODE: string;
	export const INIT_CWD: string;
	export const npm_package_devDependencies_typescript: string;
	export const SHELL: string;
	export const npm_package_devDependencies_vite: string;
	export const VSCODE_PROCESS_TITLE: string;
	export const HOMEBREW_REPOSITORY: string;
	export const TMPDIR: string;
	export const npm_package_dependencies__codex_cloudflare_clients: string;
	export const npm_package_scripts_dev: string;
	export const CURSOR_TRACE_ID: string;
	export const MallocNanoZone: string;
	export const ORIGINAL_XDG_CURRENT_DESKTOP: string;
	export const CLAUDE_AGENT_SDK_VERSION: string;
	export const npm_package_private: string;
	export const npm_package_devDependencies__sveltejs_kit: string;
	export const npm_config_registry: string;
	export const GIT_EDITOR: string;
	export const USER: string;
	export const npm_config_recursive: string;
	export const npm_package_scripts_check_watch: string;
	export const npm_package_dependencies__codex_auth: string;
	export const COMMAND_MODE: string;
	export const OPENAI_API_KEY: string;
	export const PNPM_SCRIPT_SRC_DIR: string;
	export const npm_package_dependencies__codex_notifications: string;
	export const npm_package_dependencies_happy_dom: string;
	export const SSH_AUTH_SOCK: string;
	export const __CF_USER_TEXT_ENCODING: string;
	export const npm_execpath: string;
	export const npm_package_dependencies__codex_validation: string;
	export const npm_package_devDependencies__testing_library_svelte: string;
	export const npm_package_devDependencies_svelte: string;
	export const ELECTRON_RUN_AS_NODE: string;
	export const npm_config_frozen_lockfile: string;
	export const PATH: string;
	export const LaunchInstanceID: string;
	export const __CFBundleIdentifier: string;
	export const PWD: string;
	export const npm_command: string;
	export const VSCODE_HANDLES_UNCAUGHT_ERRORS: string;
	export const npm_package_scripts_preview: string;
	export const npm_package_scripts_test_watch: string;
	export const VSCODE_ESM_ENTRYPOINT: string;
	export const OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE: string;
	export const npm_lifecycle_event: string;
	export const npm_package_name: string;
	export const npm_package_devDependencies__sveltejs_vite_plugin_svelte: string;
	export const NODE_PATH: string;
	export const npm_package_scripts_build: string;
	export const XPC_FLAGS: string;
	export const npm_package_dependencies__codex_database: string;
	export const npm_package_devDependencies_vitest: string;
	export const FORCE_COLOR: string;
	export const npm_package_scripts_test_e2e_ui: string;
	export const npm_config_node_gyp: string;
	export const XPC_SERVICE_NAME: string;
	export const pnpm_config_verify_deps_before_run: string;
	export const npm_package_version: string;
	export const npm_package_devDependencies__sveltejs_adapter_auto: string;
	export const DEBUG_COLORS: string;
	export const npm_package_devDependencies_svelte_check: string;
	export const HOME: string;
	export const SHLVL: string;
	export const npm_package_type: string;
	export const npm_package_scripts_test: string;
	export const VSCODE_NLS_CONFIG: string;
	export const HOMEBREW_PREFIX: string;
	export const LOGNAME: string;
	export const npm_package_scripts_test_coverage: string;
	export const npm_lifecycle_script: string;
	export const VSCODE_CODE_CACHE_PATH: string;
	export const VSCODE_IPC_HOOK: string;
	export const COREPACK_ENABLE_AUTO_PIN: string;
	export const BROWSER: string;
	export const VSCODE_PID: string;
	export const PLAYWRIGHT_TEST: string;
	export const npm_package_dependencies__codex_core_services: string;
	export const npm_config_user_agent: string;
	export const HOMEBREW_CELLAR: string;
	export const INFOPATH: string;
	export const npm_package_devDependencies__playwright_test: string;
	export const SECURITYSESSIONID: string;
	export const VSCODE_CWD: string;
	export const VSCODE_L10N_BUNDLE_LOCATION: string;
	export const DEBUG: string;
	export const CLAUDECODE: string;
	export const npm_package_scripts_check: string;
	export const npm_package_devDependencies__testing_library_jest_dom: string;
	export const npm_config_prefix: string;
	export const npm_node_execpath: string;
	export const NODE_ENV: string;
}

/**
 * Similar to [`$env/static/private`](https://svelte.dev/docs/kit/$env-static-private), except that it only includes environment variables that begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) (which defaults to `PUBLIC_`), and can therefore safely be exposed to client-side code.
 * 
 * Values are replaced statically at build time.
 * 
 * ```ts
 * import { PUBLIC_BASE_URL } from '$env/static/public';
 * ```
 */
declare module '$env/static/public' {
	
}

/**
 * This module provides access to runtime environment variables, as defined by the platform you're running on. For example if you're using [`adapter-node`](https://github.com/sveltejs/kit/tree/main/packages/adapter-node) (or running [`vite preview`](https://svelte.dev/docs/kit/cli)), this is equivalent to `process.env`. This module only includes variables that _do not_ begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) _and do_ start with [`config.kit.env.privatePrefix`](https://svelte.dev/docs/kit/configuration#env) (if configured).
 * 
 * This module cannot be imported into client-side code.
 * 
 * ```ts
 * import { env } from '$env/dynamic/private';
 * console.log(env.DEPLOYMENT_SPECIFIC_VARIABLE);
 * ```
 * 
 * > [!NOTE] In `dev`, `$env/dynamic` always includes environment variables from `.env`. In `prod`, this behavior will depend on your adapter.
 */
declare module '$env/dynamic/private' {
	export const env: {
		npm_package_scripts_test_e2e: string;
		NoDefaultCurrentDirectoryInExePath: string;
		VSCODE_CRASH_REPORTER_PROCESS_TYPE: string;
		CLAUDE_CODE_ENTRYPOINT: string;
		NODE: string;
		INIT_CWD: string;
		npm_package_devDependencies_typescript: string;
		SHELL: string;
		npm_package_devDependencies_vite: string;
		VSCODE_PROCESS_TITLE: string;
		HOMEBREW_REPOSITORY: string;
		TMPDIR: string;
		npm_package_dependencies__codex_cloudflare_clients: string;
		npm_package_scripts_dev: string;
		CURSOR_TRACE_ID: string;
		MallocNanoZone: string;
		ORIGINAL_XDG_CURRENT_DESKTOP: string;
		CLAUDE_AGENT_SDK_VERSION: string;
		npm_package_private: string;
		npm_package_devDependencies__sveltejs_kit: string;
		npm_config_registry: string;
		GIT_EDITOR: string;
		USER: string;
		npm_config_recursive: string;
		npm_package_scripts_check_watch: string;
		npm_package_dependencies__codex_auth: string;
		COMMAND_MODE: string;
		OPENAI_API_KEY: string;
		PNPM_SCRIPT_SRC_DIR: string;
		npm_package_dependencies__codex_notifications: string;
		npm_package_dependencies_happy_dom: string;
		SSH_AUTH_SOCK: string;
		__CF_USER_TEXT_ENCODING: string;
		npm_execpath: string;
		npm_package_dependencies__codex_validation: string;
		npm_package_devDependencies__testing_library_svelte: string;
		npm_package_devDependencies_svelte: string;
		ELECTRON_RUN_AS_NODE: string;
		npm_config_frozen_lockfile: string;
		PATH: string;
		LaunchInstanceID: string;
		__CFBundleIdentifier: string;
		PWD: string;
		npm_command: string;
		VSCODE_HANDLES_UNCAUGHT_ERRORS: string;
		npm_package_scripts_preview: string;
		npm_package_scripts_test_watch: string;
		VSCODE_ESM_ENTRYPOINT: string;
		OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE: string;
		npm_lifecycle_event: string;
		npm_package_name: string;
		npm_package_devDependencies__sveltejs_vite_plugin_svelte: string;
		NODE_PATH: string;
		npm_package_scripts_build: string;
		XPC_FLAGS: string;
		npm_package_dependencies__codex_database: string;
		npm_package_devDependencies_vitest: string;
		FORCE_COLOR: string;
		npm_package_scripts_test_e2e_ui: string;
		npm_config_node_gyp: string;
		XPC_SERVICE_NAME: string;
		pnpm_config_verify_deps_before_run: string;
		npm_package_version: string;
		npm_package_devDependencies__sveltejs_adapter_auto: string;
		DEBUG_COLORS: string;
		npm_package_devDependencies_svelte_check: string;
		HOME: string;
		SHLVL: string;
		npm_package_type: string;
		npm_package_scripts_test: string;
		VSCODE_NLS_CONFIG: string;
		HOMEBREW_PREFIX: string;
		LOGNAME: string;
		npm_package_scripts_test_coverage: string;
		npm_lifecycle_script: string;
		VSCODE_CODE_CACHE_PATH: string;
		VSCODE_IPC_HOOK: string;
		COREPACK_ENABLE_AUTO_PIN: string;
		BROWSER: string;
		VSCODE_PID: string;
		PLAYWRIGHT_TEST: string;
		npm_package_dependencies__codex_core_services: string;
		npm_config_user_agent: string;
		HOMEBREW_CELLAR: string;
		INFOPATH: string;
		npm_package_devDependencies__playwright_test: string;
		SECURITYSESSIONID: string;
		VSCODE_CWD: string;
		VSCODE_L10N_BUNDLE_LOCATION: string;
		DEBUG: string;
		CLAUDECODE: string;
		npm_package_scripts_check: string;
		npm_package_devDependencies__testing_library_jest_dom: string;
		npm_config_prefix: string;
		npm_node_execpath: string;
		NODE_ENV: string;
		[key: `PUBLIC_${string}`]: undefined;
		[key: `${string}`]: string | undefined;
	}
}

/**
 * Similar to [`$env/dynamic/private`](https://svelte.dev/docs/kit/$env-dynamic-private), but only includes variables that begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) (which defaults to `PUBLIC_`), and can therefore safely be exposed to client-side code.
 * 
 * Note that public dynamic environment variables must all be sent from the server to the client, causing larger network requests — when possible, use `$env/static/public` instead.
 * 
 * ```ts
 * import { env } from '$env/dynamic/public';
 * console.log(env.PUBLIC_DEPLOYMENT_SPECIFIC_VARIABLE);
 * ```
 */
declare module '$env/dynamic/public' {
	export const env: {
		[key: `PUBLIC_${string}`]: string | undefined;
	}
}
