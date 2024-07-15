mkdir -p build/shader
mkdir -p build/shader/raster

glslc src/shader/mesh_shader/mesh_terrain.task -o build/shader/mesh_terrain.task.spv --target-spv=spv1.4
glslc src/shader/mesh_shader/mesh_terrain.mesh -o build/shader/mesh_terrain.mesh.spv --target-spv=spv1.4
glslc src/shader/mesh_shader/mesh_shade.frag -o build/shader/mesh_shade.frag.spv --target-spv=spv1.4