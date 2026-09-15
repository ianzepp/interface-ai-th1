TARGET_ID="ledgersmb"
TARGET_DISPLAY_NAME="LedgerSMB"
TARGET_VERSION="1.13.7"

# Lane parameters. See targets/dolibarr/target.sh for the contract.
TARGET_VOLUME_BASE="interface-ai-ledgersmb"
TARGET_DEFAULT_PORT="5762"
TARGET_PORT_VARIABLE="LEDGERSMB_PORT"
TARGET_VOLUME_PREFIX_VARIABLE="LEDGERSMB_VOLUME_PREFIX"
TARGET_URL_SCHEME="http"
TARGET_HEALTH_PATH="/login.pl"

TARGET_URL="http://127.0.0.1:5762"
TARGET_HEALTH_URL="${TARGET_URL}/login.pl"
COMPOSE_PROJECT="interface-ai-ledgersmb"
APP_SERVICE="app"
DATABASE_SERVICE="postgres"
APP_IMAGE_REF="ghcr.io/ledgersmb/ledgersmb:1.13.7@sha256:3cd34ddb5bca4b1ab90c10079ca48ef0c4904bf120909e3885f0e41293b70e99"
DATABASE_IMAGE_REF="postgres:15.14-alpine@sha256:64583b3cb4f2010277bdd9749456de78e5c36f8956466ba14b0b96922e510950"
VOLUME_KEYS=("postgres-data")
VOLUME_NAMES=("interface-ai-ledgersmb-postgres-data")
VOLUME_FILES=("postgres-data.tar.gz")
