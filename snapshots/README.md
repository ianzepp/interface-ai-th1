# Local target snapshots

Named child directories are cold, complete archives of a target's persistent
Docker volumes. They are created by `scripts/target snapshot`, are intentionally
ignored by Git, and have this shape:

```text
snapshots/<target>/<snapshot-name>/
├── manifest.json
└── <one archive per persistent volume>.tar.gz
```

The manifest records the target version, pinned image references, resolved image
IDs, volume-to-archive mapping, and SHA-256 of every archive. A reset validates
the manifest and every checksum before deleting the current target volumes.

A snapshot ID is `<target>/<snapshot-name>`. Use that exact value as a captured
run's fixture ID. Snapshots may contain synthetic business records and uploaded
documents, so promote them to Git only through a separate explicit review.
