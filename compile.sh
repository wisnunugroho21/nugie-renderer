mkdir -p build/shader

glslc src/shader/mesh_shade.frag -o build/shader/mesh_shade.frag.spv --target-spv=spv1.4
glslc src/shader/cube.mesh -o build/shader/cube.mesh.spv --target-spv=spv1.4