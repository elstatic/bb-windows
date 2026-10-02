---
name: windows-file-links
description: Prepare a remote BB file as a local Windows-accessible copy or configure synchronized-folder mappings.
---

Use `bb windows-file-links prepare <absolute-source-path> <thread-id> <windows-browser-host-id> --json` to obtain a local WSL path. Select the actual Windows browser host, never assume a server path belongs to local WSL. Use the client's file copy/reveal native bridge to translate that path for Windows. Thread-storage reports are not project-synced files; the plugin downloads a verified viewing copy. Set `mappings` through `bb plugin config windows-file-links` only for confirmed synchronized folder roots and host identities. Do not overwrite local edits or establish new synchronization implicitly.
