# Vendored decoders

Pre-built decoders copied unmodified from `three@0.186.1` (`examples/jsm/libs`). They are loaded lazily, the first time an asset needs them.

| File | What | Upstream / licence |
|---|---|---|
| `draco_decoder_glue.js`, `draco_decoder.wasm` | Draco mesh decoder (glTF build) for `KHR_draco_mesh_compression` | [google/draco](https://github.com/google/draco), Apache-2.0 |
| `basis_transcoder_glue.js`, `basis_transcoder.wasm` | Basis Universal transcoder (UASTC / ETC1S to GPU formats) for KTX2 / `KHR_texture_basisu` | [BinomialLLC/basis_universal](https://github.com/BinomialLLC/basis_universal), Apache-2.0 |
| `meshopt_decoder.js` | meshoptimizer decoder (embedded wasm) for `EXT_meshopt_compression` | [zeux/meshoptimizer](https://github.com/zeux/meshoptimizer), MIT |
| `zstddec.js` | Zstandard decoder (embedded wasm) for KTX2 Zstd supercompression | [donmccurdy/zstddec](https://github.com/donmccurdy/zstddec), MIT (zstd: BSD-3-Clause) |

The `*.d.ts` files next to the scripts are hand-written type declarations for the parts of these modules the engine uses.
To update, copy the same files from a newer `three` release and re-run `npm test`.
