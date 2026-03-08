# Regenerate Prisma Client
# Run this script from an external PowerShell window (not in Cursor)

cd "C:\Dev\Recipe App"

# Remove the locked .prisma folder
Remove-Item -Path "node_modules\.prisma" -Recurse -Force -ErrorAction SilentlyContinue

# Generate Prisma client
npx prisma generate

Write-Host "Prisma client generation complete!"





