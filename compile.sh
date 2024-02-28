mkdir -p build/shader

glslc src/shader/forward.frag -o build/shader/forward.frag.spv
glslc src/shader/forward.vert -o build/shader/forward.vert.spv
glslc src/shader/shadow_map.vert -o build/shader/shadow_map.vert.spv
glslc src/shader/terrain.frag -o build/shader/terrain.frag.spv
glslc src/shader/terrain.vert -o build/shader/terrain.vert.spv
