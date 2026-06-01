# Bundled cc65 toolchain

BreadCraft ships the **cc65** cross-compiler for the 6502 (C → C64 `.prg`). It is
bundled so the IDE is self-contained — the user installs nothing and configures no
path (see the project's "app IS the whole toolchain" goal).

- **License:** zlib (see `LICENSE` in this folder). Permissive: free to bundle and
  redistribute, including commercially. We ship cc65 **unmodified**.
- **Version:** cl65 V2.19 (Git cc3c40c), Windows snapshot.
- **Source:** https://sourceforge.net/projects/cc65/files/cc65-snapshot-win32.zip
  (project: https://cc65.github.io/)

## What's here (and why)

Only the parts needed to compile are bundled — `samples/` and `html/` from the
snapshot are intentionally omitted.

| Folder    | Purpose                                                |
|-----------|--------------------------------------------------------|
| `bin/`    | the executables (`cl65`, `cc65`, `ca65`, `ld65`, …)    |
| `lib/`    | runtime/startup libraries (`c64.lib`, `*.o`)           |
| `include/`| C headers (`conio.h`, `c64.h`, …)                      |
| `target/` | per-target support files cl65 needs at compile time    |
| `cfg/`    | linker config files                                    |
| `asminc/` | assembler include files                                |

## How BreadCraft finds it

`src/main/toolchain.ts` resolves this folder via `cc65Root()`:
- **dev:** `<projectRoot>/resources/cc65`
- **packaged:** `<process.resourcesPath>/cc65` (electron-builder copies it there
  through `extraResources` in `electron-builder.yml`).

## Updating cc65

Download a newer Windows snapshot, replace `bin/ lib/ include/ target/ cfg/ asminc/`
here, keep `LICENSE` + this README, and update the version line above. Verify with a
quick build: `cl65 -t c64 -O hi.c -o hi.prg`.

> Note: these are **Windows** binaries. Shipping for macOS/Linux later needs the
> matching per-OS cc65 binaries bundled per platform.
