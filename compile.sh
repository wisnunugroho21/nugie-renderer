mkdir -p build/shader

glslc src/shader/forward.frag -o build/shader/forward.frag.spv
glslc src/shader/forward.vert -o build/shader/forward.vert.spv
glslc src/shader/deferred.frag -o build/shader/deferred.frag.spv
glslc src/shader/deferred.vert -o build/shader/deferred.vert.spv
glslc src/shader/shadow_map.frag -o build/shader/shadow_map.frag.spv
glslc src/shader/shadow_map.vert -o build/shader/shadow_map.vert.spv

