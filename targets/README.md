# Local targets

Each target is a pinned Docker Compose application plus a small declarative
adapter consumed by `scripts/target`. The adapter names the application URL,
version, images, and complete set of persistent volumes.

The images are pinned by release tag and multi-platform digest. This keeps the
same Compose files usable on Apple Silicon and x86-64 while preventing a tag
from silently moving between runs.

The credentials in these files are synthetic and intentionally local. Both web
ports bind only to `127.0.0.1`, and the database networks are internal to
Docker. These definitions are evaluation fixtures, not production deployments.
