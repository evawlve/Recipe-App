# Creating Sprint 1 Issues

Scripts to automatically create Sprint 1 GitHub issues and milestone.

## Prerequisites

1. **GitHub CLI (gh)** must be installed
   - Download: https://cli.github.com/
   - Verify: `gh --version`

2. **Authenticated with GitHub**
   - Run: `gh auth login`
   - Verify: `gh auth status`

## Usage

### Creating Issues

#### Option 1: Git Bash (Windows/Linux/Mac)

```bash
# Run the script
bash scripts/create-s1-issues.sh
```

#### Option 2: PowerShell (Windows)

```powershell
.\scripts\create-s1-issues.ps1
```

### Verifying Issues Were Created

After running the creation script, verify that all issues were created:

#### Git Bash:
```bash
bash scripts/verify-s1-issues.sh
```

#### PowerShell:
```powershell
.\scripts\verify-s1-issues.ps1
```

The verification script will:
- Check if the milestone exists
- List all expected issues and their status
- Show which issues are found/missing
- Provide direct links to view issues

### Option 3: Manual Creation

If you prefer to create issues manually:

1. Go to your GitHub repository
2. Click "Issues" → "New Issue"
3. For each file in `.github/issues/s1-*.md`:
   - Copy the title from the `title:` field
   - Copy the body (everything after the `---` frontmatter)
   - Add labels from the `labels:` field
   - Assign to milestone "S1 – Parser + Schema"

## What the Scripts Do

1. **Check prerequisites** (gh CLI installed and authenticated)
2. **Create milestone** "S1 – Parser + Schema" (if it doesn't exist)
3. **Create 8 issues** from markdown files:
   - S1.1 – Parser: numeric normalization
   - S1.2 – Parser: qualifiers + unitHint
   - S1.3 – Parser: noise + punctuation
   - S1.4 – Schema migration
   - S1.5 – Feature flags
   - S1.6 – Parser unit tests
   - S1.7 – Parser property/fuzz tests
   - S1.8 – Docs & changelog

## Troubleshooting

### "gh: command not found"
- Install GitHub CLI from https://cli.github.com/
- Make sure it's in your PATH

### "Not authenticated"
- Run: `gh auth login`
- Follow the prompts to authenticate

### "Milestone already exists"
- The script will skip creating the milestone if it already exists
- It will still create issues and assign them to the existing milestone

### Issues not created
- Check that the markdown files exist in `.github/issues/`
- Verify you have write access to the repository
- Check GitHub CLI output for error messages

## Files

- `scripts/create-s1-issues.sh` - Bash script (works in Git Bash)
- `scripts/create-s1-issues.ps1` - PowerShell script (Windows)
- `.github/issues/s1-*.md` - Issue templates

