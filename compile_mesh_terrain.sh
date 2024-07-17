glslc src/shader/mesh_shader/mesh_terrain_culling.task -o build/shader/mesh_terrain_culling.task.spv --target-spv=spv1.4
glslc src/shader/mesh_shader/mesh_terrain_culling.mesh -o build/shader/mesh_terrain_culling.mesh.spv --target-spv=spv1.4
glslc src/shader/mesh_shader/mesh_shade.frag -o build/shader/mesh_shade.frag.spv --target-spv=spv1.4-spv=spv1.4