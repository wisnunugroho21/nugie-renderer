# How the renderer works

This walkthrough describes the current implementation, including optional paths and practical limitations. The engine combines a TypeScript entity-component runtime with a WebGPU renderer using clustered forward shading. CPU code prepares simulation and draw data; GPU compute passes perform selected work such as light assignment, visibility and particle simulation; vertex/fragment shaders turn geometry into the final image.

## 1. The codebase map

| Area | What it does |
| --- | --- |
| `src/app` | Engine creation, application loop, resize handling, URL configuration and HUD |
| `src/ecs` | Entity identities, component stores, hierarchy, queries and simulation systems |
| `src/animation` | Clip sampling, poses, controllers, state machines, blends, root motion, IK and motion matching |
| `src/assets` | glTF/GLB conversion, image/HDR loading and CPU mip generation |
| `src/rendering` | Dense render snapshot, camera, queues, batches, geometry/material managers, main renderer, lighting, shadows, post-processing and overlays |
| `src/gpu` | WebGPU context, buffers/textures, arenas, frame allocators, shader/pipeline/bind-group/sampler caches and memory statistics |
| `src/shaders` | WGSL geometry, lighting, deformation, visibility, fog, particles, ribbons and post-processing |
| `src/visibility` | CPU frustum tests, static BVH and mesh LOD selection |
| `src/scene` | Grouped instance and heterogeneous batch convenience APIs |
| `src/picking` | CPU ray intersection against bounds and retained static triangles |
| `src/streaming` | Screen-coverage tracking, mip residency policy and GPU texture replacement |
| `src/geometry`, `src/workers` | Mesh optimization/simplification/meshlet utilities, off-thread geometry jobs and frame-budgeted work |
| `src/profiling` | CPU counters and asynchronous GPU timestamp queries |
| `src/demos`, `src/game`, `src/bench`, `src/selftest` | Usage examples, starter application, browser benchmarks and real GPU reference tests |

`src/index.ts` is the public API. The demo launcher `src/main.ts` selects a scene, configures settings/environment, creates camera controls, and calls `Engine.start`. The engine library can be used independently of this launcher.

## 2. Startup

`Engine.create(canvas)` initializes an `Application`. `GPUContext.create` requests a WebGPU adapter/device, requests available optional features (`timestamp-query`, `float32-filterable`, `indirect-first-instance`), configures the canvas context using the browser's preferred format, and creates the resource managers. Device limits constrain backing dimensions and allocations. The canvas backing resolution follows CSS size multiplied by device pixel ratio, clamped to the maximum texture dimension.

The application installs device-loss handling that stops the loop and observes canvas resizes. It does not implement automatic reconstruction after device loss.

The engine constructs the world and systems, a renderer, a texture loader, and a default camera entity. The default perspective camera is 45 degrees vertically with near/far distances 0.1/500. Creating the engine does not populate the scene or start the loop.

The renderer constructs shared mesh, material, transform, joint, morph and instance storage; bind-group layouts; scene resources; cluster and shadow infrastructure; post-processing infrastructure; and profiling. Some systems are enabled lazily, such as particles and volumetric fog. Core infrastructure can allocate resources even if a particular pass is not active. The IBL BRDF LUT is generated during renderer setup.

## 3. Three different identities

An entity handle is a number containing a 20-bit index and an 11-bit generation. Destroying and reusing the index increments its generation, allowing `World.isAlive(handle)` to reject stale handles until that finite generation counter wraps. Component stores use the entity index rather than the complete handle.

A render slot is a dense index assigned by `RenderExtractor`. It can change when another object is removed. A draw-instance index is a position in the current frame's sorted instance records. These three indices serve different purposes. Picking returns entity indices; the shader's transform index refers to a render slot; WebGPU `instance_index` refers to the instance buffer record.

The ECS stores components as separate typed arrays. For example, transform positions live in `positionX`, `positionY`, `positionZ`; rotations are quaternions; matrices are packed in one array. Bit sets record which entities have which components. Queries intersect the membership sets. `World.destroy` removes components and releases the entity identity; GPU meshes and materials may remain shared by other entities.

## 4. The complete CPU frame

`Application.start` schedules `requestAnimationFrame`. Each callback derives delta time and absolute time in seconds from the supplied timestamp. A loop generation prevents stopped/restarted callbacks from creating duplicate loops. `Engine.start` runs the user's update callback, then `Engine.frame`, then `onFrameEnd`.

The exact `Engine.frame` sequence is:

1. Custom `beforeAnimation` systems.
2. Animation sampling/controller evaluation into local transforms and morph weights.
3. Transform hierarchy update into world matrices.
4. Skeleton update into owner-relative skinning matrices.
5. World bounds update.
6. Particle emitter synchronization and particle CPU request preparation; ribbon emitter/head preparation.
7. Missing static-mesh bounds and custom `afterTransforms` systems.
8. Extraction into `RenderWorld`.
9. CPU frustum/BVH visibility and CPU mesh LOD selection when applicable.
10. GPU data uploads, queues/batches, optional offscreen views, render graph recording and main submission.

`beforeAnimation` is appropriate for gameplay that writes scene state. `afterTransforms` is appropriate for reading current world-space results. Transform changes written after the transform system runs are normally reflected by the next update. Animation may overwrite properties controlled by the same animation channels.

## 5. Transforms, animation and bounds

Local transforms compose as `T * R * S`, and a child world matrix is `parentWorld * local`. The transform system processes dirty entries shallowest first and walks their descendants. Stamps prevent duplicate processing when a dirty ancestor already covers a dirty child. Matrix math uses affine structure and fuses composition with parent multiplication. Store setters queue dirtiness; direct array writes bypass that mechanism.

Matrices are column-major; the coordinate system is right-handed; cameras look toward local -Z; clip depth is [0,1] with ordinary depth clearing to 1. Characters use +Z as forward in motion-matching conventions, while lights shine toward local -Z.

Simple animators sample one clip with playback/loop/speed state. Sampling supports the imported animation interpolation modes. Controllers evaluate state-machine transitions and motions, blend layers with masks, apply additive poses and root-motion policies, then execute procedural constraints such as two-bone IK and look-at. The animation system writes the result into ECS local transforms/morph states. Unchanged poses avoid downstream dirty work. Motion matching searches normalized weighted feature vectors with a brute-force/early-out baseline and smooths selected transitions through inertialization.

For joint j, the CPU computes `inverse(ownerWorld) * jointWorld[j] * inverseBind[j]`. Each affine joint matrix is stored as three vec4 rows: 48 bytes instead of a full 64-byte matrix. Only changed joint ranges upload. Rigid movement of the owner and all joints can leave the relative joint matrices unchanged.

Bounds are local AABBs transformed into world AABBs and spheres. Skinned bounds are conservatively expanded rather than recomputed from every deformed vertex. Morph padding accounts for possible target displacement. This reduces CPU work but requires an appropriate padding policy for extreme animation or procedural displacement.

## 6. Extraction into render data

The renderer's input is `RenderWorld`, not the ECS. The extractor maintains an entity-to-render-slot map. Eligible entities have a transform and mesh renderer and are not hidden. It adds new renderables, removes obsolete renderables using swap removal, refreshes lightweight material/mesh/skin/morph/LOD fields, and copies matrices/bounds only for changed objects.

The snapshot contains dense arrays of entity indices, mesh/material IDs, flags, world transforms, bounds, joint/morph offsets and LOD groups. It also contains the active camera, light records and compacted morph-weight data. A structure version invalidates caches when renderable membership or static membership changes; `changedSlots` drives sparse transform uploads.

Without an explicit camera index, extraction chooses the first entity with both camera and transform components. Objects with no bounds receive infinite bounds so they remain conservatively visible. Active morph targets are stored as `(targetIndex, weightBits)` pairs; zero targets do not need shader work.

## 7. Visibility and geometry detail

CPU visibility has three strategies: pass every object, linearly test world spheres against six frustum planes, or traverse a flat BVH for static objects and linearly test dynamic objects. The BVH rebuilds on structure changes. A `Static` flag is a promise that bounds will not move; moving its parent also violates that promise.

CPU LOD estimates projected screen-height coverage as `radius / (distance * tan(fovY/2))`. Each group maps descending size thresholds to mesh IDs. Hysteresis reduces threshold flickering; the smallest objects may be culled entirely. Extraction restores the original mesh choice before LOD is applied again.

Optional GPU visibility processes the opaque/alpha-mask instance batches on the GPU. Each thread tests a sphere, chooses a LOD if enabled, atomically reserves output space, copies the surviving instance record, and updates indirect draw arguments. The CPU still records a draw per batch/LOD variant; it does not wait for a visibility readback. Transparent objects remain on the CPU-sorted direct path. GPU LOD uses thresholds without CPU LOD hysteresis.

Two-phase Hi-Z visibility first draws previously visible objects that remain in the frustum, builds a max-depth pyramid from their current-frame depth, tests remaining candidates against that pyramid, and draws newly visible objects. For this standard-Z depth convention, a candidate can be rejected when its nearest possible depth lies behind all relevant occluder depths. Conservative checks keep camera-plane-crossing bounds visible. History improves the first phase; the depth comparison uses the current frame's pyramid. Hi-Z forces MSAA to one sample and disables the current screen-space transmission path.

Mesh optimization utilities can optimize cache/fetch ordering, generate simplified LOD meshes and build meshlet data. The current main draw path issues indexed mesh draws; merely having a meshlet utility does not make it a meshlet-rendering pipeline.

## 8. Queues, sorting and batching

The queue builder partitions visible objects into opaque, alpha-mask and transparent lists. Opaque/alpha-mask keys sort by pipeline variant, material, mesh, then approximate distance bucket. This makes compatible objects adjacent while giving some front-to-back preference. Transparent objects sort back-to-front by object-center distance; this is an approximation for intersecting transparent geometry.

Large lists use stable radix sorting of two 32-bit keys; small lists use comparison sorting. Identical inputs/keys reuse the previous order, though validating the input still costs a scan.

The renderer supports unsorted individual draws, sorted individual draws, or sorted instanced draws. In instanced mode, adjacent objects with the same material and mesh become one batch. For example, 10,000 opaque cubes sharing both can form one main geometry draw even when transforms differ. Multiple meshes/materials, shadows, views and additional passes increase total draws.

Each instance record is 12 unsigned words/48 bytes:

| Words | Contents |
| --- | --- |
| 0-1 | Render-slot transform index, material record index |
| 2-3 | Joint matrix offset/count |
| 4-5 | Active morph pair offset/count |
| 6 | Entity index for identity/history |
| 7-8 | Vertex base and vertex count |
| 9-10 | Skin data and morph delta offsets |
| 11 | Mesh deformation capability and morph stride |

Per-instance skin/morph offsets mean different character poses can share a batch. `InstancedMesh` is an ECS convenience wrapper; automatic batching performs the actual GPU instancing. `BatchedMesh` groups different geometries with one material, normally producing a draw per distinct compatible geometry run rather than one draw for all different meshes.

## 9. Shared GPU storage and binding contracts

Static vertices have position(3), normal(3), UV(2), tangent(4): 12 floats/48 bytes. Meshes occupy appendable shared vertex and uint32 index arenas. A mesh record supplies `baseVertex`, `firstIndex` and counts. Another shared arena stores packed skin data and target deltas. Skin data packs four u16 joint indices and four normalized u16 weights into 16 bytes per vertex.

Material records occupy 64 bytes each in a shared storage buffer, followed by extension/custom parameter vec4s. Textures differ by material and use cached material bind groups. A transform takes 64 bytes; a joint takes 48 bytes; an instance takes 48 bytes. These are record sizes, not total engine memory usage.

| Bind group | Data supplied to shaders |
| --- | --- |
| 0: Frame | View/projection matrices, camera position, time, viewport, near/far and output/transmission flags |
| 1: Scene | Lights, cluster lists, shadow data, environment maps/LUTs, transmission copy and fog volume |
| 2: Material | Shared records/parameters, sampler, base-color/metal-rough/normal/occlusion/emissive/height/alpha/aux/environment textures |
| 3: Object | Transforms, instance records, joint matrices, compacted morph weights and deformation data |

The object group uses five vertex-stage storage buffers; the material group adds one, staying within the requested storage-buffer budget. Compute systems have separate appropriate layouts.

Dynamic instance allocation rotates through three GPU buffer slots with CPU staging. It aligns allocations to 768 bytes, a multiple of both the 48-byte record and 256-byte storage alignment, so `firstInstance` stays integral. Growth preserves the CPU contents and gives the replacement buffer a new generation. Bind-group cache keys include generations to avoid binding replaced buffers.

Transform uploads combine neighboring dirty ranges, switching to a full upload when more than roughly one quarter of objects changed. Joint and morph uploads likewise use dirty ranges. Materials upload dirty spans. Instance records are rebuilt for the current draw order. GPU caches deduplicate shaders, pipelines, samplers and bind groups.

## 10. Vertex and fragment processing

The vertex shader reads its instance record and base geometry. It applies active morph deltas first, then blends four joint matrices for skinning, then optional height displacement, then the model matrix and camera view-projection matrix. Main, depth and shadow paths share deformation logic. Normals/tangents are transformed for shading, and world position, UVs and material identity are interpolated to fragments.

The fragment shader constructs a surface from material values and textures. It supports metallic/roughness Cook-Torrance shading with GGX distribution, correlated Smith visibility and Schlick Fresnel. It can derive tangent space when tangent data is absent, apply normal/bump maps, march parallax, discard alpha-mask fragments and shade double-sided surfaces. Color/emissive images use color encoding appropriate to their role; numeric maps must remain linear data.

Optional material variants implement clearcoat, sheen, transmission, iridescence, anisotropy, specular/IOR, volume attenuation and dispersion, plus unlit/Lambert/Phong/toon/matcap models. Shader assembly expands registered `//#include` chunks once and injects feature constants. Pipeline variants depend on shader/features, mesh deformation, vertex layout, blending/culling/depth state, formats and sample count. Warmup precreates PBR main-pass variants; it does not guarantee every custom, shadow or post pipeline is ready.

## 11. Lights, shadows, environment and fog

This is forward shading: geometry fragments calculate lighting directly. Cluster compute divides the screen into 64-pixel XY tiles and 24 exponential depth slices. Each cluster stores a list of ranged lights that can reach it, with a default capacity of 256; overflow drops excess lights and records a counter. Fragments look up their cluster and loop over its light indices plus globally affecting lights. Without clusters, fragments loop through the full relevant light list.

Directional, point, spot, ambient and rectangular area lights are supported. Area-light diffuse uses a rectangle form factor and specular uses LTC approximation. Scene settings supply a legacy sun/hemisphere ambient only when extracted ECS lighting is absent.

Shadows are depth32float array layers. The first shadow-casting directional light gets four cascades by default; spots use one layer each, point/area lights six face layers each. Default budgets are eight spots and two point/area lights, with 1024-square layers and directional coverage up to 80 world units. Each layer separately culls/batches casters from the render world, so an object outside the main camera can still cast a visible shadow. Sampling uses bias and a 3x3 PCF filter; directional cascade edges blend. Area-light shadows approximate visibility from the light center.

Image-based lighting bakes a procedural sky/HDR/captured cube into diffuse irradiance, roughness-prefiltered specular mips and a BRDF LUT. Fragments combine these using the surface normal, reflected view direction, roughness and Fresnel terms. Skybox background drawing is separate from environment lighting.

Volumetric fog uses 8-pixel tiles and 48 depth slices in an rgba16float 3D texture. GPU compute integrates extinction and in-scattering using ambient/direct lighting and shadow information. Surface/sky shading applies accumulated scattering and transmittance through a volume lookup.

## 12. Pass graph and final output

`RenderGraph` stores logical pass reads/writes, derives hazards, marks everything needed by side-effect outputs, stably topologically sorts live passes and executes recording callbacks. It does not allocate physical resources, alias textures or automatically inspect GPU bindings. Accurate declarations remain the caller's responsibility.

The ordinary graph can include shadows, cluster assignment, feature compute passes, depth prepass, GPU visibility, fog, main rendering, auxiliary redraws and post-processing. Disabled or unneeded branches are omitted/culled. The optional depth prepass renders opaque/alpha-mask depth, then compatible main pipelines test equality without rewriting depth.

Ordinary main drawing orders early opaque/alpha-mask geometry, sky, late blended/transmissive geometry, then feature draws (particles, ribbons, overlays). With HDR screen-space transmission, it finishes opaque geometry/sky, copies that color into a mipmapped texture, then draws late surfaces sampling the copy. Objects outside the copied view cannot be reconstructed by this technique.

Direct rendering applies ACES tone mapping and sRGB encoding in `outputColor` and writes the canvas target. Post-processing instead retains linear HDR in rgba16float. SSAO/SSR request a separate PBR auxiliary redraw holding view-space normal/roughness/metallic plus depth reconstruction. SSAO is blurred with depth awareness; SSR ray-marches the visible scene; bloom thresholds/downsamples/upsamples bright color; composite applies exposure, tone mapping, effects and color grading; optional FXAA finishes the display image. MSAA can work independently of the HDR post chain except on the current Hi-Z path.

The main frame finishes one encoder and submits one command buffer. Additional offscreen views, texture streaming copies, environment baking and initialization can submit separately. Submission is asynchronous: JavaScript timing around `queue.submit` is not GPU execution time.

## 13. Offscreen views and other features

Render targets let material textures display mirrors, minimaps and security cameras. Each due view uses its camera and CPU visibility, queues/batches appended to the current instance storage, a separate render pass and submission. Normal/mirrored scratch is reused by winding variant through `RenderDrawState`; it is not one independent scratch object per registered view. Uniform snapshots restore main-camera state afterwards. Views exclude materials sampling their own target to avoid feedback.

Mirror views reflect the camera, change triangle winding and use an oblique projection to clip at the mirror plane. Views use plain light loops and reuse main-view shadow resources; they skip particles/ribbons, fog, post-processing, GPU visibility and MSAA. Because they submit before the current main shadow pass, they generally sample shadow contents from the previous submitted main frame. Reflection probes render six cube faces and bake them into an environment.

Particles use fixed-capacity GPU pools with state, ping-pong alive lists, dead lists, counters, emitters and indirect arguments. CPU code supplies spawn/emitter parameters; compute advances/recycles particles and builds the render list. Rendering uses indirect billboard or mesh draws. Ribbons retain history in shared segment rings, with compute advancing trails and CPU-supplied points for chains. Overlay systems batch thick lines, point sprites, textured sprites and font-atlas text.

`RenderFeature` exposes prepare/upload, graph-pass, main draw, post-pass, retarget and end-of-frame hooks. `produces` declares dependencies of main drawing. Registry ordering is stable by draw order. Removing a feature does not destroy its owned GPU resources.

## 14. Loading, streaming, picking and background work

glTF loading parses JSON/GLB and external resources, decodes accessors including sparse/padded layouts, and converts meshes/materials/nodes/skins/animations to CPU assets. Instantiation caches GPU assets per asset/mesh manager, creates the node hierarchy and renderable primitive entities, allocates independent pose/skeleton/morph state, and loads textures asynchronously. Defaults can render while the instance `ready` promise is pending. Image loading deduplicates successful/concurrent work and allows failed requests to retry.

Texture streaming holds CPU mip chains and chooses a finest resident level using visible projected coverage, a memory budget, upload budget and downgrade hysteresis. Coverage is conservative at material level. Changing residency creates a physically smaller GPU texture, copies overlapping levels, uploads new levels, updates its texture reference and invalidates material texture bind groups. CPU chains remain resident even when GPU detail is reduced. Upload budgeting permits one oversized first mip upgrade to make progress.

Picking first tests cached world AABBs. Static meshes with retained CPU geometry then intersect triangles in local coordinates; skinned/morphed geometry falls back to bounds. Keeping CPU triangles costs additional memory. Current picking scans entities rather than using the visibility BVH as its ray broad phase.

Worker pools move geometry work off-thread using transferable arrays, priorities and FIFO ties. Fatal worker failure settles all pool promises; message-level errors fail individual jobs. Geometry jobs can fall back to synchronous work when workers are unavailable. FrameBudgetQueue spreads cooperative main-thread tasks over frames, but an individual task runs to completion and cannot be preempted.

## 15. Performance and implementation boundaries

Performance is helped by dirty propagation, dense snapshots, shared static buffers, sparse uploads, cached sorting, instancing, pipeline/bind-group reuse, selective lighting and optional culling. Instancing reduces CPU draw encoding, not vertex/fragment work for every visible instance. Shadows multiply geometry work; high pixel ratios, overdraw, many lights, parallax, fog and post passes can dominate GPU time. Active animation crowds can dominate CPU time. See CODE_REVIEW.md for measured workloads and their limitations.

Important current boundaries:

- `ReceiveShadow` exists in `RenderFlags`, but current instance packing and lighting shaders do not consume it. Clearing it does not opt an individual object out of shadow reception. `CastShadow`, `Hidden` and `Static` have implemented consumers.
- Offscreen views and the main view deliberately have different feature coverage and submission timing.
- Transparent center sorting, area shadowing, animated bounds and screen-space effects are approximations.
- GPU LOD lacks CPU hysteresis; GPU visibility is limited to the participating opaque/alpha-mask batches.
- Device loss stops rendering; application disposal stops RAF/resize observation but is not a complete renderer-resource disposal API.
- Mesh arenas/shared resource caches require explicit lifetime decisions; destroying scene entities does not automatically remove shared GPU assets.
- Pipeline freeze reports late creation rather than making late feature creation impossible; PBR warmup is only part of full scene warmup.
- The source includes utilities not directly active in the main pipeline, such as meshlet generation and CPU deformation references.

Validation for this walkthrough: the full check command passes (593 CPU tests, production demo build, library/declaration build and imports of 161 library modules). The previous GPU run passed 34/34 tests; no rendering/shader algorithm was changed for this explanation. A build exclusion mistake from the preceding refactor was corrected from `demo` to the actual `demos` folder, and package verification now rejects application folders in the library output.

## 16. Where to read next

Follow `Engine.frame` -> `RenderExtractor.extract` -> `VisibilitySystem.update` -> `Renderer.render` -> `uploadFrameData` -> `RenderQueueBuilder.build` -> `buildBatches` -> `recordPasses` -> `drawGeometry` -> `pbr.wgsl`. Then follow `deformVertex` for animation and `shadeLights`/`evaluateIBL` for lighting. This traces one visible object from gameplay state to pixels.

For a feature, keep simulation state in a component/system, rendering work in a RenderFeature, reusable data in managers, and pure algorithms in GPU-independent modules. Validate CPU invariants with tests and shader behavior with GPU readbacks. [ARCHITECTURE.md](ARCHITECTURE.md) explains the extension contracts; [MAKING_A_GAME.md](MAKING_A_GAME.md) supplies usage examples; [CODE_REVIEW.md](CODE_REVIEW.md) records fixes and benchmarks.
