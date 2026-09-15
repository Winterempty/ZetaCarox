# Upgrade from ZetaCaros 1.2 to 2.0

Do not overwrite the existing installation. Back up v1.2, stop its server, extract this release separately, and restore the backup into the new folder. Follow the migration section in [WINDOWS-TH.md](WINDOWS-TH.md).

Schema 2 adds optional barcodes and direct sales. A consistent schema-1 snapshot is retained before migration. All original tables, users and business records remain. The original UI is still at /legacy.

The exact supplied ZIP is under original/. The supplied ZIP contained no actual shop database. Synthetic migration and restore tests do not substitute for verifying your own backup before switching production use.
