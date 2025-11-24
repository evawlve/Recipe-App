# Helper script to connect to database using DIRECT_URL from .env
param(
    [string]$Command = $null
)

# Load .env file and get DIRECT_URL
$envFile = Join-Path $PSScriptRoot ".env"
if (-not (Test-Path $envFile)) {
    Write-Host "Error: .env file not found" -ForegroundColor Red
    exit 1
}

$directUrlLine = Get-Content $envFile | Select-String "^DIRECT_URL="
if (-not $directUrlLine) {
    Write-Host "Error: DIRECT_URL not found in .env" -ForegroundColor Red
    exit 1
}

$directUrl = ($directUrlLine -replace '^DIRECT_URL="|"$', '')

# Parse connection string: postgresql://user:password@host:port/database?params
if ($directUrl -match 'postgresql://([^:]+):([^@]+)@([^:]+):(\d+)/([^?]+)') {
    $username = $matches[1]
    $password = $matches[2]
    $dbHost = $matches[3]
    $port = $matches[4]
    $database = $matches[5]
    
    # Set password as environment variable (psql uses PGPASSWORD)
    $env:PGPASSWORD = $password
    
    if ($Command) {
        # Execute a command
        psql -h $dbHost -p $port -U $username -d $database -c $Command
    } else {
        # Interactive session
        psql -h $dbHost -p $port -U $username -d $database
    }
} else {
    Write-Host "Error: Could not parse DIRECT_URL connection string" -ForegroundColor Red
    exit 1
}

