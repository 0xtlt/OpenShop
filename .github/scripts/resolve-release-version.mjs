// @ts-check

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** @typedef {"auto" | "current" | "patch" | "minor" | "major"} ReleaseMode */
/** @typedef {"patch" | "minor" | "major"} VersionBump */
/** @typedef {{ body: string; subject: string }} Commit */
/**
 * @typedef ParsedVersion
 * @property {number} major
 * @property {number} minor
 * @property {number} patch
 * @property {string | null} prerelease
 */
/**
 * @typedef ReleaseResolution
 * @property {"current" | "none" | VersionBump} bump
 * @property {number} commitCount
 * @property {boolean} shouldRelease
 * @property {string} version
 */

const VERSION_PATTERN =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/;
/** @type {ReadonlySet<string>} */
const RELEASE_MODES = new Set(["auto", "current", "patch", "minor", "major"]);
/** @type {ReadonlyMap<string, VersionBump>} */
const RELEASE_TYPES = new Map([
	["feat", "minor"],
	["fix", "patch"],
	["perf", "patch"],
	["revert", "patch"],
	["deps", "patch"],
]);

/**
 * @param {string} value
 * @returns {value is ReleaseMode}
 */
function isReleaseMode(value) {
	return RELEASE_MODES.has(value);
}

/**
 * @param {string} version
 * @returns {ParsedVersion}
 */
function parseVersion(version) {
	const match = VERSION_PATTERN.exec(version);

	if (!match) {
		throw new Error(`Expected a semantic version, received "${version}"`);
	}

	return {
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3]),
		prerelease: match[4] ?? null,
	};
}

/**
 * @param {string} left
 * @param {string} right
 */
function comparePrereleaseIdentifiers(left, right) {
	const leftParts = left.split(".");
	const rightParts = right.split(".");
	const length = Math.max(leftParts.length, rightParts.length);

	for (let index = 0; index < length; index += 1) {
		const leftPart = leftParts[index];
		const rightPart = rightParts[index];

		if (leftPart === undefined) return -1;
		if (rightPart === undefined) return 1;

		const leftNumeric = /^\d+$/.test(leftPart);
		const rightNumeric = /^\d+$/.test(rightPart);

		if (leftNumeric && rightNumeric) {
			const diff = Number(leftPart) - Number(rightPart);
			if (diff !== 0) return diff;
			continue;
		}

		if (leftNumeric) return -1;
		if (rightNumeric) return 1;
		if (leftPart < rightPart) return -1;
		if (leftPart > rightPart) return 1;
	}

	return 0;
}

/**
 * @param {string} left
 * @param {string} right
 */
export function compareVersions(left, right) {
	const leftVersion = parseVersion(left);
	const rightVersion = parseVersion(right);
	const numericDiffs = [
		leftVersion.major - rightVersion.major,
		leftVersion.minor - rightVersion.minor,
		leftVersion.patch - rightVersion.patch,
	];

	for (const diff of numericDiffs) {
		if (diff !== 0) return diff;
	}

	if (leftVersion.prerelease === rightVersion.prerelease) return 0;
	if (leftVersion.prerelease === null) return 1;
	if (rightVersion.prerelease === null) return -1;

	return comparePrereleaseIdentifiers(leftVersion.prerelease, rightVersion.prerelease);
}

/**
 * @param {string} version
 * @param {VersionBump} bump
 */
export function bumpVersion(version, bump) {
	let { major, minor, patch } = parseVersion(version);

	if (bump === "major") {
		major += 1;
		minor = 0;
		patch = 0;
	} else if (bump === "minor") {
		minor += 1;
		patch = 0;
	} else if (bump === "patch") {
		patch += 1;
	} else {
		throw new Error(`Expected bump to be major, minor, or patch, received "${bump}"`);
	}

	return `${major}.${minor}.${patch}`;
}

/** @param {string} subject */
function conventionalHeader(subject) {
	return /^(?<type>[A-Za-z][\w-]*)(?:\([^\r\n)]+\))?(?<breaking>!)?:\s+\S/.exec(subject);
}

/**
 * @param {Commit[]} commits
 * @returns {VersionBump | null}
 */
export function determineAutomaticBump(commits) {
	/** @type {"minor" | "patch" | null} */
	let selectedBump = null;

	for (const commit of commits) {
		const header = conventionalHeader(commit.subject);
		const hasBreakingFooter = /(^|\r?\n)BREAKING(?:[ -]CHANGE):\s*\S/i.test(commit.body);

		if (header?.groups?.breaking || hasBreakingFooter) {
			return "major";
		}

		const releaseType = header?.groups?.type.toLowerCase();
		const bump = releaseType ? RELEASE_TYPES.get(releaseType) : undefined;

		if (bump === "minor") {
			selectedBump = "minor";
		} else if (bump === "patch" && selectedBump === null) {
			selectedBump = "patch";
		}
	}

	return selectedBump;
}

/**
 * @param {{ baseVersion: string; commits: Commit[]; currentVersion: string; mode: ReleaseMode }} options
 * @returns {ReleaseResolution}
 */
export function resolveRelease({ baseVersion, commits, currentVersion, mode }) {
	parseVersion(baseVersion);
	parseVersion(currentVersion);

	if (!RELEASE_MODES.has(mode)) {
		throw new Error(`Unknown release mode "${mode}"`);
	}

	if (mode === "current") {
		if (compareVersions(currentVersion, baseVersion) <= 0) {
			throw new Error(
				`Current package version ${currentVersion} must be newer than published version ${baseVersion}`,
			);
		}

		return {
			bump: "current",
			commitCount: commits.length,
			shouldRelease: true,
			version: currentVersion,
		};
	}

	const bump = mode === "auto" ? determineAutomaticBump(commits) : mode;

	if (bump === null) {
		return {
			bump: "none",
			commitCount: commits.length,
			shouldRelease: false,
			version: baseVersion,
		};
	}

	return {
		bump,
		commitCount: commits.length,
		shouldRelease: true,
		version: bumpVersion(baseVersion, bump),
	};
}

/**
 * @param {string} baseTag
 * @returns {Commit[]}
 */
function readCommits(baseTag) {
	const log = execFileSync(
		"git",
		["log", "--format=%s%x1f%b%x1e", `${baseTag}..HEAD`],
		{ encoding: "utf8" },
	);

	return log
		.split("\x1e")
		.map((entry) => entry.trim())
		.filter(Boolean)
		.map((entry) => {
			const [subject, ...body] = entry.split("\x1f");
			return { body: body.join("\x1f").trim(), subject: subject.trim() };
		});
}

/**
 * @param {string[]} arguments_
 * @returns {Map<string, string>}
 */
function parseArguments(arguments_) {
	const values = new Map();

	for (let index = 0; index < arguments_.length; index += 2) {
		const key = arguments_[index];
		const value = arguments_[index + 1];

		if (!key?.startsWith("--") || value === undefined) {
			throw new Error(
				"Usage: resolve-release-version.mjs --base-version <version> --base-tag <tag> --current-version <version> --mode <mode>",
			);
		}

		values.set(key.slice(2), value);
	}

	return values;
}

function main() {
	const arguments_ = parseArguments(process.argv.slice(2));
	const baseVersion = arguments_.get("base-version");
	const baseTag = arguments_.get("base-tag");
	const currentVersion = arguments_.get("current-version");
	const mode = arguments_.get("mode");

	if (!baseVersion || !baseTag || !currentVersion || !mode || !isReleaseMode(mode)) {
		throw new Error(
			"Usage: resolve-release-version.mjs --base-version <version> --base-tag <tag> --current-version <version> --mode <mode>",
		);
	}

	const result = resolveRelease({
		baseVersion,
		commits: readCommits(baseTag),
		currentVersion,
		mode,
	});

	console.log(`should_release=${result.shouldRelease}`);
	console.log(`version=${result.version}`);
	console.log(`tag=v${result.version}`);
	console.log(`bump=${result.bump}`);
	console.log(`commit_count=${result.commitCount}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
	main();
}
