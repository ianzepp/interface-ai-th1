TARGET_ID="dolibarr"
TARGET_DISPLAY_NAME="Dolibarr"
TARGET_VERSION="23.0.4"

# Lane parameters. A lane suffixed the pinned project and volume names and shifts
# the host port; the default instance keeps the values below untouched.
TARGET_VOLUME_BASE="interface-ai-dolibarr"
TARGET_DEFAULT_PORT="8080"
TARGET_PORT_VARIABLE="DOLIBARR_PORT"
TARGET_VOLUME_PREFIX_VARIABLE="DOLIBARR_VOLUME_PREFIX"
TARGET_URL_SCHEME="http"
TARGET_HEALTH_PATH=""

TARGET_URL="http://127.0.0.1:8080"
TARGET_HEALTH_URL="${TARGET_URL}/"
COMPOSE_PROJECT="interface-ai-dolibarr"
APP_SERVICE="app"
DATABASE_SERVICE="mariadb"
APP_IMAGE_REF="dolibarr/dolibarr:23.0.4@sha256:9d7d3d2d4f3922914a224c3042bc102f4ddf9dbdd3ba0900bc2cccfd784324f5"
DATABASE_IMAGE_REF="mariadb:11.4.8@sha256:bc474f00629f0123c10f9e1bca193a45d18af15a274cf0656acda64f1086c3b6"
# VOLUME_NAMES must stay index-aligned with VOLUME_KEYS: apply_lane rebuilds the
# names from the keys, so a misordered pair would restore an archive into the
# wrong volume.
VOLUME_KEYS=("mariadb-data" "documents" "custom")
VOLUME_NAMES=(
    "interface-ai-dolibarr-mariadb-data"
    "interface-ai-dolibarr-documents"
    "interface-ai-dolibarr-custom"
)
VOLUME_FILES=(
    "mariadb-data.tar.gz"
    "documents.tar.gz"
    "custom.tar.gz"
)
