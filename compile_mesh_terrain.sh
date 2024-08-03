glslc src/shader/terrain_rendering/terrain_count_tessellation.comp -o build/shader/terrain_count_tessellation.comp.spv --target-spv=spv1.4
glslc src/shader/terrain_rendering/terrain_rendering_64.task -o build/shader/terrain_rendering_64.task.spv --target-spv=spv1.4
glslc src/shader/terrain_rendering/terrain_rendering.task -o build/shader/terrain_rendering.task.spv --target-spv=spv1.4
glslc src/shader/terrain_rendering/terrain_rendering.mesh -o build/shader/terrain_rendering.mesh.spv --target-spv=spv1.4
glslc src/shader/terrain_rendering/terrain_rendering.frag -o build/shader/terrain_rendering.frag.spv --target-spv=spv1.4