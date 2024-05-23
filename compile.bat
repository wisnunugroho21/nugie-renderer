mkdir build\shader

glslc src/shader/forward.vert -o build/shader/forward.vert.spv
glslc src/shader/forward.frag -o build/shader/forward.frag.spv
glslc src/shader/ray_gen.comp -o build/shader/ray_gen.comp.spv
glslc src/shader/ray_intersect.comp -o build/shader/ray_intersect.comp.spv
glslc src/shader/ray_hit.comp -o build/shader/ray_hit.comp.spv
glslc src/shader/sampling.comp -o build/shader/sampling.comp.spv