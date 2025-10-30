
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
	export const NoDefaultCurrentDirectoryInExePath: string;
	export const VSCODE_CRASH_REPORTER_PROCESS_TYPE: string;
	export const CLAUDE_CODE_ENTRYPOINT: string;
	export const NODE: string;
	export const INIT_CWD: string;
	export const SHELL: string;
	export const VSCODE_PROCESS_TITLE: string;
	export const HOMEBREW_REPOSITORY: string;
	export const TMPDIR: string;
	export const CURSOR_TRACE_ID: string;
	export const MallocNanoZone: string;
	export const ORIGINAL_XDG_CURRENT_DESKTOP: string;
	export const CLAUDE_AGENT_SDK_VERSION: string;
	export const npm_config_registry: string;
	export const GIT_EDITOR: string;
	export const USER: string;
	export const COMMAND_MODE: string;
	export const OPENAI_API_KEY: string;
	export const CURSOR_SPAWN_CHAIN: string;
	export const PNPM_SCRIPT_SRC_DIR: string;
	export const SSH_AUTH_SOCK: string;
	export const __CF_USER_TEXT_ENCODING: string;
	export const npm_execpath: string;
	export const ELECTRON_RUN_AS_NODE: string;
	export const CURSOR_SPAWNED_BY_EXTENSION_ID: string;
	export const npm_config_frozen_lockfile: string;
	export const npm_config_verify_deps_before_run: string;
	export const PATH: string;
	export const LaunchInstanceID: string;
	export const npm_package_json: string;
	export const __CFBundleIdentifier: string;
	export const PWD: string;
	export const npm_command: string;
	export const VSCODE_HANDLES_UNCAUGHT_ERRORS: string;
	export const VSCODE_ESM_ENTRYPOINT: string;
	export const OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE: string;
	export const npm_config__jsr_registry: string;
	export const npm_lifecycle_event: string;
	export const npm_package_name: string;
	export const NODE_PATH: string;
	export const XPC_FLAGS: string;
	export const NODE_TLS_REJECT_UNAUTHORIZED: string;
	export const npm_config_node_gyp: string;
	export const XPC_SERVICE_NAME: string;
	export const npm_package_version: string;
	export const pnpm_config_verify_deps_before_run: string;
	export const HOME: string;
	export const SHLVL: string;
	export const VSCODE_NLS_CONFIG: string;
	export const HOMEBREW_PREFIX: string;
	export const LOGNAME: string;
	export const npm_lifecycle_script: string;
	export const VSCODE_CODE_CACHE_PATH: string;
	export const VSCODE_IPC_HOOK: string;
	export const COREPACK_ENABLE_AUTO_PIN: string;
	export const VSCODE_PID: string;
	export const npm_config_user_agent: string;
	export const HOMEBREW_CELLAR: string;
	export const INFOPATH: string;
	export const SECURITYSESSIONID: string;
	export const VSCODE_CWD: string;
	export const VSCODE_L10N_BUNDLE_LOCATION: string;
	export const CLAUDECODE: string;
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
		NoDefaultCurrentDirectoryInExePath: string;
		VSCODE_CRASH_REPORTER_PROCESS_TYPE: string;
		CLAUDE_CODE_ENTRYPOINT: string;
		NODE: string;
		INIT_CWD: string;
		SHELL: string;
		VSCODE_PROCESS_TITLE: string;
		HOMEBREW_REPOSITORY: string;
		TMPDIR: string;
		CURSOR_TRACE_ID: string;
		MallocNanoZone: string;
		ORIGINAL_XDG_CURRENT_DESKTOP: string;
		CLAUDE_AGENT_SDK_VERSION: string;
		npm_config_registry: string;
		GIT_EDITOR: string;
		USER: string;
		COMMAND_MODE: string;
		OPENAI_API_KEY: string;
		CURSOR_SPAWN_CHAIN: string;
		PNPM_SCRIPT_SRC_DIR: string;
		SSH_AUTH_SOCK: string;
		__CF_USER_TEXT_ENCODING: string;
		npm_execpath: string;
		ELECTRON_RUN_AS_NODE: string;
		CURSOR_SPAWNED_BY_EXTENSION_ID: string;
		npm_config_frozen_lockfile: string;
		npm_config_verify_deps_before_run: string;
		PATH: string;
		LaunchInstanceID: string;
		npm_package_json: string;
		__CFBundleIdentifier: string;
		PWD: string;
		npm_command: string;
		VSCODE_HANDLES_UNCAUGHT_ERRORS: string;
		VSCODE_ESM_ENTRYPOINT: string;
		OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE: string;
		npm_config__jsr_registry: string;
		npm_lifecycle_event: string;
		npm_package_name: string;
		NODE_PATH: string;
		XPC_FLAGS: string;
		NODE_TLS_REJECT_UNAUTHORIZED: string;
		npm_config_node_gyp: string;
		XPC_SERVICE_NAME: string;
		npm_package_version: string;
		pnpm_config_verify_deps_before_run: string;
		HOME: string;
		SHLVL: string;
		VSCODE_NLS_CONFIG: string;
		HOMEBREW_PREFIX: string;
		LOGNAME: string;
		npm_lifecycle_script: string;
		VSCODE_CODE_CACHE_PATH: string;
		VSCODE_IPC_HOOK: string;
		COREPACK_ENABLE_AUTO_PIN: string;
		VSCODE_PID: string;
		npm_config_user_agent: string;
		HOMEBREW_CELLAR: string;
		INFOPATH: string;
		SECURITYSESSIONID: string;
		VSCODE_CWD: string;
		VSCODE_L10N_BUNDLE_LOCATION: string;
		CLAUDECODE: string;
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
