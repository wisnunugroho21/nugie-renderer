mkdir -p build/shader

glslc src/shader/forward.frag -o build/shader/forward.frag.spv
glslc src/shader/forward.vert -o build/shader/forward.vert.spv
glslc src/shader/deferred.frag -o build/shader/deferred.frag.spv
glslc src/shader/quad.vert -o build/shader/quad.vert.spv
