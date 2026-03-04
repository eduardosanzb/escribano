#!/usr/bin/env node

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..");
const CHANGELOG_PATH = join(REPO_ROOT, "CHANGELOG.md");

function run(cmd) {
  return execSync(cmd, { encoding: "utf-8", cwd: REPO_ROOT }).trim();
}

function getCurrentTag() {
  try {
    return run("git describe --tags --exact-match");
  } catch {
    console.error("❌ No git tag found at current commit");
    console.error("   Run: git tag v<x.y.z> && git push --tags");
    process.exit(1);
  }
}

function getPreviousTag(currentTag) {
  const allTags = run("git tag --list 'v*' | sort -V").split("\n").filter(Boolean);
  const currentIndex = allTags.indexOf(currentTag);
  
  if (currentIndex === 0) return null;
  return allTags[currentIndex - 1];
}

function getCommitsSinceTag(previousTag, currentTag) {
  const range = previousTag ? `${previousTag}..${currentTag}` : currentTag;
  const format = "%H|%s|%an|%ad";
  const dateformat = "--date=short";
  
  const commits = run(`git log ${range} --pretty=format:'${format}' ${dateformat}`)
    .split("\n")
    .filter(Boolean)
    .map(line => {
      const [hash, subject, author, date] = line.split("|");
      return { hash, subject, author, date };
    });
  
  return commits;
}

async function generateReleaseNotes(commits, version) {
  const commitList = commits
    .map(c => `- ${c.subject} (${c.author}, ${c.date})`)
    .join("\n");

  const prompt = `You are a release notes generator. Given these git commits, create a clean, user-friendly changelog entry.

Version: ${version}

Commits:
${commitList}

Generate a changelog entry in this exact format (use markdown):

## [${version}] - ${new Date().toISOString().split("T")[0]}

### Added
- (new features)

### Fixed  
- (bug fixes)

### Changed
- (improvements, refactors)

### Removed
- (deprecated features removed)

Rules:
- Group commits into the most appropriate section
- Use present tense ("Add feature" not "Added feature")
- Be concise but descriptive
- If a section has no commits, omit it entirely
- Only output the changelog entry, no additional text`;

  try {
    const response = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.ESCRIBANO_LLM_MODEL || "qwen3:8b",
        prompt,
        stream: false,
        options: {
          temperature: 0.3,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama request failed: ${response.statusText}`);
    }

    const data = await response.json();
    return data.response.trim();
  } catch (error) {
    console.error("⚠️  Failed to generate notes with Ollama, using fallback");
    console.error(error.message);
    
    // Fallback: simple format
    const date = new Date().toISOString().split("T")[0];
    const changes = commits.map(c => `- ${c.subject}`).join("\n");
    
    return `## [${version}] - ${date}

### Changed
${changes}`;
  }
}

function updateChangelog(releaseNotes) {
  let changelog = "";
  
  if (existsSync(CHANGELOG_PATH)) {
    changelog = readFileSync(CHANGELOG_PATH, "utf-8");
  }
  
  const header = `# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`;

  if (!changelog.includes("# Changelog")) {
    changelog = header + changelog;
  }
  
  // Insert new release after header
  const lines = changelog.split("\n");
  const insertIndex = lines.findIndex(line => line.startsWith("## [")) || 6;
  
  lines.splice(insertIndex, 0, releaseNotes, "");
  
  writeFileSync(CHANGELOG_PATH, lines.join("\n"));
  console.log("✅ Updated CHANGELOG.md");
}

function createGitHubRelease(tag, releaseNotes) {
  const notesFile = `/tmp/escribano-release-${tag}.md`;
  writeFileSync(notesFile, releaseNotes);
  
  try {
    run(`gh release create ${tag} --title "${tag}" --notes-file "${notesFile}"`);
    console.log(`✅ Created GitHub release: ${tag}`);
  } catch (error) {
    if (error.message.includes("already exists")) {
      console.log(`⚠️  Release ${tag} already exists, skipping`);
    } else {
      throw error;
    }
  }
}

async function main() {
  console.log("🚀 Creating GitHub release...\n");
  
  const currentTag = getCurrentTag();
  console.log(`📌 Current tag: ${currentTag}`);
  
  const previousTag = getPreviousTag(currentTag);
  console.log(`📌 Previous tag: ${previousTag || "none (first release)"}`);
  
  const commits = getCommitsSinceTag(previousTag, currentTag);
  console.log(`📝 Found ${commits.length} commits\n`);
  
  if (commits.length === 0) {
    console.log("⚠️  No commits found, skipping release creation");
    process.exit(0);
  }
  
  const version = currentTag.replace(/^v/, "");
  const releaseNotes = await generateReleaseNotes(commits, version);
  
  console.log("Generated release notes:\n");
  console.log(releaseNotes);
  console.log("\n---\n");
  
  updateChangelog(releaseNotes);
  createGitHubRelease(currentTag, releaseNotes);
  
  console.log("\n🎉 Release complete!");
  console.log("\nNext steps:");
  console.log("  1. Review CHANGELOG.md changes");
  console.log("  2. Commit: git add CHANGELOG.md && git commit -m 'docs: update CHANGELOG'");
  console.log("  3. Push: git push");
}

main().catch(error => {
  console.error("❌ Release creation failed:", error.message);
  process.exit(1);
});
