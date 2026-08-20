import assert from "node:assert/strict";
import test from "node:test";

import {
	bumpVersion,
	compareVersions,
	determineAutomaticBump,
	resolveRelease,
} from "./resolve-release-version.mjs";

test("bumps stable semantic versions", () => {
	assert.equal(bumpVersion("4.0.0", "patch"), "4.0.1");
	assert.equal(bumpVersion("4.0.9", "minor"), "4.1.0");
	assert.equal(bumpVersion("4.9.9", "major"), "5.0.0");
});

test("bumps prerelease versions to the next stable release", () => {
	assert.equal(bumpVersion("0.0.4-beta.0", "patch"), "0.0.5");
	assert.equal(bumpVersion("0.0.4-beta.0", "minor"), "0.1.0");
	assert.equal(bumpVersion("0.0.4-beta.0", "major"), "1.0.0");
});

test("compares stable semantic versions", () => {
	assert.equal(compareVersions("4.0.0", "4.0.0"), 0);
	assert.ok(compareVersions("4.0.1", "4.0.0") > 0);
	assert.ok(compareVersions("4.0.0", "4.1.0") < 0);
});

test("compares prerelease versions below their stable equivalent", () => {
	assert.ok(compareVersions("0.0.4-beta.0", "0.0.4") < 0);
	assert.ok(compareVersions("0.0.4", "0.0.4-beta.0") > 0);
	assert.ok(compareVersions("0.0.5", "0.0.4-beta.0") > 0);
	assert.equal(compareVersions("0.0.4-beta.0", "0.0.4-beta.0"), 0);
	assert.ok(compareVersions("0.0.4-beta.1", "0.0.4-beta.0") > 0);
});

test("selects the largest conventional commit bump", () => {
	assert.equal(
		determineAutomaticBump([
			{ body: "", subject: "fix: handle empty responses" },
			{ body: "", subject: "feat(api): add server validation" },
		]),
		"minor",
	);

	assert.equal(
		determineAutomaticBump([
			{ body: "", subject: "feat!: remove legacy endpoint" },
			{ body: "", subject: "fix: handle empty responses" },
		]),
		"major",
	);

	assert.equal(
		determineAutomaticBump([
			{
				body: "BREAKING CHANGE: configuration keys were renamed",
				subject: "refactor: simplify configuration",
			},
		]),
		"major",
	);
});

test("ignores commits that do not publish a release", () => {
	assert.equal(
		determineAutomaticBump([
			{ body: "", subject: "docs: clarify installation" },
			{ body: "", subject: "chore: update CI" },
		]),
		null,
	);
});

test("resolves auto and explicit release modes", () => {
	const commits = [{ body: "", subject: "fix: handle empty responses" }];

	assert.deepEqual(
		resolveRelease({
			baseVersion: "4.0.0",
			commits,
			currentVersion: "4.0.0",
			mode: "auto",
		}),
		{ bump: "patch", commitCount: 1, shouldRelease: true, version: "4.0.1" },
	);

	assert.deepEqual(
		resolveRelease({
			baseVersion: "4.0.0",
			commits: [],
			currentVersion: "4.0.0",
			mode: "minor",
		}),
		{ bump: "minor", commitCount: 0, shouldRelease: true, version: "4.1.0" },
	);
});

test("resolves prerelease npm versions", () => {
	assert.deepEqual(
		resolveRelease({
			baseVersion: "0.0.4-beta.0",
			commits: [{ body: "", subject: "fix: handle empty responses" }],
			currentVersion: "0.0.4-beta.0",
			mode: "auto",
		}),
		{ bump: "patch", commitCount: 1, shouldRelease: true, version: "0.0.5" },
	);

	assert.deepEqual(
		resolveRelease({
			baseVersion: "0.0.4-beta.0",
			commits: [],
			currentVersion: "0.0.5-beta.0",
			mode: "current",
		}),
		{ bump: "current", commitCount: 0, shouldRelease: true, version: "0.0.5-beta.0" },
	);

	assert.deepEqual(
		resolveRelease({
			baseVersion: "0.0.4-beta.0",
			commits: [],
			currentVersion: "0.0.5",
			mode: "current",
		}),
		{ bump: "current", commitCount: 0, shouldRelease: true, version: "0.0.5" },
	);
});

test("uses the repository version for bootstrap releases", () => {
	assert.deepEqual(
		resolveRelease({
			baseVersion: "3.0.0",
			commits: [],
			currentVersion: "4.0.0",
			mode: "current",
		}),
		{ bump: "current", commitCount: 0, shouldRelease: true, version: "4.0.0" },
	);

	assert.throws(
		() =>
			resolveRelease({
				baseVersion: "4.0.0",
				commits: [],
				currentVersion: "4.0.0",
				mode: "current",
			}),
		/must be newer/,
	);

	assert.throws(
		() =>
			resolveRelease({
				baseVersion: "0.0.4-beta.0",
				commits: [],
				currentVersion: "0.0.4-beta.0",
				mode: "current",
			}),
		/must be newer/,
	);
});
