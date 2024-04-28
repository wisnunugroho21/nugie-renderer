mkdir -p build/shader

glslc src/shader/forward_apple.frag -o build/shader/forward_apple.frag.spv
glslc src/shader/forward.frag -o build/shader/forward.frag.spv
glslc src/shader/forward.vert -o build/shader/forward.vert.spv
glslc src/shader/shadow_map.vert -o build/shader/shadow_map.vert.spv
glslc src/shader/terrain_apple.frag -o build/shader/terrain_apple.frag.spv
glslc src/shader/terrain.frag -o build/shader/terrain.frag.spv
glslc src/shader/terrain.vert -o build/shader/terrain.vert.spv
glslc src/shader/terrain.tesc -o build/shader/terrain.tesc.spv
glslc src/shader/terrain.tese -o build/shader/terrain.tese.spv
glslc src/shader/skybox.frag -o build/shader/skybox.frag.spv
glslc src/shader/skybox.vert -o build/shader/skybox.vert.spv