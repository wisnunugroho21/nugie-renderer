mkdir -p build/shader

glslc src/shader/forward.frag -o build/shader/forward.frag.spv
glslc src/shader/forward.vert -o build/shader/forward.vert.spv
glslc src/shader/ray_trace.comp -o build/shader/ray_trace.comp.spv
