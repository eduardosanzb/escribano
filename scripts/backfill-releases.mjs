#!/usr/bin/env node

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..");
const CHANGELOG_PATH = join(REPO_ROOT, "CHANGELOG.md");

function run(cmd) {
  return execSync(cmd, { encoding: "utf-8", cwd: REPO_ROOT }).trim();
}

function getPreviousTag(currentTag, allTags) {
  const currentIndex = allTags.indexOf(currentTag);
  if (currentIndex === 0) return null;
  return allTags[currentIndex - 1];
}

function getCommitsBetweenTags(fromTag, toTag) {
  const range = fromTag ? `${fromTag}..${toTag}` : toTag;
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

async function generateReleaseNotes(commits, version, tagDate) {
  const commitList = commits
    .map(c => `- ${c.subject} (${c.author}, ${c.date})`)
    .join("\n");

  const prompt = `You are a release notes generator. Given these git commits, create a clean, user-friendly changelog entry.

Version: ${version}
Date: ${tagDate}

Commits:
${commitList}

Generate a changelog entry in this exact format (use markdown):

## [${version}] - ${tagDate}

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
    
    const changes = commits.map(c => `- ${c.subject}`).join("\n");
    
    return `## [${version}] - ${tagDate}

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
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log("Usage: node scripts/backfill-releases.mjs <tag1> [tag2] [tag3] ...");
    console.log("Example: node scripts/backfill-releases.mjs v0.1.1 v0.1.3 v0.2.0");
    process.exit(1);
  }
  
  const tagsToProcess = args;
  const allTags = run("git tag --list 'v*' | sort -V").split("\n").filter(Boolean);
  
  console.log(`🚀 Creating releases for ${tagsToProcess.length} tags...\n`);
  
  for (const tag of tagsToProcess) {
    if (!allTags.includes(tag)) {
      console.error(`❌ Tag ${tag} not found`);
      continue;
    }
    
    console.log(`\n📌 Processing ${tag}`);
    
    const previousTag = getPreviousTag(tag, allTags);
    console.log(`   Previous tag: ${previousTag || "none (first release)"}`);
    
    const commits = getCommitsBetweenTags(previousTag, tag);
    console.log(`   Found ${commits.length} commits`);
    
    if (commits.length === 0) {
      console.log("   ⚠️  No commits found, skipping");
      continue;
    }
    
    const version = tag.replace(/^v/, "");
    const tagDate = run(`git log -1 --format=%ad --date=short ${tag}`);
    
    const releaseNotes = await generateReleaseNotes(commits, version, tagDate);
    
    console.log("\n   Generated release notes:");
    console.log("   " + releaseNotes.split("\n").join("\n   "));
    console.log("\n   ---");
    
    updateChangelog(releaseNotes);
    createGitHubRelease(tag, releaseNotes);
  }
  
  console.log("\n🎉 All releases complete!");
  console.log("\nNext steps:");
  console.log("  1. Review CHANGELOG.md changes");
  console.log("  2. Commit: git add CHANGELOG.md && git commit -m 'docs: add CHANGELOG'");
  console.log("  3. Push: git push");
}

main().catch(error => {
  console.error("❌ Release creation failed:", error.message);
  process.exit(1);
});
