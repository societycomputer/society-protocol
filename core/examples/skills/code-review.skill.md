---
skill:
  name: "github-code-review"
  version: "1.0.0"
  description: "Comprehensive code review for GitHub pull requests using multiple expert agents"
  author: "Society Team"
  license: "MIT"

triggers:
  - type: webhook
    source: github
    event: pull_request.opened
  - type: webhook
    source: github
    event: pull_request.synchronize

society:
  template: "software_feature"
  room: "${env.SOCIETY_ROOM || 'code-reviews'}"
  priority: "high"
  chain_config:
    timeout_ms: 1800000  # 30 minutes
    consensus: "majority"

inputs:
  - name: pr_url
    type: "url"
    required: true
    description: "URL of the GitHub pull request to review"
    validation:
      pattern: "^https://github.com/[^/]+/[^/]+/pull/[0-9]+$"
  
  - name: pr_title
    type: "string"
    required: true
    description: "Title of the pull request"
  
  - name: pr_description
    type: "markdown"
    required: false
    description: "Description/body of the pull request"
  
  - name: changed_files
    type: "json"
    required: true
    description: "List of changed files with patch data"
  
  - name: review_depth
    type: "string"
    required: false
    default: "standard"
    description: "Depth of review to perform"
    validation:
      options: ["quick", "standard", "thorough"]

outputs:
  - name: review_report
    type: "markdown"
    description: "Comprehensive code review report"
    path: "./reviews/{pr_number}.md"
  
  - name: inline_comments
    type: "json"
    description: "Inline code comments for GitHub"
  
  - name: summary
    type: "string"
    description: "One-line summary of the review"

adapters:
  - runtime: "claude-code"
    specialties: ["code-review", "security", "performance"]
    min_reputation: 0.7
    count: 2
  
  - runtime: "github-actions"
    specialties: ["ci", "testing", "linting"]
    count: 1

hooks:
  on_init: "notify_start"
  on_complete: "post_github_comment"
  on_error: "notify_error"

config:
  env:
    GITHUB_TOKEN: "${secrets.GITHUB_TOKEN}"
    SOCIETY_ROOM: "code-reviews"
  secrets:
    - GITHUB_TOKEN
---

# GitHub Code Review Skill

This skill performs comprehensive code reviews on GitHub pull requests using Society Protocol's multi-agent collaboration.

## Overview

When triggered by a GitHub webhook, this skill:

1. **Analyzes** the PR changes and context
2. **Assigns** specialized reviewers:
   - Code quality expert
   - Security auditor
   - Performance analyst
   - Test coverage checker
3. **Synthesizes** all reviews into a comprehensive report
4. **Posts** results back to GitHub as a comment

## Review Checklist

### Code Quality
- [ ] Code follows project style guidelines
- [ ] Functions are appropriately sized
- [ ] Naming is clear and consistent
- [ ] No obvious code smells

### Security
- [ ] No injection vulnerabilities
- [ ] Proper input validation
- [ ] No hardcoded secrets
- [ ] Secure dependency versions

### Performance
- [ ] No obvious bottlenecks
- [ ] Efficient algorithms
- [ ] Appropriate data structures
- [ ] Database query optimization

### Testing
- [ ] Adequate test coverage
- [ ] Edge cases handled
- [ ] Integration tests included
- [ ] Test quality is good

## Usage

### As GitHub Action

```yaml
name: Society Code Review
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: society/action-review@v1
        with:
          skill: github-code-review
          room: my-team-reviews
```

### Programmatically

```typescript
import { skillExecutor } from 'society-core/sdk';

const result = await executeSkill('github-code-review', {
  pr_url: 'https://github.com/org/repo/pull/123',
  pr_title: 'Add user authentication',
  pr_description: '...',
  changed_files: files,
  review_depth: 'thorough'
});

console.log(result.summary);
```

## Output Example

```markdown
## 🔍 Code Review Report

### Summary
LGTM with minor suggestions. Security looks good, performance optimized.

### Code Quality: 8/10
- Well-structured functions
- Clear naming conventions
- Consider extracting helper function on line 45

### Security: ✅ PASS
- Input validation present
- No secrets detected
- Dependencies up to date

### Performance: 9/10
- Efficient queries
- Good caching strategy

### Testing: 7/10
- Missing edge case for null input
- Integration tests would be beneficial
```
